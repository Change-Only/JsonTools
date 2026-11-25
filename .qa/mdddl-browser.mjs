/* eslint-disable */
/**
 * mdddl-browser.mjs —— 「Markdown 表格 → 建表 DDL」真实浏览器端到端验证（QA 严过关）
 *
 * 运行（须在同一次 Bash 调用内先起服务）：
 *   NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost HTTPS_PROXY= HTTP_PROXY= \
 *     node .qa/mdddl-browser.mjs http://127.0.0.1:8898
 * 依赖：.qa/pw-loader.mjs（playwright-core）、Microsoft Edge（channel: msedge）。
 * 纪律：只读产品代码；仅写 .qa/mdddl-browser-results.json 与 docs/screenshots/11-markdown-ddl.png。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, PW_PATH } from './pw-loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOT = path.join(ROOT, 'docs', 'screenshots', '11-markdown-ddl.png');
const RESULTS = path.join(HERE, 'mdddl-browser-results.json');
const BASE = process.argv[2] || 'http://127.0.0.1:8898';
const TOOL_ID = 'convert-md-ddl';

const report = {
  meta: {
    task: 'Markdown 表格 → 建表 DDL · 浏览器端到端验证',
    qa: '严过关 (Yan) / software-qa-engineer',
    startedAt: new Date().toISOString(),
    baseURL: BASE,
    browser: 'Microsoft Edge (channel: msedge, headless)',
    nodeVersion: process.version,
    playwrightPath: PW_PATH
  },
  assertions: [],
  screenshots: [],
  console: { errors: [], pageErrors: [], failedRequests: [], badResponses: [] },
  defects: [],
  routing: '待判定',
  verdict: '待判定'
};

function fmt(v) {
  if (typeof v === 'string') return v.length > 900 ? v.slice(0, 900) + '…' : v;
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : (s.length > 900 ? s.slice(0, 900) + '…' : s);
  } catch (e) { return String(v); }
}
function rec(id, name, passed, expected, actual, note) {
  const item = { id, name, passed: !!passed, expected, actual: fmt(actual) };
  if (note !== undefined && note !== null) item.note = note;
  report.assertions.push(item);
  console.log('  ' + (passed ? '✓' : '✗') + ' [' + id + '] ' + name +
    (passed ? '' : ' | 期望=' + fmt(expected) + ' 实际=' + fmt(actual)));
  return !!passed;
}
async function runCase(id, name, fn) {
  try { await fn(); }
  catch (e) {
    rec(id, name, false, '测试正常执行且不抛异常',
      '抛异常: ' + (e && e.message ? e.message : String(e)));
  }
}
const norm = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const STD_MD = [
  '| 英文名称 | 类型 | 最大长度 | 是否非空 | 参数说明 |',
  '| --- | --- | --- | --- | --- |',
  '| user_name | varchar | 64 | 是 | 用户登录名 |',
  '| age | int |  | 否 | 年龄 |'
].join('\n');
const EN_ALIAS_MD = [
  '| name | type | length | not null | comment |',
  '| --- | --- | --- | --- | --- |',
  '| email | varchar | 128 | Y | 邮箱地址 |'
].join('\n');
const POS_FALLBACK_MD = [
  '| A | B | C | D | E |',
  '| --- | --- | --- | --- | --- |',
  '| col | varchar | 12 | 是 | 说明 |'
].join('\n');
const QUOTE_MD = [
  '| name | type | length | not null | comment |',
  '| --- | --- | --- | --- | --- |',
  '| c | varchar | 10 | 否 | it' + "'" + 's ok |'
].join('\n');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') report.console.errors.push(m.text()); });
page.on('pageerror', e => report.console.pageErrors.push(e.message));
page.on('requestfailed', r => report.console.failedRequests.push(r.url() + ' :: ' + (r.failure() && r.failure().errorText)));
page.on('response', r => { if (r.status() >= 400) report.console.badResponses.push(r.status() + ' :: ' + r.url()); });

/* ===== 页面公共操作 ===== */
async function navTo(id) {
  await page.evaluate(tid => {
    const el = document.querySelector('.jt-nav-item[data-id="' + tid + '"]');
    if (el) el.click();
  }, id);
  await page.waitForTimeout(220);
}
async function setInput(text) {
  await page.evaluate(t => {
    const el = document.querySelector('section.jt-panel-edit textarea');
    if (el) { el.value = t; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, text);
  await page.waitForTimeout(60);
}
async function setParam(label, value) {
  return page.evaluate(a => {
    const wraps = Array.from(document.querySelectorAll('section.jt-th-params .jt-param, .jt-params .jt-param'));
    const wrap = wraps.find(w => (w.querySelector('.jt-param-label') || {}).textContent === a.label);
    if (!wrap) return { found: false };
    const c = wrap.querySelector('select, input[type="text"], input[type="checkbox"], input[type="number"], textarea');
    if (!c) return { found: false, reason: '无控件' };
    if (c.type === 'checkbox') { c.checked = !!a.value; c.dispatchEvent(new Event('change', { bubbles: true })); }
    else { c.value = String(a.value); c.dispatchEvent(new Event(c.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }
    return { found: true, tag: c.tagName, type: c.type };
  }, { label, value });
}
async function setParams(obj) {
  const out = {};
  for (const k of Object.keys(obj)) out[k] = await setParam(k, obj[k]);
  return out;
}
async function clickRun() {
  await page.evaluate(() => {
    const b = document.querySelector('.jt-th-actions .jt-btn-primary');
    if (b) b.click();
  });
  await page.waitForTimeout(220);
}
async function readOut() {
  return norm(await page.evaluate(() => {
    const c = document.querySelector('section.jt-panel-view .jt-code');
    if (!c) return '';
    if (c.classList.contains('jt-code-lines')) {
      return Array.from(c.querySelectorAll('.jt-cline')).map(e => e.textContent).join('\n');
    }
    return c.textContent;
  }));
}
async function readNotices(clear = true) {
  const n = await page.evaluate(() => (window.__qaNotices || []).slice());
  if (clear) await page.evaluate(() => { window.__qaNotices = []; });
  return n;
}
async function errState() {
  return page.evaluate(() => {
    const p = document.querySelector('section.jt-panel-view');
    const bar = p && p.querySelector('.jt-errbar');
    const msg = bar && bar.querySelector('.jt-errbar-msg');
    const status = document.querySelector('.jt-status-msg');
    return {
      visible: !!(bar && bar.style.display !== 'none'),
      text: msg ? msg.textContent : (bar ? bar.textContent : ''),
      status: status ? status.textContent : ''
    };
  });
}
async function applyDefault(md) {
  await setParams({
    'Markdown 表格': md,
    '方言': 'mysql',
    '表名': 't_user',
    '主键字段名': '',
    '含字段注释': true,
    '字段命名风格': 'keep'
  });
}

console.log('\n===== 浏览器端到端（B01–B14） =====');
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForSelector('.jt-workspace', { timeout: 10000 });
await page.waitForTimeout(400);

// 拦截 toast，捕获 notices
await page.evaluate(() => {
  window.__qaNotices = [];
  const t = window.JT && window.JT.toast;
  if (t && typeof t.show === 'function') {
    const orig = t.show;
    t.show = function (msg) { window.__qaNotices.push(String(msg)); return orig.apply(this, arguments); };
  }
});

await runCase('B01', '首屏加载：71 个工具、目标工具可见、core 已加载', async () => {
  const st = await page.evaluate((tid) => ({
    nav: document.querySelectorAll('.jt-nav-item').length,
    visible: !!document.querySelector('.jt-nav-item[data-id="' + tid + '"]'),
    hasCore: !!(window.JTCore && window.JTCore.mdddl && typeof window.JTCore.mdddl.toDDL === 'function')
  }), TOOL_ID);
  rec('B01a', '左栏工具数 = 71', st.nav === 71, '71', st.nav);
  rec('B01b', 'convert-md-ddl 在左栏可见', st.visible, 'true', st.visible);
  rec('B01c', 'JTCore.mdddl 已加载', st.hasCore, 'true', st.hasCore);
  await navTo(TOOL_ID);
});

await runCase('B02', '参数面板：6 个参数标签/类型/默认值正确', async () => {
  const st = await page.evaluate(() => {
    const wraps = Array.from(document.querySelectorAll('.jt-params .jt-param'));
    return wraps.map(w => {
      const c = w.querySelector('select, input[type="text"], input[type="checkbox"], textarea');
      return {
        label: (w.querySelector('.jt-param-label') || {}).textContent,
        type: c ? (c.tagName === 'SELECT' ? 'select' : c.tagName === 'TEXTAREA' ? 'textarea' : c.type) : null,
        value: c ? (c.type === 'checkbox' ? String(c.checked) : c.value) : null
      };
    });
  });
  rec('B02a', '参数标签顺序正确',
    st.map(p => p.label).join('|') === 'Markdown 表格|方言|表名|主键字段名|含字段注释|字段命名风格',
    'Markdown 表格|方言|表名|主键字段名|含字段注释|字段命名风格', st.map(p => p.label));
  rec('B02b', '参数类型正确',
    st.map(p => p.type).join('|') === 'textarea|select|text|text|checkbox|select',
    'textarea|select|text|text|checkbox|select', st.map(p => p.type));
  rec('B02c', '默认值：方言 mysql / withComments true / nameStyle camel',
    st[1].value === 'mysql' && st[4].value === 'true' && st[5].value === 'camel',
    'mysql/true/camel', st.map(p => p.value));
});

await runCase('B03', 'MySQL 执行：头注释/反引号/类型/NOT NULL/行尾注释', async () => {
  await applyDefault(STD_MD);
  await clickRun();
  const out = await readOut();
  rec('B03a', '无错误条', !(await errState()).visible, '无错误', await errState());
  rec('B03b', 'MySQL 头注释', out.includes('-- MySQL 建表语句'), '含 MySQL 头注释', out.slice(0, 140));
  rec('B03c', '反引号 CREATE TABLE', out.includes('CREATE TABLE `t_user` ('), '反引号表名', out.slice(0, 140));
  rec('B03d', 'VARCHAR(64) + NOT NULL + 行尾注释',
    out.includes('`user_name` VARCHAR(64) NOT NULL  -- 用户登录名'),
    '`user_name` VARCHAR(64) NOT NULL  -- 用户登录名', out);
  rec('B03e', 'age 为 INT 且可空', out.includes('`age` INT') && !out.includes('`age` INT NOT NULL'), 'INT 且无 NOT NULL', out);
});

await runCase('B04', 'Oracle 执行：头注释/双引号/VARCHAR2/COMMENT ON COLUMN', async () => {
  await setParams({ '方言': 'oracle', '字段命名风格': 'keep' });
  await clickRun();
  const out = await readOut();
  rec('B04a', 'Oracle 头注释', out.includes('-- Oracle 建表语句'), '含 Oracle 头注释', out.slice(0, 140));
  rec('B04b', '双引号 CREATE TABLE', out.includes('CREATE TABLE "t_user" ('), '双引号表名', out.slice(0, 140));
  rec('B04c', 'VARCHAR2 列 + NOT NULL', out.includes('"user_name" VARCHAR2(64) NOT NULL'), 'VARCHAR2(64) NOT NULL', out);
  rec('B04d', 'COMMENT ON COLUMN 语句', out.includes('COMMENT ON COLUMN "t_user"."user_name" IS ' + "'用户登录名'" + ';'),
    'COMMENT ON COLUMN "t_user"."user_name" IS 用户登录名', out);
});

await runCase('B05', 'PostgreSQL 执行 + 单引号转义', async () => {
  await setParams({ '方言': 'postgresql', 'Markdown 表格': QUOTE_MD });
  await clickRun();
  const out = await readOut();
  rec('B05a', 'PG 头注释', out.includes('-- PostgreSQL 建表语句'), '含 PG 头注释', out.slice(0, 140));
  rec('B05b', '双引号列', out.includes('"c" VARCHAR(10)'), '双引号列', out);
  rec('B05c', '单引号转义为两个', out.includes("IS 'it''s ok';"), "IS 'it''s ok';", out);
  await setParams({ 'Markdown 表格': STD_MD });
  await clickRun();
});

await runCase('B06', '五种命名风格切换，列名随之变化', async () => {
  await setParams({ '方言': 'mysql', 'Markdown 表格': STD_MD });
  const cases = [
    ['camel', '`userName`'], ['snake', '`user_name`'], ['upper_snake', '`USER_NAME`'],
    ['pascal', '`UserName`'], ['keep', '`user_name`']
  ];
  for (const [style, col] of cases) {
    await setParam('字段命名风格', style);
    await clickRun();
    const out = await readOut();
    rec('B06-' + style, style + ' → ' + col, out.includes(col), col, out.slice(0, 180));
  }
});

await runCase('B07', 'withComments 勾选/取消控制注释有无', async () => {
  await setParams({ '方言': 'mysql', '字段命名风格': 'keep', 'Markdown 表格': STD_MD, '含字段注释': true });
  await clickRun();
  const on = await readOut();
  rec('B07a', '勾选时有行尾注释', on.includes('-- 用户登录名'), '含 -- 用户登录名', on.slice(0, 180));
  await setParam('含字段注释', false);
  await clickRun();
  const off = await readOut();
  rec('B07b', '取消后无注释', !off.includes('用户登录名') && !off.includes('年龄'), '无注释', off.slice(0, 180));
  await setParam('含字段注释', true);
});

await runCase('B08', '主键字段名：主仅在匹配列标记 PRIMARY KEY', async () => {
  await setParams({ '方言': 'mysql', '字段命名风格': 'snake', '主键字段名': 'user_name' });
  await clickRun();
  const out = await readOut();
  rec('B08a', '主键跨风格标记', out.includes('`user_name` VARCHAR(64) PRIMARY KEY'), 'PRIMARY KEY 标记', out);
  rec('B08b', '仅标一次', out.split('PRIMARY KEY').length - 1 === 1, '1 次', out);
  await setParam('主键字段名', '');
});

await runCase('B09', '英文别名表头可执行', async () => {
  await setParams({ 'Markdown 表格': EN_ALIAS_MD, '方言': 'mysql', '字段命名风格': 'keep' });
  await clickRun();
  const out = await readOut();
  rec('B09', 'name/type/length/not null/comment 表头产出 DDL',
    !!(await errState()).visible === false && out.includes('`email` VARCHAR(128) NOT NULL'),
    'email VARCHAR(128) NOT NULL 且无错误', { out: out.slice(0, 200), err: await errState() });
});

await runCase('B10', '位置回退表头可执行并提示', async () => {
  await page.evaluate(() => { window.__qaNotices = []; });
  await setParams({ 'Markdown 表格': POS_FALLBACK_MD });
  await clickRun();
  const out = await readOut();
  const notices = await readNotices();
  rec('B10a', '位置回退产出 DDL', out.includes('`col` VARCHAR(12) NOT NULL'), 'col VARCHAR(12) NOT NULL', out.slice(0, 200));
  rec('B10b', '位置回退 notice', notices.some(n => n.indexOf('按 5 列默认顺序') >= 0), '含回退提示', notices);
});

await runCase('B11', '非法表格显示中文错误条', async () => {
  await setParams({ 'Markdown 表格': '| A | B |\n| x | y |' });
  await clickRun();
  const er = await errState();
  rec('B11', '无法识别表头显示中文错误条',
    er.visible && er.text.indexOf('无法识别表头') >= 0,
    '错误条含「无法识别表头」', er);
});

await runCase('B12', '空输入显示中文错误条', async () => {
  await setInput(''); // 主输入区也清空，避免 mdTable 空时 run() 回退到 input
  await setParams({ 'Markdown 表格': '' });
  await clickRun();
  const er = await errState();
  rec('B12', '空输入显示中文错误条',
    er.visible && er.text.indexOf('输入为空') >= 0,
    '错误条含「输入为空」', er);
});

await runCase('B13', 'Oracle 输出界面截图', async () => {
  await setParams({ 'Markdown 表格': STD_MD, '方言': 'oracle', '表名': 't_user', '字段命名风格': 'keep', '含字段注释': true, '主键字段名': 'user_name' });
  await clickRun();
  const out = await readOut();
  rec('B13a', '截图前 Oracle DDL 正常', out.includes('-- Oracle 建表语句'), '含 Oracle DDL', out.slice(0, 140));
  await page.waitForTimeout(3400); // 等待前一用例的 toast 消失，保持截图干净
  const written = await page.screenshot({ path: SHOT, fullPage: false });
  const bytes = fs.existsSync(SHOT) ? fs.statSync(SHOT).size : 0;
  report.screenshots.push({ file: SHOT, scene: '真实工具界面 · 参数 + Oracle 输出', bytes, returnedBytes: written.length });
  rec('B13b', 'docs/screenshots/11-markdown-ddl.png 已生成且 >5KB', bytes > 5000, '>5000 bytes', bytes);
});

await runCase('B14', '控制台错误/页面异常/失败请求均为 0', async () => {
  const c = report.console;
  rec('B14a', 'console error = 0', c.errors.length === 0, '0', c.errors);
  rec('B14b', 'pageerror = 0', c.pageErrors.length === 0, '0', c.pageErrors);
  rec('B14c', '失败请求 = 0', c.failedRequests.length === 0, '0', c.failedRequests);
  rec('B14d', 'HTTP>=400 响应 = 0', c.badResponses.length === 0, '0', c.badResponses);
});

await browser.close();

/* ============================ 汇总输出 ============================ */
const passed = report.assertions.filter(a => a.passed).length;
const failed = report.assertions.length - passed;
const defects = report.assertions.filter(a => !a.passed).map(a => ({
  id: a.id, name: a.name, expected: a.expected, actual: a.actual
}));
report.defects = defects;
report.summary = { total: report.assertions.length, passed, failed };
report.routing = failed === 0 ? 'NoOne' : '待人工判定（区分源码 Bug / 测试 Bug）';
report.verdict = failed === 0 ? 'PASS' : 'FAIL';
report.finishedAt = new Date().toISOString();
fs.writeFileSync(RESULTS, JSON.stringify(report, null, 2), 'utf8');
console.log('\n================ Markdown DDL · 浏览器端到端 ================');
console.log('=== 通过 ' + passed + ' / 失败 ' + failed + ' ===');
if (failed) {
  console.log('\n--- 失败明细 ---');
  defects.forEach(d => console.log('[' + d.id + '] ' + d.name + '\n  期望=' + fmt(d.expected) + '\n  实际=' + fmt(d.actual)));
}
console.log('判定：' + report.verdict + '；路由：' + report.routing);
process.exitCode = failed ? 1 : 0;
