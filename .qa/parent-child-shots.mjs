/* eslint-disable */
/**
 * 仅重拍验收截图：不执行断言、不修改产品代码。
 * 目的：去掉快速连续测试导致的瞬时 toast 堆叠，让截图更适合用户验收。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './pw-loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'prototype', 'screenshots');
const URL = 'file:///' + path.join(ROOT, 'prototype', 'parent-child-tree.html').replace(/\\/g, '/');
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(URL, { waitUntil: 'load' });
await page.evaluate(() => { try { localStorage.setItem('jtc-prototype-theme', 'light'); } catch (e) {} });
await page.reload({ waitUntil: 'load' });

async function clearToasts() {
  await page.evaluate(() => {
    document.querySelectorAll('.jt-toast').forEach(t => t.click());
    document.querySelectorAll('.jt-toast').forEach(t => { if (t.parentNode) t.parentNode.removeChild(t); });
  });
  await page.waitForTimeout(100);
}
async function shot(name, scene) {
  await clearToasts();
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log(name + ' -> ' + fs.statSync(file).size + ' bytes (' + scene + ')');
  return { file, scene, bytes: fs.statSync(file).size };
}
async function runWait() {
  await page.click('#runBtn');
  await page.waitForFunction(() => {
    const t = document.getElementById('statusMsg').textContent;
    return t.includes('构建完成') || t.includes('构建失败');
  }, null, { timeout: 15000 });
}
async function setInput(text) {
  await page.evaluate(t => {
    const el = document.getElementById('input');
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

const meta = [];
meta.push(await shot('01-initial.png', '初始态'));

await page.click('#loadExample');
await page.waitForFunction(() => document.getElementById('statusMsg').textContent.includes('构建完成'), null, { timeout: 15000 });
await page.click('#segTree');
await page.click('#expandAll');
meta.push(await shot('02-result-tree.png', '示例结果树形视图'));

const boundary = [
  { id: 'A', parentId: 'B', name: '循环A' },
  { id: 'B', parentId: 'A', name: '循环B' },
  { id: 'S', parentId: 'S', name: '自引用' },
  { id: 'O', parentId: 999, name: '孤儿' }
];
await setInput(JSON.stringify(boundary, null, 2));
await runWait();
await page.click('#segTree');
await page.click('#expandAll');
meta.push(await shot('03-boundary.png', '循环/自引用/孤儿边界提示'));

await page.click('#themeBtn');
await page.click('#loadExample');
await page.waitForFunction(() => document.getElementById('statusMsg').textContent.includes('构建完成'), null, { timeout: 15000 });
await page.click('#segTree');
await page.click('#expandAll');
meta.push(await shot('04-dark.png', '深色主题 + 示例树'));

// 同步结果文件中的截图字节数（仅更新截图元数据，不触碰任何断言与判定）
const resultsPath = path.join(HERE, 'parent-child-results.json');
if (fs.existsSync(resultsPath)) {
  const r = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  r.screenshots = meta.map(m => ({ file: m.file, scene: m.scene, bytes: m.bytes }));
  r.meta.screenshotRefreshNote = 'Round2 全部断言通过后，用独立截图脚本重拍 4 张截图以去除瞬时 toast 堆叠；未改动任何断言/判定。';
  fs.writeFileSync(resultsPath, JSON.stringify(r, null, 2), 'utf8');
  console.log('已同步截图元数据到 parent-child-results.json');
}
await browser.close();
