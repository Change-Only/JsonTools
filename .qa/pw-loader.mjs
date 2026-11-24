/* eslint-disable */
/**
 * pw-loader.mjs —— playwright-core 健壮加载器（QA 测试脚本公共设施）
 *
 * 背景：历史脚本把 playwright-core 硬编码在 $TEMP/jtb-pw 或 <root>/.build，
 * 本机实际安装在 ~/.workbuddy/binaries/node/<version>/workspace/node_modules。
 * 本模块按优先级探测所有已知位置，导出统一的 chromium，避免每个脚本各自硬编码。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOME = os.homedir();
const TEMP = process.env.TEMP || process.env.TMP || '/tmp';

function findWorkspacePw() {
  const base = path.join(HOME, '.workbuddy', 'binaries', 'node');
  if (!fs.existsSync(base)) return null;
  try {
    for (const d of fs.readdirSync(base)) {
      const c = path.join(base, d, 'workspace', 'node_modules', 'playwright-core', 'index.mjs');
      if (fs.existsSync(c)) return c;
    }
  } catch (e) { /* ignore */ }
  return null;
}

const candidates = [
  path.join(TEMP, 'jtb-pw', 'node_modules', 'playwright-core', 'index.mjs'),
  path.resolve(process.cwd(), '.build', 'node_modules', 'playwright-core', 'index.mjs'),
  findWorkspacePw(),
  path.join(HOME, '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'playwright-core', 'index.mjs')
].filter(Boolean);

let mod = null;
let loaded = '';
for (const c of candidates) {
  try {
    if (fs.existsSync(c)) { mod = await import(pathToFileURL(c).href); loaded = c; break; }
  } catch (e) { /* 尝试下一个候选 */ }
}
if (!mod) throw new Error('未找到 playwright-core，尝试过：\n' + candidates.join('\n'));

export const chromium = mod.chromium;
export const PW_PATH = loaded;
