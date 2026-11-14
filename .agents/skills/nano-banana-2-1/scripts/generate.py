"""Nano Banana 2.1 REST client. JSON stdin; save only the final JPEG or PNG."""
import argparse
import base64
import io
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

MODEL = "gemini-nano-banana-2.1"
BASE = "https://generativelanguage.googleapis.com/v1beta"
RATIOS = {"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}
MIMES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
MAX_PAYLOAD = 20 * 1024 * 1024


def api_key():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key and os.name == "nt":
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as reg:
                key = str(winreg.QueryValueEx(reg, "GEMINI_API_KEY")[0]).strip()
        except OSError:
            pass
        if key:
            os.environ["GEMINI_API_KEY"] = key
    if not key:
        raise ValueError("GEMINI_API_KEY is missing from the process and Windows user environment.")
    return key


def png_size(data):
    if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("The API did not return a valid PNG header; no file was saved.")
    width, height = struct.unpack(">II", data[16:24])
    if width < 1 or height < 1 or b"IEND" not in data[-12:]:
        raise ValueError("Incomplete PNG image; no file was saved.")
    return width, height


def jpeg_size(data):
    """Read a JPEG SOF header without decoding or recompressing the image."""
    if not data.startswith(b"\xff\xd8") or not data.endswith(b"\xff\xd9"):
        raise ValueError("Incomplete or invalid JPEG image; no file saved.")
    position = 2
    sof = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    while position < len(data):
        if data[position] != 0xFF:
            break
        while position < len(data) and data[position] == 0xFF:
            position += 1
        if position >= len(data):
            break
        marker = data[position]
        position += 1
        if marker in {0xDA, 0xD9}:  # SOS / EOI must follow a frame header.
            break
        if marker == 0x01 or 0xD0 <= marker <= 0xD8:
            continue
        if position + 2 > len(data):
            break
        length = int.from_bytes(data[position:position + 2], "big")
        if length < 2 or position + length > len(data):
            break
        if marker in sof:
            if length < 8:
                break
            height, width = struct.unpack(">HH", data[position + 3:position + 7])
            if width and height:
                return width, height
            break
        position += length
    raise ValueError("JPEG has no valid dimensions; no file saved.")


def require_png_converter():
    try:
        from PIL import Image
    except ImportError:
        raise ValueError(
            "PNG output requires Pillow for in-memory JPEG conversion. "
            "Use an installed Python with Pillow, or choose a .jpg output; nothing was sent."
        ) from None
    return Image


def configure_proxy(proxy):
    """Explicit proxy applies to this invocation only, with no direct fallback."""
    if proxy is None:
        return
    parsed = urllib.parse.urlsplit(proxy)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or not parsed.port:
        raise ValueError("--proxy must be an HTTP(S) proxy URL with host and port.")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("--proxy must not contain a path, query or fragment.")
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        os.environ[name] = proxy
    # Explicitly requested proxy must not be bypassed by inherited NO_PROXY.
    for name in ("NO_PROXY", "no_proxy"):
        os.environ[name] = ""


def build_request(config):
    if not isinstance(config, dict):
        raise ValueError("The input must be a JSON object.")
    prompt = config.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("A nonempty, refined prompt is required.")
    ratio, size = config.get("aspect_ratio", "1:1"), config.get("image_size", "2K")
    if ratio not in RATIOS or size not in {"1K", "2K", "4K"}:
        raise ValueError("Unsupported aspect_ratio or image_size.")
    output = config.get("output")
    if not isinstance(output, str) or not output.strip():
        raise ValueError("An absolute final output path is required.")
    path = Path(output).expanduser()
    if not path.is_absolute() or path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        raise ValueError("output must be an absolute .jpg, .jpeg or .png path.")
    path = path.resolve()
    overwrite = config.get("overwrite", False)
    if not isinstance(overwrite, bool):
        raise ValueError("overwrite must be true or false.")
    if path.exists() and (not overwrite or not path.is_file()):
        raise ValueError("Output already exists; use overwrite=true only for an authorized replacement.")
    if path.suffix.lower() == ".png":
        require_png_converter()  # Fail locally before a potentially billable request.
    references = config.get("references", [])
    if not isinstance(references, list) or len(references) > 14:
        raise ValueError("references must be an array of at most 14 images.")
    inputs = [{"type": "text", "text": prompt.strip()}]
    for index, ref in enumerate(references, 1):
        if not isinstance(ref, dict) or not isinstance(ref.get("instruction"), str) or not ref["instruction"].strip():
            raise ValueError(f"Reference {index} requires a specific instruction.")
        if bool(ref.get("path")) == bool(ref.get("image_base64")):
            raise ValueError(f"Reference {index}: provide either path or image_base64.")
        if ref.get("path"):
            source = Path(ref["path"]).expanduser().resolve()
            if source == path:
                raise ValueError("Do not overwrite an input reference; choose a different final output path.")
            mime = MIMES.get(source.suffix.lower())
            if source.stat().st_size > MAX_PAYLOAD:
                raise ValueError(f"Reference {index} exceeds the inline input limit.")
            raw = source.read_bytes()
        else:
            mime = ref.get("mime_type")
            raw = base64.b64decode(ref["image_base64"], validate=True)
        if mime not in MIMES.values() or not raw:
            raise ValueError(f"Reference {index} must be a nonempty PNG, JPEG or WebP.")
        inputs.extend([
            {"type": "text", "text": f"Reference image {index}: {ref['instruction']}"},
            {"type": "image", "mime_type": mime, "data": base64.b64encode(raw).decode("ascii")},
        ])
    payload = {
        "model": MODEL,
        "input": inputs,
        "store": False,
        "response_format": {
            "type": "image", "mime_type": "image/jpeg",
            "aspect_ratio": ratio, "image_size": size,
        },
    }
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(encoded) > MAX_PAYLOAD:
        raise ValueError("Inline request exceeds 20 MiB. Use fewer or smaller references; nothing was sent.")
    return path, overwrite, encoded


def call_api(key, payload=None):
    url = f"{BASE}/models/{MODEL}" if payload is None else f"{BASE}/interactions"
    request = urllib.request.Request(
        url, data=payload,
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        method="GET" if payload is None else "POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30 if payload is None else 240) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try:
            info = json.loads(detail).get("error", {})
            detail = f"{info.get('status', '')}: {info.get('message', '')}"
        except (ValueError, AttributeError):
            detail = "Non-JSON error response from Google."
        raise RuntimeError(f"Google API HTTP {error.code}: {detail.replace(key, '[REDACTED]')[:1500]}") from None
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError(f"Network error; request was not automatically retried: {str(error).replace(key, '[REDACTED]')}") from None


def final_image(response, path):
    if response.get("status") not in {None, "completed"}:
        raise ValueError(f"Generation did not complete: {response.get('status')}. No image saved.")
    images, messages = [], []
    for step in response.get("steps", []):
        if step.get("type") != "model_output":
            continue
        for part in step.get("content", []):
            if part.get("type") == "image" and part.get("data"):
                images.append(part)
            elif part.get("type") == "text":
                messages.append(part.get("text", ""))
    if not images:
        message = " ".join(messages)[:600] or "No final model_output image returned."
        raise ValueError(f"No image saved. {message}")
    if len(images) != 1:
        raise ValueError(f"Expected one final image, received {len(images)}; no file saved.")
    image = images[0]
    raw = base64.b64decode(image["data"], validate=True)
    mime = image.get("mime_type")
    if mime == "image/jpeg":
        dimensions = jpeg_size(raw)
    elif mime == "image/png":
        dimensions = png_size(raw)
    else:
        raise ValueError("Expected JPEG or PNG final output; no file saved.")
    wanted = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    if mime != wanted:
        Image = require_png_converter()
        with Image.open(io.BytesIO(raw)) as decoded:
            decoded.load()
            if decoded.size != dimensions:
                raise ValueError("Decoded dimensions do not match image header; no file saved.")
            if wanted == "image/jpeg" and decoded.mode not in {"RGB", "L"}:
                decoded = decoded.convert("RGB")
            converted = io.BytesIO()
            decoded.save(converted, format="PNG" if wanted == "image/png" else "JPEG")
            raw = converted.getvalue()
    return raw, dimensions


def save_final(path, raw, overwrite):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not overwrite:
        # Exclusive creation never changes an existing deliverable.
        with path.open("xb") as handle:
            try:
                handle.write(raw)
            except OSError:
                handle.close()
                path.unlink(missing_ok=True)
                raise
        return
    # Atomic replacement: only current final bytes, no backups or retained temps.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(raw)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--check", action="store_true", help="Read-only model access check")
    modes.add_argument("--dry-run", action="store_true", help="Validate JSON stdin without network or file output")
    parser.add_argument("--proxy", help="Explicit HTTP(S) proxy; applies to this process only")
    args = parser.parse_args()
    configure_proxy(args.proxy)
    if args.check:
        response = call_api(api_key())
        print(json.dumps({"ok": True, "model": response.get("name", MODEL)}, ensure_ascii=False))
        return
    config = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
    path, overwrite, payload = build_request(config)
    if args.dry_run:
        print(json.dumps({
            "valid": True, "model": MODEL,
            "aspect_ratio": config.get("aspect_ratio", "1:1"),
            "image_size": config.get("image_size", "2K"),
            "references": len(config.get("references", [])), "output": str(path),
        }, ensure_ascii=False))
        return
    raw, dimensions = final_image(call_api(api_key(), payload), path)
    save_final(path, raw, overwrite)
    print(json.dumps({
        "ok": True, "output": str(path), "width": dimensions[0],
        "height": dimensions[1], "model": MODEL,
        "aspect_ratio": config.get("aspect_ratio", "1:1"),
        "image_size": config.get("image_size", "2K"),
        "saved_format": "PNG" if path.suffix.lower() == ".png" else "JPEG",
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError) as exc:
        message = str(exc)
        secret = os.environ.get("GEMINI_API_KEY")
        if secret:
            message = message.replace(secret, "[REDACTED]")
        print(json.dumps({"ok": False, "error": message}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
