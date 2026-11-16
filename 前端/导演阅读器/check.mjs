import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DATA_FILE, frameCounts, validateDesign, validateMotion } from './contract.mjs';
import { validateFiles } from './server.mjs';
import { ASSET_FILE, validateAssets } from './assets-contract.mjs';

const folder = process.argv[2] ? path.resolve(process.argv[2]) :
  path.join(path.dirname(fileURLToPath(import.meta.url)), '示例');
try {
  const read = async name => {
    try { return JSON.parse((await fs.readFile(path.join(folder, name), 'utf8')).replace(/^\uFEFF/, '')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const [document, assets] = await Promise.all([read(DATA_FILE), read(ASSET_FILE)]);
  if (!document && !assets) throw new Error('未找到03资产交付或05拍摄设计数据。');
  const issues = document ? [...validateDesign(document), ...validateMotion(document), ...await validateFiles(document, folder)] : [];
  if (assets) issues.push(...await validateAssets(assets, folder));
  console.log(JSON.stringify({ chapter: document?.design?.project?.chapter || assets?.chapter,
    ...(assets ? { assets: { characters: assets.characters?.length, review: assets.review?.status } } : {}),
    counts: frameCounts(document), valid: issues.length === 0, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
