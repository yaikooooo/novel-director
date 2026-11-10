import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA_FILE, READER_VERSION, designFrames, frameCounts, validateDesign, validateMotion } from './contract.mjs';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(appDir, '../..');
const projectRoot = path.join(workspace, '项目');
const exampleRoot = path.join(appDir, '示例');
const port = Number(process.env.STORYBOARD_PORT || 4318);
const host = '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.pdf': 'application/pdf', '.blend': 'application/octet-stream',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
};
const relative = value => path.relative(workspace, value).split(path.sep).join('/');
const encodePath = value => value.split('/').map(encodeURIComponent).join('/');
const within = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
};

async function optionalJSON(file) {
  try { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function chapterFolder(id) {
  if (id === 'example') return exampleRoot;
  const parts = String(id).split('/');
  if (parts.length !== 3 || parts[1] !== '章节' || parts.some(part => !part || part === '..' || part.includes('\\'))) throw new Error('章节标识无效。');
  const folder = await fs.realpath(path.join(projectRoot, ...parts));
  if (!within(await fs.realpath(projectRoot), folder)) throw new Error('章节超出项目目录。');
  return folder;
}

async function entries(folder) {
  try { return await fs.readdir(folder, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

export async function library() {
  const chapters = [{ id: 'example', title: '阅读器示例', chapter: '门边的回望', example: true }];
  for (const work of await entries(projectRoot)) {
    if (!work.isDirectory() || work.isSymbolicLink()) continue;
    for (const chapter of await entries(path.join(projectRoot, work.name, '章节'))) {
      if (!chapter.isDirectory() || chapter.isSymbolicLink()) continue;
      chapters.push({ id: work.name + '/章节/' + chapter.name, title: work.name, chapter: chapter.name });
    }
  }
  return chapters;
}

export async function validateFiles(document, folder) {
  const issues = [];
  const references = [];
  for (const [id, sheet] of Object.entries(document?.design?.board_sheets || {})) references.push([id, sheet.image_ref]);
  for (const frame of designFrames(document)) {
    if (frame.board_art) references.push([frame.id + '.board_art', frame.board_art]);
  }
  for (const [id, scene] of Object.entries(document?.design?.scenes || {})) {
    if (scene.plan_ref) references.push([id, scene.plan_ref]);
  }
  const allowedRoot = folder === exampleRoot ? exampleRoot : path.resolve(folder, '../..');
  for (const [field, ref] of references) {
    if (!ref || path.isAbsolute(ref) || /^[a-z]+:/i.test(ref) || /(^|[\\/])临时([\\/]|$)/.test(ref)) {
      issues.push({ field, message: '素材路径须使用正式目录内的相对引用。' }); continue;
    }
    try {
      const target = await fs.realpath(path.resolve(folder, ref));
      if (!within(allowedRoot, target)) throw new Error('素材超出当前项目。');
      if (!(await fs.stat(target)).isFile()) throw new Error('素材不是文件。');
    } catch (error) { issues.push({ field, message: '素材不可读 ' + ref + '，' + error.message }); }
  }
  return issues;
}

export async function chapterData(id) {
  const folder = await chapterFolder(id);
  const document = await optionalJSON(path.join(folder, DATA_FILE));
  const files = (await entries(folder)).filter(entry => entry.isFile() && /\.(md|txt|json|pdf|svg)$/i.test(entry.name));
  const base = '/files/' + encodePath(relative(folder)) + '/';
  const issues = document ? [...validateDesign(document), ...validateMotion(document), ...await validateFiles(document, folder)] : [];
  return {
    id, example: id === 'example', base, document,
    documents: files.map(entry => ({ name: entry.name, url: base + encodeURIComponent(entry.name) })),
    counts: frameCounts(document), issues, reader_version: READER_VERSION,
    design_url: base + encodeURIComponent(DATA_FILE),
  };
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': types['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function safeAsset(urlPath) {
  const decoded = decodeURIComponent(urlPath.slice('/files/'.length));
  if (decoded.includes('\0') || decoded.includes('\\')) throw new Error('文件路径无效。');
  const candidate = path.resolve(workspace, decoded);
  const allowed = [projectRoot, exampleRoot, path.join(workspace, '公共资源')];
  if (!allowed.some(root => within(root, candidate))) throw new Error('文件超出资料目录。');
  const real = await fs.realpath(candidate);
  if (!allowed.some(root => within(root, real)) || !types[path.extname(real).toLowerCase()]) throw new Error('不支持的资料文件。');
  return real;
}

async function sendFile(req, res, file) {
  const stat = await fs.stat(file);
  const headers = { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
  let start = 0, end = stat.size - 1, status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); res.end(); return; }
    if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size }); res.end(); return; }
    status = 206; headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + stat.size;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1);
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || !stat.size) res.end();
  else createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}

export async function handleRequest(req, res) {
  if (!['127.0.0.1:' + port, 'localhost:' + port].includes(req.headers.host)) return json(res, 403, { error: '仅供本机阅读。' });
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
  try {
    const url = new URL(req.url, 'http://' + host + ':' + port);
    if (url.pathname === '/api/shutdown' && req.method === 'POST') {
      if (req.headers['x-storyboard-client'] !== 'local-launcher' ||
        (req.headers.origin && !['http://' + host + ':' + port, 'http://localhost:' + port].includes(req.headers.origin))) return json(res, 403, { error: '请求来源无效。' });
      json(res, 200, { stopped: true }); server.close(); server.closeIdleConnections(); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '阅读接口只接受读取请求。' });
    if (url.pathname === '/api/health') return json(res, 200, { app: 'director-reader', version: READER_VERSION, root: projectRoot });
    if (url.pathname === '/api/library') return json(res, 200, { chapters: await library() });
    if (url.pathname === '/api/chapter') return json(res, 200, await chapterData(url.searchParams.get('id') || 'example'));
    if (url.pathname.startsWith('/files/')) return await sendFile(req, res, await safeAsset(url.pathname));
    const routes = { '/': 'public/index.html', '/example': 'public/index.html',
      '/voices': 'public/voices.html', '/voices.js': 'public/voices.js', '/voices.css': 'public/voices.css',
      '/app.js': 'public/app.js', '/styles.css': 'public/styles.css',
      '/contract.mjs': 'contract.mjs', '/数据接口.md': '数据接口.md' };
    const target = routes[decodeURIComponent(url.pathname)];
    if (target) return await sendFile(req, res, path.join(appDir, target));
    return json(res, 404, { error: '页面不存在。请从阅读器首页选择章节。' });
  } catch (error) { return json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.message }); }
}

const server = http.createServer(handleRequest);
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log('导演阅读器 http://' + host + ':' + port + '/example'));
}
