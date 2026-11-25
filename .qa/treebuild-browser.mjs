/* eslint-disable */
/**
 * treebuild-browser.mjs —— 「JSON 数组 → 父子结构」集成版 · 真实浏览器端到端验证（QA 严过关）
 *
 * 运行（须在同一次 Bash 调用内先起服务）：
 *   NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost HTTPS_PROXY= HTTP_PROXY= \
 *     node .qa/treebuild-browser.mjs http://127.0.0.1:8898
 * 依赖：.qa/pw-loader.mjs（playwright-core）、Microsoft Edge（channel: msedge）。
 * 纪律：只读产品代码；仅写 .qa/treebuild-browser-results.json 与 docs/screenshots/10-parent-child-tree.png。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, PW_PATH } from './pw-loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOT = path.join(ROOT, 'docs', 'screenshots', '10-parent-child-tree.png');
const RESULTS = path.join(HERE, 'treebuild-browser-results.json');
const BASE = process.argv[2] || 'http://127.0.0.1:8898';
const TOOL_ID = 'convert-parent-child';

const report = {
  meta: {
    task: 'JSON 数组 → 父子结构 集成版 · 浏览器端到端验证',
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

const TREE_ROWS = [
  { id: 1, parentId: null, name: '总部', code: 'HQ' },
  { id: 2, parentId: 1, name: '技术中心', owner: '张三' },
  { id: 3, parentId: 1, name: '市场中心', owner: '李四' },
  { id: 4, parentId: 2, name: '前端组', size: 8 },
  { id: 6, parentId: 4, name: '平台小组', size: 3 },
  { id: 'root-ops', parentId: 'root', name: '运维中心' },
  { id: 9, parentId: 999, name: '孤儿节点' }
];
const TREE_JSON = JSON.stringify(TREE_ROWS, null, 2);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true
});
try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }); }
catch (e) { /* 某些环境不支持，复制用例内降级 */ }
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
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
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
    return { found: true, tag: c.tagName, type: c.type, value: c.type === 'checkbox' ? c.checked : c.value };
  }, { label, value });
}
async function clickRun() {
  await page.evaluate(() => {
    const b = document.querySelector('.jt-th-actions .jt-btn-primary');
    if (b) b.click();
  });
  await page.waitForTimeout(200);
}
async function readOut() {
  // 可折叠 JSON 视图把每行渲染为独立 .jt-cline，textContent 不含换行；需按行拼回原文。
  return norm(await page.evaluate(() => {
    const c = document.querySelector('section.jt-panel-view .jt-code');
    if (!c) return '';
    if (c.classList.contains('jt-code-lines')) {
      return Array.from(c.querySelectorAll('.jt-cline')).map(e => e.textContent).join('\n');
    }
    return c.textContent;
  }));
}
function parseOut(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (e) { return { ok: false, error: e.message }; }
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
    const status = document.querySelector('.jt-status-msg');
    return {
      visible: !!(bar && bar.style.display !== 'none'),
      text: bar ? bar.textContent : '',
      status: status ? status.textContent : ''
    };
  });
}
async function clickOutputAction(keyword) {
  return page.evaluate(kw => {
    const btns = Array.from(document.querySelectorAll('section.jt-panel-view .jt-panel-actions button'));
    const b = btns.find(x => (x.title || '').includes(kw));
    if (!b) return false;
    b.click();
    return true;
  }, keyword);
}
async function switchView(label) {
  await page.evaluate(lb => {
    const s = Array.from(document.querySelectorAll('section.jt-panel-view .jt-viewtoggle .jt-seg'))
      .find(x => x.textContent === lb);
    if (s) s.click();
  }, label);
  await page.waitForTimeout(220);
}
async function visibleTreeRows() {
  return page.evaluate(() => Array.from(document.querySelectorAll('section.jt-panel-view .jt-tree .jt-trow'))
    .filter(r => r.offsetParent !== null)
    .map(r => (r.querySelector('.jt-tkey') || {}).textContent + ':' + (r.querySelector('.jt-tval') || {}).textContent));
}

console.log('\n===== 浏览器端到端（B01–B24） =====');

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForSelector('.jt-workspace', { timeout: 10000 });
await page.waitForTimeout(400);

await runCase('B01', '首屏加载：71 个工具、新工具可见、无控制台错误', async () => {
  const nav = await page.locator('.jt-nav-item').count();
  const visible = await page.locator('.jt-nav-item[data-id="' + TOOL_ID + '"]').count();
  rec('B01a', '左栏工具数 = 71', nav === 71, '71', nav);
  rec('B01b', '新工具 convert-parent-child 在左栏可见',
    visible === 1 && (await page.locator('.jt-nav-item[data-id="' + TOOL_ID + '"]').innerText()).includes('父子结构'),
    '1 个节点且文案含"父子结构"', visible);
});

await runCase('B02', '进入工具：标题/描述/7 参数与默认值正确', async () => {
  await navTo(TOOL_ID);
  const st = await page.evaluate(() => ({
    name: (document.querySelector('.jt-th-name') || {}).textContent || '',
    desc: (document.querySelector('.jt-th-desc') || {}).textContent || '',
    params: Array.from(document.querySelectorAll('.jt-params .jt-param')).map(w => ({
      label: (w.querySelector('.jt-param-label') || {}).textContent || '',
      type: (w.querySelector('select') ? 'select'
        : w.querySelector('input[type=checkbox]') ? 'checkbox'
          : w.querySelector('input') ? 'text' : '?'),
      value: (() => {
        const c = w.querySelector('select, input');
        return !c ? '' : (c.type === 'checkbox' ? c.checked : c.value);
      })()
    }))
  }));
  rec('B02a', '工具标题与描述正确',
    st.name.includes('JSON 数组 → 父子结构') && st.desc.includes('ID'),
    '标题含工具名，描述含 ID', { name: st.name, desc: st.desc });
  rec('B02b', '7 个参数标签/类型/默认值正确',
    st.params.length === 7 &&
    st.params.map(p => p.label).join('|') === 'ID 字段名|父字段名|子节点字段名|重复 ID 处理|自动探测常见字段名|移除原父字段|保留其它字段' &&
    st.params.map(p => p.type).join('|') === 'text|text|text|select|checkbox|checkbox|checkbox' &&
    st.params.map(p => p.value).join('|') === 'id|parentId|children|first|true|false|true',
    '7 参数，默认 id/parentId/children/first/true/false/true', st.params);
});

// 拦截真实 toast 展示路径，捕获工具返回的全部 notices（避免 MAX_TOASTS=3 截断）
await page.evaluate(() => {
  window.__qaNotices = [];
  const t = window.JT && window.JT.toast;
  if (t && typeof t.show === 'function') {
    const orig = t.show;
    t.show = function (msg) { window.__qaNotices.push(String(msg)); return orig.apply(this, arguments); };
  } else {
    window.__qaNoticeHookFailed = true;
  }
});

await runCase('B03', '载入示例 → 执行 → 合法 JSON 与摘要 notices', async () => {
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('section.jt-panel-edit .jt-panel-actions button'))
      .find(x => (x.title || '').includes('载入示例'));
    if (b) b.click();
  });
  await page.waitForSelector('.jt-example', { timeout: 5000 });
  await page.evaluate(() => { const e = document.querySelector('.jt-example'); if (e) e.click(); });
  await page.waitForTimeout(320);
  const out = await readOut();
  const p = parseOut(out);
  const notices = await readNotices();
  rec('B03a', '示例（用户列表 3 项）执行后输出合法 JSON 数组',
    p.ok && Array.isArray(p.value) && p.value.length === 3 &&
    p.value.every(x => x && typeof x.id === 'number' && x.name),
    '3 元素数组且保留 id/name', { ok: p.ok, error: p.error, head: out.slice(0, 160) });
  rec('B03b', '摘要 notices 首条格式正确且无处理项',
    notices.length > 0 && notices[0].startsWith('构建完成 · 输入 3 项 / 有效 3 项 / 根 3 个 / 最大深度 1，自动处理 0 项。'),
    '构建完成 · 输入 3 项 / 有效 3 项 / 根 3 个 / 最大深度 1，自动处理 0 项。', notices);
});

await runCase('B04', '4 层链 + 3 根 + 1 孤儿：输出合法、结构正确、提示准确', async () => {
  await setInput(TREE_JSON);
  await clickRun();
  const out = await readOut();
  const p = parseOut(out);
  const roots = p.ok ? (Array.isArray(p.value) ? p.value : [p.value]) : [];
  const hq = roots.find(r => r && r.id === 1);
  const orphan = roots.find(r => r && r.id === 9);
  const ops = roots.find(r => r && r.id === 'root-ops');
  rec('B04a', 'JSON 合法且正好 3 根（含被提升的孤儿）',
    p.ok && roots.length === 3 && !!hq && !!orphan && !!ops,
    'roots=3，id 1/9/root-ops', { ok: p.ok, error: p.error, ids: roots.map(r => r && r.id) });
  rec('B04b', '链 1→2→4→6 四层且字段保留',
    !!hq && hq.children.length === 2 &&
    hq.children.find(c => c.id === 2).children[0].id === 4 &&
    hq.children.find(c => c.id === 2).children[0].children[0].id === 6 &&
    hq.name === '总部' && hq.code === 'HQ' &&
    hq.children.find(c => c.id === 2).children[0].children[0].size === 3 &&
    orphan.parentId === 999,
    '四层链正确，name/code/size 保留，孤儿仍带原 parentId=999',
    { chain: hq && hq.children.map(c => c.id), orphan });
  const notices = await readNotices();
  rec('B04c', '摘要数值与 [孤儿] 提示正确',
    notices[0] === '构建完成 · 输入 7 项 / 有效 7 项 / 根 3 个 / 最大深度 4，自动处理 1 项。' &&
    notices.some(n => n.startsWith('[孤儿] ') && n.includes('999')) &&
    notices.length === 2,
    '摘要 7/7/3/4/1 + 1 条 [孤儿] 提示', notices);
});

await runCase('B05', '树形视图可见层级并生成截图', async () => {
  await switchView('树形');
  // 树视图默认只展开到第 2/3 层（设计如此），点「全部展开」才能看到完整 4 层链。
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('section.jt-panel-view .jt-tree-bar-btn'))
      .find(x => x.textContent === '全部展开');
    if (b) b.click();
  });
  await page.waitForTimeout(260);
  const rows = await visibleTreeRows();
  const txt = rows.join(' | ');
  rec('B05a', '树形视图出现且层级节点可见',
    rows.length >= 10 && /总部/.test(txt) && /技术中心/.test(txt) &&
    /前端组/.test(txt) && /平台小组/.test(txt) && /孤儿节点/.test(txt),
    '≥10 行且含关键节点', { count: rows.length, sample: rows.slice(0, 8) });
  const written = await page.screenshot({ path: SHOT, fullPage: false });
  const bytes = fs.existsSync(SHOT) ? fs.statSync(SHOT).size : 0;
  report.screenshots.push({ file: SHOT, scene: '集成后真实工具界面 · 树形视图', bytes, returnedBytes: written.length });
  rec('B05b', 'docs/screenshots/10-parent-child-tree.png 已生成且 >5KB',
    bytes > 5000, '>5000 bytes', bytes);
  await switchView('文本');
});

await runCase('B06', '复制输出：剪贴板内容与输出一致（CRLF 归一化）', async () => {
  const out = await readOut();
  const clicked = await clickOutputAction('复制输出');
  await page.waitForTimeout(260);
  let clip = '';
  try { clip = norm(await page.evaluate(() => navigator.clipboard.readText())); }
  catch (e) { clip = '(读取失败:' + e.message + ')'; }
  rec('B06', '复制按钮可用且剪贴板等于输出文本',
    clicked && clip === out, '剪贴板 CRLF 归一化后与输出逐字一致',
    { clicked, clipLen: clip.length, outLen: out.length, head: clip.slice(0, 100) });
});

await runCase('B07', '下载输出：.json 文件存在且内容合法', async () => {
  const out = await readOut();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    clickOutputAction('下载输出')
  ]);
  const name = download.suggestedFilename();
  const tmp = path.join(HERE, '_qa-treebuild-download.json');
  try {
    await download.saveAs(tmp);
    const content = norm(fs.readFileSync(tmp, 'utf8'));
    const p = parseOut(content);
    rec('B07', '下载文件名 .json 且内容等于输出、可 JSON.parse',
      /\.json$/.test(name) && p.ok && JSON.stringify(p.value) === JSON.stringify(parseOut(out).value),
      '后缀 .json 且内容合法且与输出深等价', { name, len: content.length, ok: p.ok });
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
  }
});

await runCase('B08', '参数交互：duplicateStrategy 切换输出确实变化', async () => {
  const rows = [
    { id: 1, parentId: null, v: 'first' },
    { id: 1, parentId: null, v: 'last' },
    { id: 2, parentId: 1 }
  ];
  await setInput(JSON.stringify(rows));
  await setParam('重复 ID 处理', 'first');
  await clickRun();
  const f = parseOut(await readOut());
  const fn = await readNotices();
  await setParam('重复 ID 处理', 'last');
  await clickRun();
  const l = parseOut(await readOut());
  const ln = await readNotices();
  rec('B08', '两种策略 UI 输出不同且提示含保留首个/最后',
    f.ok && l.ok && f.value.v === 'first' && l.value.v === 'last' &&
    fn.some(n => n.includes('[重复]') && n.includes('保留首个')) &&
    ln.some(n => n.includes('[重复]') && n.includes('保留最后')),
    'v: first→last；提示分别含保留首个/保留最后',
    { f: f.value && f.value.v, l: l.value && l.value.v, fn, ln });
});

await runCase('B09', '参数交互：移除父字段 / 关闭保留其它字段', async () => {
  await setInput(TREE_JSON);
  await setParam('移除原父字段', true);
  await clickRun();
  const rm = parseOut(await readOut());
  const roots1 = Array.isArray(rm.value) ? rm.value : [rm.value];
  rec('B09a', '勾选移除父字段后输出无 parentId 且保留其它字段',
    rm.ok && roots1.every(r => r.parentId === undefined) &&
    roots1[0].name === '总部' && roots1[0].code === 'HQ',
    '全部根无 parentId，保留 name/code',
    { keys: Object.keys(roots1[0] || {}) });
  await setParam('移除原父字段', false);
  await setParam('保留其它字段', false);
  await clickRun();
  const other = parseOut(await readOut());
  const roots2 = Array.isArray(other.value) ? other.value : [other.value];
  const keys2 = Object.keys(roots2[0] || {});
  rec('B09b', '关闭保留其它字段后仅 id 与 children（父字段也不保留）',
    other.ok && keys2.sort().join(',') === 'children,id' &&
    roots2[0].name === undefined && roots2[0].parentId === undefined &&
    roots2[0].children[0].children[0].children[0].size === undefined,
    'keys=[children,id]，深层其它字段亦不保留',
    { keys: keys2, root: roots2[0] });
  await setParam('移除原父字段', false);
  await setParam('保留其它字段', true);
});

await runCase('B10', '参数交互：自定义 id/parent/children 字段名可执行', async () => {
  const rows = [
    { uid: 'r', par: null, label: '根' },
    { uid: 'c', par: 'r', label: '子' }
  ];
  await setInput(JSON.stringify(rows));
  const set1 = await setParam('ID 字段名', 'uid');
  const set2 = await setParam('父字段名', 'par');
  const set3 = await setParam('子节点字段名', 'items');
  await clickRun();
  const p = parseOut(await readOut());
  rec('B10', '自定义字段名输出为 uid/items 结构',
    set1.found && set2.found && set3.found &&
    p.ok && p.value.uid === 'r' && Array.isArray(p.value.items) &&
    p.value.items[0].uid === 'c' && p.value.children === undefined,
    'root.uid=r, items=[c], 无 children',
    { sets: [set1, set2, set3], data: p.value, error: p.error });
  await setParam('ID 字段名', 'id');
  await setParam('父字段名', 'parentId');
  await setParam('子节点字段名', 'children');
});

await runCase('B11', '边界 UI：非法 JSON → 中文错误条可见', async () => {
  await setInput('{ "a": 1, ');
  await clickRun();
  const e = await errState();
  rec('B11', '错误条可见且为中文解析提示',
    e.visible && /JSON|解析|错误|第/.test(e.text),
    '错误条可见且含中文提示', e);
});

await runCase('B12', '边界 UI：非数组 → 中文错误条可见', async () => {
  await setInput('{"a":1}');
  await clickRun();
  const e = await errState();
  rec('B12', '非数组错误条含"输入应为 JSON 数组"',
    e.visible && /输入应为 JSON 数组/.test(e.text),
    '错误条含"输入应为 JSON 数组"', e);
});

await runCase('B13', '边界 UI：空数组 → 中文错误条可见', async () => {
  await setInput('[]');
  await clickRun();
  const e = await errState();
  rec('B13', '空数组错误条含"输入数组为空"',
    e.visible && /输入数组为空/.test(e.text),
    '错误条含"输入数组为空"', e);
});

await runCase('B14', '边界 UI：循环引用 → 提示可见且输出仍合法', async () => {
  await setInput(JSON.stringify([
    { id: 'A', parentId: 'B' },
    { id: 'B', parentId: 'C' },
    { id: 'C', parentId: 'A' }
  ]));
  await clickRun();
  const p = parseOut(await readOut());
  const n = await readNotices();
  rec('B14', '循环有 [循环] 提示且输出含 __circularRef、JSON 合法',
    p.ok && p.value.__circularRef === true &&
    n.some(x => x.startsWith('[循环] ') && x.includes('→')),
    '合法 JSON + __circularRef + [循环] 提示含环路径', { ok: p.ok, value: p.value, notices: n });
});

await runCase('B15', '边界 UI：自引用 → 提示可见且输出仍合法', async () => {
  await setInput(JSON.stringify([{ id: 7, parentId: 7, name: '自环' }]));
  await clickRun();
  const p = parseOut(await readOut());
  const n = await readNotices();
  rec('B15', '自引用有 [自引用] 提示且该节点为根',
    p.ok && p.value.id === 7 && p.value.name === '自环' &&
    n.some(x => x.startsWith('[自引用] ') && x.includes('自身')),
    '合法 JSON 且节点为根 + [自引用] 提示', { ok: p.ok, value: p.value, notices: n });
});

await runCase('B16', '边界 UI：字段名为空 → 中文错误条可见', async () => {
  await setInput(TREE_JSON);
  const s = await setParam('ID 字段名', '   ');
  await clickRun();
  const e = await errState();
  rec('B16', '空字段名错误条含"字段名不能为空"',
    s.found && e.visible && /字段名不能为空/.test(e.text),
    '错误条含"字段名不能为空"', { s, e });
  await setParam('ID 字段名', 'id');
});

await runCase('B17', '边界 UI：字段名同名 → 中文错误条可见', async () => {
  const s = await setParam('父字段名', 'id');
  await clickRun();
  const e = await errState();
  rec('B17', '同名字段错误条含"不能相同"',
    s.found && e.visible && /不能相同/.test(e.text),
    '错误条含"不能相同"', { s, e });
  await setParam('父字段名', 'parentId');
});

await runCase('B18', '边界 UI：非法行跳过 → [跳过] 提示且输出合法', async () => {
  await setInput(JSON.stringify([null, 3, 'x', { id: 1, parentId: null, name: 'ok' }]));
  await clickRun();
  const p = parseOut(await readOut());
  const n = await readNotices();
  rec('B18', '3 条非法行被跳过且摘要含输入 4 / 有效 1 / 自动处理 3',
    p.ok && p.value.id === 1 &&
    n.some(x => x.startsWith('[跳过] ')) &&
    n[0].includes('输入 4 项 / 有效 1 项 / 根 1 个') &&
    n[0].includes('自动处理 3 项'),
    '[跳过] 提示 + 摘要 4/1/1/3', { ok: p.ok, value: p.value, notices: n });
});

await runCase('B19', '自动探测 UI：parent_id 字段被识别', async () => {
  await setInput(JSON.stringify([
    { id: 1, parent_id: null, name: '根' },
    { id: 2, parent_id: 1, name: '子' }
  ]));
  await clickRun();
  const p = parseOut(await readOut());
  const n = await readNotices();
  rec('B19', '默认 autoDetect=true 下识别 parent_id 并给 [探测] 提示',
    p.ok && p.value.id === 1 && p.value.children.length === 1 &&
    p.value.children[0].id === 2 && n.some(x => x.startsWith('[探测] ') && x.includes('parent_id')),
    '识别 parent_id 且子挂接成功，含 [探测] 提示', { ok: p.ok, value: p.value, notices: n });
});

await runCase('B20', '关闭自动探测 UI：parent_id 不被识别，两者均根', async () => {
  await setParam('自动探测常见字段名', false);
  await clickRun();
  const p = parseOut(await readOut());
  const n = await readNotices();
  rec('B20', 'autoDetect=false 时无探测提示且输出为 2 个根',
    p.ok && Array.isArray(p.value) && p.value.length === 2 &&
    !n.some(x => x.startsWith('[探测]')),
    '2 根且无 [探测] 提示', { ok: p.ok, value: p.value, notices: n });
  await setParam('自动探测常见字段名', true);
});

await runCase('B21', '刷新后草稿与工具选择保持（参数不丢）', async () => {
  await navTo(TOOL_ID);
  await setInput(TREE_JSON);
  await setParam('子节点字段名', 'kids');
  await page.waitForTimeout(150);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.jt-workspace', { timeout: 10000 });
  await page.waitForTimeout(300);
  await navTo(TOOL_ID);
  const state = await page.evaluate(() => ({
    tool: (document.querySelector('.jt-th-name') || {}).textContent || '',
    input: (document.querySelector('section.jt-panel-edit textarea') || {}).value || ''
  }));
  rec('B21', '刷新后重新进入工具，草稿已恢复',
    state.input.includes('"parentId"') && state.tool.includes('父子结构'),
    '草稿含 parentId 且工具为父子结构', { tool: state.tool.slice(0, 40), len: state.input.length });
  await setParam('子节点字段名', 'children');
});

await runCase('B22', '趟过全部 71 工具后返回本工具仍正常', async () => {
  const ids = await page.evaluate(() => window.JT.registry.tools.map(t => t.id));
  const bad = [];
  for (const id of ids) {
    try {
      await page.evaluate(tid => {
        const el = document.querySelector('.jt-nav-item[data-id="' + tid + '"]');
        if (el) el.click();
        const b = document.querySelector('.jt-th-actions .jt-btn-primary');
        if (b) b.click();
      }, id);
      await page.waitForTimeout(24);
    } catch (e) { bad.push(id + ':' + e.message); }
  }
  await navTo(TOOL_ID);
  const out = await readOut();
  rec('B22', '71 工具遍历无异常，返回本工具仍有输出',
    bad.length === 0 && out.length > 0,
    '0 异常且输出非空', { bad, outLen: out.length });
});

await runCase('B23', 'console error / pageerror / 失败请求 全为 0', async () => {
  rec('B23a', 'console error = 0', report.console.errors.length === 0,
    '0', report.console.errors);
  rec('B23b', 'pageerror = 0', report.console.pageErrors.length === 0,
    '0', report.console.pageErrors);
  rec('B23c', '失败请求与 4xx/5xx 响应 = 0',
    report.console.failedRequests.length === 0 && report.console.badResponses.length === 0,
    '0 / 0', { failed: report.console.failedRequests, bad: report.console.badResponses });
});

/* ===== 汇总与路由 ===== */
const total = report.assertions.length;
const passed = report.assertions.filter(a => a.passed).length;
const failed = report.assertions.filter(a => !a.passed);
report.summary = { total, passed, failed: failed.length };
report.routing = failed.length === 0 ? 'NoOne' : '待分析（见失败明细）';
report.verdict = failed.length === 0 ? 'PASS' : 'FAIL';
report.finishedAt = new Date().toISOString();

console.log('\n=== 浏览器端到端：通过 ' + passed + ' / ' + total + '，失败 ' + failed.length + ' ===');
if (failed.length) {
  console.log('失败明细：');
  failed.forEach(f => console.log('  [' + f.id + '] ' + f.name + ' | 期望=' + fmt(f.expected) + ' 实际=' + fmt(f.actual)));
}
console.log('路由判定：' + report.routing + '  最终判定：' + report.verdict);
fs.writeFileSync(RESULTS, JSON.stringify(report, null, 2), 'utf8');

const bail = setTimeout(() => { console.log('[warn] teardown 超时，结果已落盘'); process.exit(0); }, 8000);
try { await ctx.close(); } catch (e) { /* ignore */ }
try { await browser.close(); } catch (e) { /* ignore */ }
clearTimeout(bail);
process.exit(0);
