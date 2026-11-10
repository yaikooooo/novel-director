import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DATA_FILE, frameCounts, validateDesign, validateMotion } from './contract.mjs';
import { validateFiles } from './server.mjs';

const folder = process.argv[2] ? path.resolve(process.argv[2]) :
  path.join(path.dirname(fileURLToPath(import.meta.url)), '示例');
try {
  const document = JSON.parse((await fs.readFile(path.join(folder, DATA_FILE), 'utf8')).replace(/^\uFEFF/, ''));
  const issues = [...validateDesign(document), ...validateMotion(document), ...await validateFiles(document, folder)];
  console.log(JSON.stringify({ chapter: document.design?.project?.chapter,
    counts: frameCounts(document), valid: issues.length === 0, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
