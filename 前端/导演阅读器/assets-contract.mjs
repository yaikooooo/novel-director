import path from 'node:path';
import fs from 'node:fs/promises';

export const ASSET_FILE = '03_资产交付.json';

// The 03 delivery is independent of the later shot/editing document.
export async function validateAssets(document, folder) {
  const issues = [];
  const add = (field, message) => issues.push({ field, message });
  if (document?.schema_version !== 1) add('schema_version', '资产交付版本须为1。');
  for (const key of ['title', 'chapter']) {
    if (!document?.[key]?.trim?.()) add(key, '缺少作品或章节名称。');
  }
  if (!['pending', 'approved'].includes(document?.review?.status)) add('review.status', '整套确认状态须为pending或approved。');
  if (document?.review?.status === 'approved' && !document.review.confirmation?.trim?.()) {
    add('review.confirmation', '已确认的整套交付须有用户确认依据。');
  }
  const refs = [[ 'reference_ref', document?.reference_ref, /\.md$/i ]];
  const characters = document?.characters;
  if (!Array.isArray(characters)) add('characters', '角色须为数组；无角色时用空数组。');
  const ids = new Set();
  for (const [index, character] of (Array.isArray(characters) ? characters : []).entries()) {
    const key = `characters[${index}]`;
    if (!character?.character_id || ids.has(character.character_id)) add(key + '.character_id', '角色标识缺失或重复。');
    ids.add(character?.character_id);
    if (!character?.name?.trim?.()) add(key + '.name', '缺少角色名。');
    const checkItem = (item, field, mediaKey, pattern) => {
      for (const name of ['label', 'status']) {
        if (!item?.[name]?.trim?.()) add(field + '.' + name, '缺少名称或现有审定状态。');
      }
      refs.push([field + '.' + mediaKey, item?.[mediaKey], pattern]);
    };
    checkItem(character?.mother, key + '.mother', 'image_ref', /\.(png|jpe?g|webp|svg)$/i);
    if (!Array.isArray(character?.variants)) add(key + '.variants', '本次变装须为数组；无变装时用空数组。');
    for (const [variantIndex, variant] of (Array.isArray(character?.variants) ? character.variants : []).entries()) {
      checkItem(variant, key + `.variants[${variantIndex}]`, 'image_ref', /\.(png|jpe?g|webp|svg)$/i);
      if (!variant?.scene?.trim?.()) add(key + `.variants[${variantIndex}].scene`, '变装须标明本次适用场次。');
    }
    checkItem(character?.voice, key + '.voice', 'audio_ref', /\.(wav|mp3|flac|ogg|m4a|aac)$/i);
  }
  const root = path.basename(folder) === '示例' ? folder : path.resolve(folder, '../..');
  for (const [field, ref, extension] of refs) {
    if (typeof ref !== 'string' || !ref || path.isAbsolute(ref) || /^[a-z]+:/i.test(ref) ||
        /(^|[\\/])临时([\\/]|$)/.test(ref) || !extension.test(ref)) {
      add(field, '须引用正式目录内对应类型的相对原件路径。'); continue;
    }
    try {
      const target = await fs.realpath(path.resolve(folder, ref));
      const rel = path.relative(root, target);
      if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('超出当前项目');
      if (!(await fs.stat(target)).isFile()) throw new Error('不是文件');
    } catch (error) { add(field, `原件不可读：${ref}（${error.message}）`); }
  }
  return issues;
}
