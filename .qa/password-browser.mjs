/* eslint-disable */
/**
 * password-browser.mjs —— 密码生成器 + Oracle DDL 真实浏览器端到端专项
 * 运行（需先起服务，同一次调用内）：node .qa/password-browser.mjs [baseURL]
 * 截图输出：docs/screenshots/07-password-generator.png、08-oracle-ddl.png
 * 结果输出：.qa/password-browser-results.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './pw-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = process.argv[2] || 'http://127.0.0.1:8898';
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function rec(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  ::  ' + String(detail).slice(0, 240) : ''));
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('response', (r) => { if (r.status() >= 400) consoleErrors.push('HTTP ' + r.status() + ' ' + r.url()); });
page.on('requestfailed', (r) => consoleErrors.push('requestfailed: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(700);

/* 注入 QA 辅助 API（按参数标签定位控件，避免脆弱的索引依赖） */
await page.evaluate(() => {
  window.__qa = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    open: (id) => { const el = document.querySelector('.jt-nav-item[data-id="' + id + '"]'); if (!el) return false; el.click(); return true; },
    run: () => { const b = document.querySelector('.jt-th-actions .jt-btn-primary'); if (!b) return false; b.click(); return true; },
    out: () => { const c = document.querySelector('section.jt-panel-view .jt-code'); return c ? c.textContent : ''; },
    status: () => { const s = document.querySelector('.jt-status-msg'); return s ? s.textContent : ''; },
    errVisible: () => { const e = document.querySelector('section.jt-panel-view .jt-errbar'); return !!(e && e.style.display !== 'none'); },
    param: function (label) {
      return Array.from(document.querySelectorAll('.jt-param')).find((w) => {
        const l = w.querySelector('.jt-param-label');
        return l && l.textContent.indexOf(label) >= 0;
      });
    },
    setSelect: function (label, value) {
      const w = this.param(label), s = w && w.querySelector('select');
      if (!s) return false;
      s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); return true;
    },
    setText: function (label, value) {
      const w = this.param(label), t = w && w.querySelector('input[type=text], input[type=number], textarea');
      if (!t) return false;
      t.value = value; t.dispatchEvent(new Event('input', { bubbles: true })); return true;
    },
    setChk: function (label, on) {
      const w = this.param(label), c = w && w.querySelector('input[type=checkbox]');
      if (!c) return false;
      c.checked = !!on; c.dispatchEvent(new Event('change', { bubbles: true })); return true;
    },
    setInput: (value) => { const t = document.querySelector('section.jt-panel-edit textarea'); if (!t) return false; t.value = value; t.dispatchEvent(new Event('input', { bubbles: true })); return true; },
    paramTypes: () => Array.from(document.querySelectorAll('.jt-param')).map((w) => {
      const l = w.querySelector('.jt-param-label'), c = w.querySelector('select, input, textarea');
      return { label: l ? l.textContent : '', ctrl: c ? (c.tagName.toLowerCase() + (c.type ? ':' + c.type : '')) : '' };
    })
  };
});

/* ============================ 1. 首屏与工具可见性 ============================ */
const init = await page.evaluate(() => ({
  nav: document.querySelectorAll('.jt-nav-item').length,
  hasPwd: !!document.querySelector('.jt-nav-item[data-id="utility-password"]'),
  hasDDL: !!document.querySelector('.jt-nav-item[data-id="convert-ddl"]'),
  core: !!(window.JTCore && window.JTCore.password && typeof window.JTCore.password.generate === 'function')
}));
rec('首屏工具项总数 = 69', init.nav === 69, 'nav=' + init.nav);
rec('密码生成器工具在导航可见', init.hasPwd);
rec('JSON→建表 DDL 工具在导航可见', init.hasDDL);
rec('password.js core 已在浏览器加载', init.core);

/* ============================ 2. 密码生成器端到端 ============================ */
const STRONG = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])[A-Za-z0-9!@#$%^&*]{12,16}$/;
async function runPwd(actions) {
  return await page.evaluate(async (acts) => {
    const q = window.__qa;
    if (!q.open('utility-password')) return { open: false };
    await q.sleep(90);
    for (const a of acts) {
      if (a[0] === 'select') q.setSelect(a[1], a[2]);
      else if (a[0] === 'text') q.setText(a[1], a[2]);
      else if (a[0] === 'chk') q.setChk(a[1], a[2]);
    }
    q.run();
    await q.sleep(240);
    return { open: true, out: q.out(), status: q.status(), err: q.errVisible(), types: q.paramTypes() };
  }, actions);
}

const p1 = await runPwd([]);
const l1 = p1.out.split('\n').filter((x) => x.trim());
rec('密码生成器可打开并执行', p1.open && !p1.err, p1.status);
rec('默认模板输出 5 行', l1.length === 5, JSON.stringify(l1));
rec('默认模板每行符合强密码规则', l1.length === 5 && l1.every((l) => STRONG.test(l)), l1.join(' | '));
rec('默认模板 5 行无重复', new Set(l1).size === 5, l1.join(' | '));
rec('默认执行状态栏成功', p1.status.indexOf('执行成功') >= 0, p1.status);
const ptypes = p1.types.map((t) => t.ctrl);
rec('参数控件类型: 模板/自定义/数量/排除', ptypes.length === 4 && /select/.test(ptypes[0]) && /textarea/.test(ptypes[1]) && /number/.test(ptypes[2]) && /checkbox/.test(ptypes[3]), JSON.stringify(p1.types));
await page.screenshot({ path: path.join(SHOTS, '07-password-generator.png') });

const p2 = await runPwd([['select', '规则模板', 'pin']]);
const l2 = p2.out.split('\n').filter((x) => x.trim());
rec('pin 模板输出 5 行且均为 6 位数字', l2.length === 5 && l2.every((l) => /^\d{6}$/.test(l)), l2.join(' | '));

const p3 = await runPwd([['select', '规则模板', 'hex']]);
const l3 = p3.out.split('\n').filter((x) => x.trim());
rec('hex 模板输出 5 行且均为 32 位十六进制', l3.length === 5 && l3.every((l) => /^[0-9a-f]{32}$/.test(l)), l3.join(' | '));

const p4 = await runPwd([['text', '自定义正则', '[A-HJ-NP-Z2-9]{10}']]);
const l4 = p4.out.split('\n').filter((x) => x.trim());
rec('自定义正则输出 5 行且匹配', l4.length === 5 && l4.every((l) => /^[A-HJ-NP-Z2-9]{10}$/.test(l)), l4.join(' | '));

const p5 = await runPwd([['chk', '排除易混淆', true]]);
const l5 = p5.out.split('\n').filter((x) => x.trim());
rec('排除易混淆：输出 5 行', l5.length === 5, l5.join(' | '));
rec('排除易混淆：不含 0Oo1lI|', l5.every((l) => !/[0Oo1lI|]/.test(l)), l5.join(' | '));
rec('排除易混淆：仍符合强密码规则', l5.every((l) => STRONG.test(l)), l5.join(' | '));

const p6 = await runPwd([['text', '生成数量', '3']]);
const l6 = p6.out.split('\n').filter((x) => x.trim());
rec('count=3 输出恰好 3 行', l6.length === 3, l6.join(' | '));
rec('count=3 每行仍符合强密码规则', l6.every((l) => STRONG.test(l)));

const p7 = await runPwd([['text', '自定义正则', '(?!)']]);
rec('矛盾正则：不产生空白输出', p7.out.trim() === '', p7.out);
rec('矛盾正则：状态栏显示错误而非成功', p7.status.indexOf('执行成功') < 0 && p7.status.length > 0, p7.status);

/* ============================ 3. DDL Oracle + 命名风格端到端 ============================ */
const DDL_INPUT = JSON.stringify({
  id: 1,
  userName: '张三',
  user_id: 2,
  HTTPCode: 200,
  'created-at': '2024-01-01',
  updatedAt: '2024-01-01T10:00:00Z',
  active: true,
  score: 3.5,
  tags: ['a', 'b'],
  profile: { city: '深圳' }
}, null, 2);
async function runDdl(actions) {
  return await page.evaluate(async ({ acts, input }) => {
    const q = window.__qa;
    if (!q.open('convert-ddl')) return { open: false };
    await q.sleep(90);
    q.setInput(input);
    for (const a of acts) {
      if (a[0] === 'select') q.setSelect(a[1], a[2]);
      else if (a[0] === 'text') q.setText(a[1], a[2]);
      else if (a[0] === 'chk') q.setChk(a[1], a[2]);
    }
    q.run();
    await q.sleep(260);
    return { open: true, out: q.out(), status: q.status(), err: q.errVisible(), types: q.paramTypes() };
  }, { acts: actions, input: DDL_INPUT });
}

const STYLE_COLS = {
  snake: ['"user_name"', '"created_at"', '"http_code"', '"updated_at"'],
  camel: ['"userName"', '"createdAt"', '"hTTPCode"', '"updatedAt"'],
  pascal: ['"UserName"', '"CreatedAt"', '"HTTPCode"', '"UpdatedAt"'],
  keep: ['"userName"', '"created-at"', '"HTTPCode"', '"updatedAt"']
};
const ORA_TYPES = ['NUMBER(10)', 'NUMBER(1)', 'NUMBER', 'VARCHAR2(255)', 'DATE', 'TIMESTAMP', 'CLOB'];
for (const style of Object.keys(STYLE_COLS)) {
  const d = await runDdl([['select', '方言', 'oracle'], ['select', '字段命名风格', style], ['text', '主键字段名', 'id']]);
  rec('Oracle/' + style + ' 可执行无错误', d.open && !d.err && d.status.indexOf('执行成功') >= 0, d.status);
  rec('Oracle/' + style + ' 头注释正确', d.out.indexOf('-- Oracle 建表语句') === 0, d.out.split('\n')[0]);
  rec('Oracle/' + style + ' 双引号表名', /CREATE TABLE "my_table" \(/.test(d.out), d.out.slice(0, 100));
  const missingCols = STYLE_COLS[style].filter((c) => d.out.indexOf(c + ' ') < 0);
  rec('Oracle/' + style + ' 列名符合风格 ' + STYLE_COLS[style].join(','), missingCols.length === 0, '缺失=' + missingCols.join(','));
  const missingTypes = ORA_TYPES.filter((t) => d.out.indexOf(' ' + t) < 0);
  rec('Oracle/' + style + ' Oracle 类型齐全', missingTypes.length === 0, '缺失=' + missingTypes.join(','));
  rec('Oracle/' + style + ' 无 MySQL/PG 专有类型', !/TINYINT|DATETIME|JSONB|DOUBLE PRECISION/.test(d.out));
  rec('Oracle/' + style + ' PRIMARY KEY 仅一次', (d.out.match(/PRIMARY KEY/g) || []).length === 1, d.out);
  if (style === 'snake') await page.screenshot({ path: path.join(SHOTS, '08-oracle-ddl.png') });
}

const dm = await runDdl([['select', '方言', 'mysql'], ['select', '字段命名风格', 'snake'], ['text', '主键字段名', 'id']]);
rec('MySQL 回归：头注释正确', dm.out.indexOf('-- MySQL 建表语句') === 0, dm.out.split('\n')[0]);
rec('MySQL 回归：反引号标识符', /`user_name`/.test(dm.out), dm.out.slice(0, 200));
rec('MySQL 回归：boolean → TINYINT(1)', /`active` TINYINT\(1\)/.test(dm.out), dm.out);
rec('MySQL 回归：date-time → DATETIME', /`updated_at` DATETIME/.test(dm.out), dm.out);
rec('MySQL 回归：数组 → JSON', /`tags` JSON/.test(dm.out), dm.out);
rec('MySQL 回归：无 Oracle 类型', !/VARCHAR2|NUMBER\(/.test(dm.out), dm.out);

/* ============================ 4. console error 与汇总 ============================ */
rec('真实浏览器 console error = 0', consoleErrors.length === 0, consoleErrors.join(' | '));
await browser.close();

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
fs.writeFileSync(path.join(__dirname, 'password-browser-results.json'), JSON.stringify({ summary: { total: results.length, passed, failed }, base: BASE, consoleErrors, results }, null, 2), 'utf8');
console.log('\n================ 密码/Oracle DDL 浏览器专项 ================');
console.log('=== 通过 ' + passed + ' / 失败 ' + failed + ' ===');
if (failed) {
  console.log('--- 失败明细 ---');
  results.filter((r) => !r.pass).forEach((r) => console.log(r.name + ' :: ' + r.detail));
}
