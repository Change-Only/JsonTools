/* eslint-disable */
/**
 * parent-child-check.mjs —— 「JSON 数组 → 父子结构重建」HTML 原型独立验收测试
 *
 * QA: 严过关（Yan） / software-qa-engineer
 * 目标：证伪式验证。A 层直接调用 window.ParentChildTreePrototype 暴露的核心 API；
 *       B 层用 playwright + Edge 打开 file:// 原型做真实交互验收与截图。
 * 纪律：只读 prototype HTML；仅写 .qa/ 结果文件与 prototype/screenshots/ 截图。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, PW_PATH } from './pw-loader.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const HTML_PATH = path.join(ROOT, 'prototype', 'parent-child-tree.html');
const PAGE_URL = 'file:///' + HTML_PATH.replace(/\\/g, '/');
const SHOTS = path.join(ROOT, 'prototype', 'screenshots');
const RESULTS = path.join(HERE, 'parent-child-results.json');

fs.mkdirSync(SHOTS, { recursive: true });

const results = {
  meta: {
    task: '父子结构重建 HTML 原型独立验收',
    qa: '严过关 (Yan) / software-qa-engineer',
    startedAt: new Date().toISOString(),
    nodeVersion: process.version,
    playwrightPath: PW_PATH,
    browser: 'Microsoft Edge (channel: msedge)',
    url: PAGE_URL,
    rounds: 2,
    roundNotes: 'Round1: 56 项中 4 项失败，经逐条核对均为测试脚本自身断言/夹具错误（循环后链序、parentId=0 根标记夹具、uid 索引、CSS flex 百分比解析），非源码缺陷；已自行修复并执行 Round2 回归。'
  },
  layers: { A: [], B: [] },
  assertions: [],
  defects: [],
  performance: {},
  screenshots: [],
  routing: '待分析',
  verdict: '待分析'
};

function fmt(v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

function record(layer, id, name, passed, expected, actual, note) {
  const item = { layer, id, name, passed: !!passed, expected, actual };
  if (note !== undefined && note !== null) item.note = note;
  results.assertions.push(item);
  results.layers[layer].push(item);
  console.log('  ' + (passed ? '\u2713' : '\u2717') + ' [' + id + '] ' + name +
    (passed ? '' : ' | 期望=' + fmt(expected) + ' 实际=' + fmt(actual)));
  return !!passed;
}

async function runCase(layer, id, name, fn) {
  try {
    await fn();
  } catch (e) {
    record(layer, id, name, false, '测试正常执行且不抛异常',
      '抛异常: ' + (e && e.message ? e.message : String(e)));
  }
}

function norm(s) { return String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true
});
try { await context.grantPermissions(['clipboard-read', 'clipboard-write']); } catch (e) { /* file:// 可能不支持，测试内降级 */ }
const page = await context.newPage();
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(e.message));
page.on('requestfailed', r => failedRequests.push(r.url() + ' :: ' + (r.failure() && r.failure().errorText)));

await page.goto(PAGE_URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.ParentChildTreePrototype, null, { timeout: 10000 });

/* ------------------------------------------------------------------
 * B01 / B02：初始态（先截图，避免载入示例后污染）
 * ---------------------------------------------------------------- */
await runCase('B', 'B01', '页面初始加载无 console error / pageerror', async () => {
  record('B', 'B01', '页面初始加载无 console error / pageerror',
    consoleErrors.length === 0 && pageErrors.length === 0,
    'console error = 0 且 pageerror = 0',
    { consoleErrors, pageErrors });
});

await runCase('B', 'B02', '初始态截图', async () => {
  const file = path.join(SHOTS, '01-initial.png');
  await page.screenshot({ path: file, fullPage: false });
  const ok = fs.existsSync(file) && fs.statSync(file).size > 5000;
  results.screenshots.push({ file, scene: '初始态', bytes: fs.existsSync(file) ? fs.statSync(file).size : 0 });
  record('B', 'B02', '初始态截图 01-initial.png 生成', ok, '文件存在且 > 5KB',
    fs.existsSync(file) ? fs.statSync(file).size + ' bytes' : '不存在');
});

/* ------------------------------------------------------------------
 * A 层：核心算法专项（直接调用暴露 API，非 UI 路径）
 * ---------------------------------------------------------------- */
await page.evaluate(() => {
  const P = window.ParentChildTreePrototype;
  const DEFAULTS = {
    idField: 'id', parentField: 'parentId', childrenField: 'children',
    autoDetect: false, removeParent: false, keepOther: true, dupMode: 'first'
  };
  window.__qaBuild = function (rows, opts) {
    const r = P.buildTree(rows, Object.assign({}, DEFAULTS, opts || {}));
    return {
      roots: r.roots,
      issues: r.issues,
      stats: r.stats,
      fields: r.meta.fields,
      outputText: r.meta.outputText,
      outputValue: r.meta.outputValue,
      flags: r.meta.roots.map(function (n) {
        return {
          key: n.key, circular: n.circular, orphan: n.orphan,
          selfRef: n.selfRef, depth: n.depth, path: n.path,
          children: n.children.map(function (c) { return c.key; })
        };
      })
    };
  };
  window.__qaBuildRaw = function (rows, opts) {
    try {
      const r = P.buildTree(rows, Object.assign({}, DEFAULTS, opts || {}));
      return { threw: false, stats: r.stats, outputText: r.meta.outputText };
    } catch (e) {
      return { threw: true, message: e && e.message ? e.message : String(e) };
    }
  };
});

async function qaBuild(rows, opts) { return page.evaluate(a => window.__qaBuild(a.rows, a.opts), { rows, opts: opts || {} }); }
async function qaBuildRaw(rows, opts) { return page.evaluate(a => window.__qaBuildRaw(a.rows, a.opts), { rows, opts: opts || {} }); }

const NORMAL_ROWS = [
  { id: 1, parentId: null, name: '总部', code: 'HQ' },
  { id: 2, parentId: 1, name: '技术中心', owner: '张三' },
  { id: 3, parentId: 1, name: '市场中心', owner: '李四' },
  { id: 4, parentId: 2, name: '前端组', size: 8 }
];

await runCase('A', 'A01', '正常 3 层树：roots / children / 顺序 / 深度', async () => {
  const r = await qaBuild(NORMAL_ROWS);
  record('A', 'A01', '正常树结构正确',
    r.roots.length === 1 && r.roots[0].id === 1 &&
    r.roots[0].children.length === 2 &&
    r.roots[0].children[0].id === 2 && r.roots[0].children[1].id === 3 &&
    r.roots[0].children[0].children.length === 1 &&
    r.roots[0].children[0].children[0].id === 4 &&
    r.roots[0].children[1].children.length === 0,
    '根=1，1 的子=[2,3]，2 的子=[4]，3 无子',
    { roots: r.roots.length, tree: r.roots[0] });
  record('A', 'A02', '统计与其它字段保留正确',
    r.stats.maxDepth === 3 && r.stats.roots === 1 && r.stats.total === 4 &&
    r.stats.valid === 4 && r.stats.skipped === 0 && r.issues.length === 0 &&
    r.roots[0].name === '总部' && r.roots[0].code === 'HQ' &&
    r.roots[0].children[0].owner === '张三' && r.roots[0].children[0].children[0].size === 8,
    'maxDepth=3 / roots=1 / total=4 / issues=0 / name,code,owner,size 保留',
    { stats: r.stats, issues: r.issues, name: r.roots[0].name, owner: r.roots[0].children[0].owner });
});

await runCase('A', 'A03', '混合 id 类型：数字 1 与字符串 "1" 统一为同一 String 键', async () => {
  const rows = [
    { id: 1, parentId: null, name: '根' },
    { id: '1', parentId: 1, name: '重复字符串' },
    { id: 2, parentId: '1', name: '按字符串父引用挂接' }
  ];
  const first = await qaBuild(rows, { dupMode: 'first' });
  record('A', 'A03a', '保留首个：id:2 挂到由数字 id:1 建立的键 "1"',
    first.roots.length === 1 && first.roots[0].id === 1 &&
    first.roots[0].children.length === 1 && first.roots[0].children[0].id === 2 &&
    first.stats.duplicates === 1 && first.stats.skipped === 1,
    'root.id=1, children=[2], duplicates=1, skipped=1',
    { roots: first.roots.length, root: first.roots[0], stats: first.stats });
  const last = await qaBuild(rows, { dupMode: 'last' });
  record('A', 'A03b', '保留最后：id:2 挂到由字符串 id:"1" 覆盖后的键 "1"',
    last.roots.length === 1 && last.roots[0].id === '1' &&
    last.roots[0].children.length === 1 && last.roots[0].children[0].id === 2 &&
    last.stats.duplicates === 1,
    'root.id="1", children=[2], duplicates=1',
    { roots: last.roots.length, root: last.roots[0], stats: last.stats },
    '被保留行的 parentId=1 字符串化后等于自身键，因此按规则计为自引用：selfRefs=' + last.stats.selfRefs);
});

await runCase('A', 'A04', '父字段自动探测：parent_id / pid / parent', async () => {
  for (const pf of ['parent_id', 'pid', 'parent']) {
    const rows = [{ id: 1, [pf]: null, name: '根' }, { id: 2, [pf]: 1, name: '子' }];
    const r = await qaBuild(rows, { autoDetect: true, parentField: 'parentId' });
    record('A', 'A04-' + pf, '自动探测父字段 ' + pf,
      r.fields.parentField === pf && r.roots.length === 1 &&
      r.roots[0].children.length === 1 && r.roots[0].children[0].id === 2 &&
      r.issues.some(i => i.tag === '探测'),
      'fields.parentField=' + pf + ' 且子挂接成功且有探测提示',
      { fields: r.fields, roots: r.roots.length, children: r.roots[0] && r.roots[0].children.length, issues: r.issues });
  }
  const idRows = [{ _id: 1, parentId: null, name: '根' }, { _id: 2, parentId: 1, name: '子' }];
  const ir = await qaBuild(idRows, { autoDetect: true, idField: 'id' });
  record('A', 'A04-id', '自动探测 ID 字段 _id',
    ir.fields.idField === '_id' && ir.roots.length === 1 && ir.roots[0].children.length === 1,
    'fields.idField=_id 且子挂接成功', { fields: ir.fields, roots: ir.roots.length });
});

await runCase('A', 'A05', '关闭自动探测后按手填字段工作', async () => {
  const rows = [{ id: 1, parent_id: null }, { id: 2, parent_id: 1 }];
  const r = await qaBuild(rows, { autoDetect: false, parentField: 'parentId' });
  record('A', 'A05', 'autoDetect=false 时 parent_id 不被识别，两者均为根',
    r.fields.parentField === 'parentId' && r.roots.length === 2 &&
    r.stats.maxDepth === 1 && r.stats.orphans === 0 &&
    r.roots.every(x => x.children.length === 0),
    'roots=2 / maxDepth=1 / 无子',
    { fields: r.fields, roots: r.roots.length, stats: r.stats });
});

await runCase('A', 'A06', '自定义 children 字段名 items 生效', async () => {
  const r = await qaBuild(NORMAL_ROWS, { childrenField: 'items' });
  const root = r.roots[0];
  record('A', 'A06', '输出使用 items 而非 children',
    Array.isArray(root.items) && root.items.length === 2 &&
    root.children === undefined &&
    Array.isArray(root.items[0].items) && root.items[0].items[0].id === 4,
    'root.items=[2,3] 且无 children，深层也用 items',
    { keys: Object.keys(root), items: root.items && root.items.map(x => x.id) });
});

await runCase('A', 'A07', '移除原父字段 / 关闭保留其它字段', async () => {
  const r1 = await qaBuild(NORMAL_ROWS, { removeParent: true });
  record('A', 'A07a', 'removeParent=true：输出不含 parentId 但保留其它字段',
    r1.roots[0].parentId === undefined &&
    r1.roots[0].name === '总部' &&
    r1.roots[0].children[0].parentId === undefined &&
    r1.roots[0].children[0].owner === '张三',
    '无 parentId，保留 name/owner', Object.keys(r1.roots[0]));
  const r2 = await qaBuild(NORMAL_ROWS, { keepOther: false });
  const keys = Object.keys(r2.roots[0]);
  record('A', 'A07b', 'keepOther=false：只保留 id 与 children',
    keys.length === 2 && keys.includes('id') && keys.includes('children') &&
    r2.roots[0].name === undefined && r2.roots[0].parentId === undefined,
    'keys=["id","children"]', keys);
});

await runCase('A', 'A08', '根标记全覆盖 null / undefined / "" / 0 / "0" / root / " ROOT "', async () => {
  const markers = [null, undefined, '', 0, '0', 'root', ' ROOT '];
  const rows = markers.map((m, i) => ({ id: i + 1, parentId: m, name: 'm' + i }));
  const r = await qaBuild(rows);
  record('A', 'A08a', '7 种根标记全部提升为根',
    r.roots.length === 7 && r.stats.maxDepth === 1 && r.stats.orphans === 0 &&
    r.stats.selfRefs === 0 && r.issues.length === 0,
    'roots=7 / maxDepth=1 / orphans=0 / issues=0',
    { roots: r.roots.length, stats: r.stats, issues: r.issues });
  const flags = await page.evaluate(() => {
    const P = window.ParentChildTreePrototype;
    return [null, undefined, '', 0, '0', 'root', ' ROOT ', 'Root', ' root ', 1, 'X', false].map(v => P.isRootMarker(v));
  });
  record('A', 'A08b', 'isRootMarker 直接调用结果正确',
    JSON.stringify(flags) === JSON.stringify([true, true, true, true, true, true, true, true, true, false, false, false]),
    '[true,true,true,true,true,true,true,true,true,false,false,false]', flags);
});

await runCase('A', 'A09', '孤儿 / 自引用：提升为根并计入 issues 与 stats', async () => {
  const orphan = await qaBuild([{ id: 1, parentId: null }, { id: 2, parentId: 999 }]);
  record('A', 'A09a', '孤儿提升为根且记录提示与统计',
    orphan.roots.length === 2 && orphan.stats.orphans === 1 &&
    orphan.issues.some(i => i.tag === '孤儿' && i.text.includes('999')) &&
    orphan.flags.some(f => f.key === '2' && f.orphan === true),
    'roots=2 / orphans=1 / 提示含 999 / 树节点标孤儿',
    { roots: orphan.roots.length, stats: orphan.stats, issues: orphan.issues, flags: orphan.flags });
  const selfRef = await qaBuild([{ id: 1, parentId: 1 }]);
  record('A', 'A09b', '自引用提升为根且记录提示与统计',
    selfRef.roots.length === 1 && selfRef.stats.selfRefs === 1 &&
    selfRef.issues.some(i => i.tag === '自引用' && i.text.includes('自身')) &&
    selfRef.flags[0].selfRef === true,
    'roots=1 / selfRefs=1 / 提示含“自身”',
    { roots: selfRef.roots.length, stats: selfRef.stats, issues: selfRef.issues, flags: selfRef.flags });
});

await runCase('A', 'A10', '循环 A→B→C→A：断环 / 提升 / __circularRef / 不死循环', async () => {
  const t0 = Date.now();
  const r = await qaBuild([
    { id: 'A', parentId: 'B', name: 'A' },
    { id: 'B', parentId: 'C', name: 'B' },
    { id: 'C', parentId: 'A', name: 'C' }
  ]);
  const ms = Date.now() - t0;
  results.performance.cycleBuildMs = ms;
  const cycIssue = r.issues.find(i => i.tag === '循环');
  record('A', 'A10', '循环被检测并断开，断环节点成为带 __circularRef 的根',
    r.roots.length === 1 && r.roots[0].id === 'C' &&
    r.roots[0].__circularRef === true &&
    r.roots[0].children.length === 1 && r.roots[0].children[0].id === 'B' &&
    r.roots[0].children[0].children[0].id === 'A' &&
    r.stats.cycles === 1 &&
    !!cycIssue && cycIssue.text.includes('C → A') &&
    !/__circularRef[\s\S]*__circularRef/.test(r.outputText.slice(0, 200)) && ms < 1000,
    'root=C 且 __circularRef=true，断环后链 C→B→A（A.parent=B, B.parent=C），cycles=1，issue 含 “C → A”，耗时<1s',
    { roots: r.roots.length, root: r.roots[0], stats: r.stats, issue: cycIssue && cycIssue.text, ms });
});

await runCase('A', 'A11', '重复 ID 两种策略逐条列序号', async () => {
  const rows = [
    { id: 1, parentId: null, v: 'first' },
    { id: 1, parentId: null, v: 'last' },
    { id: 2, parentId: 1, v: 'child' }
  ];
  const f = await qaBuild(rows, { dupMode: 'first' });
  const dupF = f.issues.find(i => i.tag === '重复');
  record('A', 'A11a', '保留首个：节点数正确且提示列出第 1、2 项',
    f.roots.length === 1 && f.roots[0].v === 'first' &&
    f.roots[0].children.length === 1 && f.stats.duplicates === 1 &&
    f.stats.valid === 2 && !!dupF && dupF.text.includes('第 1、2 项') &&
    dupF.text.includes('保留首个'),
    'root.v=first / valid=2 / duplicates=1 / 提示含 第 1、2 项',
    { root: f.roots[0], stats: f.stats, issue: dupF && dupF.text });
  const l = await qaBuild(rows, { dupMode: 'last' });
  const dupL = l.issues.find(i => i.tag === '重复');
  record('A', 'A11b', '保留最后：后者覆盖且提示列出第 1、2 项',
    l.roots.length === 1 && l.roots[0].v === 'last' &&
    l.stats.duplicates === 1 && l.stats.skipped === 0 &&
    !!dupL && dupL.text.includes('第 1、2 项') && dupL.text.includes('保留最后'),
    'root.v=last / duplicates=1 / skipped=0 / 提示含 保留最后',
    { root: l.roots[0], stats: l.stats, issue: dupL && dupL.text });
});

await runCase('A', 'A12', '非法行跳过并提示；空/非数组 API 层友好错误', async () => {
  const bad = [null, 123, 'str', [], {}, { id: 2, parentId: null, name: 'ok' }];
  const r = await qaBuild(bad);
  const skips = r.issues.filter(i => i.tag === '跳过');
  record('A', 'A12a', '5 条非法行被跳过并逐条提示，不崩溃',
    r.roots.length === 1 && r.roots[0].id === 2 &&
    r.stats.total === 6 && r.stats.valid === 1 && r.stats.skipped === 5 &&
    skips.length === 5 && skips[0].text.includes('第 1 项'),
    'total=6 / valid=1 / skipped=5 / 5 条跳过提示',
    { stats: r.stats, skipCount: skips.length, first: skips[0] && skips[0].text });
  const empty = await qaBuildRaw([]);
  record('A', 'A12b', '空数组在 API 层抛出中文错误',
    empty.threw && empty.message.includes('没有可用于构建的有效节点'),
    '抛出含“没有可用于构建的有效节点”的中文错误', empty);
  const nonArr = await qaBuildRaw({ a: 1 });
  record('A', 'A12c', '非数组在 API 层抛出中文错误',
    nonArr.threw && nonArr.message.includes('没有可用于构建的有效节点'),
    '抛出中文错误而非崩溃', nonArr);
});

await runCase('A', 'A13', '字段名解析与高亮：resolveFields / highlightJson', async () => {
  const rf = await page.evaluate(() => {
    const P = window.ParentChildTreePrototype;
    const rows = [{ _id: 1, parent_id: null }, { _id: 2, parent_id: 1 }];
    const issues = [];
    const on = P.resolveFields(rows, { idField: 'id', parentField: 'parentId', childrenField: 'children', autoDetect: true }, issues);
    const issues2 = [];
    const off = P.resolveFields(rows, { idField: 'id', parentField: 'parentId', childrenField: 'children', autoDetect: false }, issues2);
    return { on, issues, off, issues2 };
  });
  record('A', 'A13a', 'resolveFields 自动探测 / 关闭探测行为正确',
    rf.on.idField === '_id' && rf.on.parentField === 'parent_id' && rf.issues.length === 2 &&
    rf.off.idField === 'id' && rf.off.parentField === 'parentId' && rf.issues2.length === 0,
    'on→(_id,parent_id,2 提示) / off→(id,parentId,0 提示)', rf);
  const h = await page.evaluate(() => {
    const P = window.ParentChildTreePrototype;
    return P.highlightJson('<script>{"k":"v",n:1}</script>');
  });
  record('A', 'A13b', 'highlightJson 转义 HTML 且产生高亮 span',
    h.includes('&lt;script&gt;') && !h.includes('<script>') &&
    h.includes('tok-key') && h.includes('tok-num') && h.includes('tok-str'),
    '转义 <script>，含 tok-key/tok-num/tok-str', h.slice(0, 240));
});

await runCase('A', 'A14', '5000 层深链：不爆栈 / 深度正确 / 迭代序列化可用', async () => {
  const deep = await page.evaluate(() => {
    const rows = [];
    for (let i = 1; i <= 5000; i++) rows.push({ id: i, parentId: i - 1, name: 'n' + i });
    const t0 = performance.now();
    const r = window.__qaBuild(rows, {});
    const t1 = performance.now();
    let parseOk = false, parseErr = '';
    try { const v = JSON.parse(r.outputText); parseOk = !!v && v.id === 1; } catch (e) { parseErr = String(e && e.message || e); }
    return {
      ms: t1 - t0,
      stats: r.stats,
      roots: r.roots.length,
      outputLen: r.outputText.length,
      hasNewline: r.outputText.indexOf('\n') !== -1,
      head: r.outputText.slice(0, 90),
      idCount: (r.outputText.match(/"id":/g) || []).length,
      childrenCount: (r.outputText.match(/"children":/g) || []).length,
      parseOk, parseErr
    };
  });
  results.performance.deep5000BuildMs = Math.round(deep.ms);
  record('A', 'A14a', '5000 层构建不爆栈且最大深度 = 5000',
    deep.roots === 1 && deep.stats.maxDepth === 5000 &&
    deep.stats.total === 5000 && deep.stats.valid === 5000 && deep.ms < 3000,
    'roots=1 / maxDepth=5000 / total=5000 / 构建<3s',
    { roots: deep.roots, stats: deep.stats, ms: Math.round(deep.ms) });
  record('A', 'A14b', '深链自动切换紧凑输出且结构标记完整',
    deep.hasNewline === false && deep.idCount === 5000 &&
    deep.childrenCount === 5000 && deep.outputLen > 100000 &&
    deep.head.startsWith('{"id":1,"parentId":0,"name":"n1","children":'),
    '无换行 / 5000 个 id / 5000 个 children / 以根对象开头',
    { hasNewline: deep.hasNewline, idCount: deep.idCount, childrenCount: deep.childrenCount, head: deep.head, outputLen: deep.outputLen },
    'V8 原生 JSON.parse 在 5000 层同样会爆栈（已实测），故改用结构标记校验；parse 结果=' + deep.parseOk + ' ' + deep.parseErr);
});

await runCase('A', 'A15', 'stringifyJson 与原生 JSON.stringify 在可比较深度逐字一致', async () => {
  const cmp = await page.evaluate(() => {
    const rows = [];
    for (let i = 1; i <= 200; i++) rows.push({ id: i, parentId: i - 1, name: 'n' + i });
    const r = window.__qaBuild(rows, {});
    let native = '', err = '';
    try { native = JSON.stringify(r.outputValue, null, 2); } catch (e) { err = String(e && e.message || e); }
    return { same: r.outputText === native, err, lenA: r.outputText.length, lenB: native.length,
             hasNewline: r.outputText.indexOf('\n') !== -1, depth: r.stats.maxDepth };
  });
  record('A', 'A15', '200 层非紧凑输出与 JSON.stringify 完全一致',
    cmp.same && cmp.hasNewline && cmp.depth === 200 && !cmp.err,
    '逐字一致 / 带缩进换行 / depth=200', cmp);
});

await runCase('A', 'A16', '宽树 5000 节点构建性能 < 1s', async () => {
  const wide = await page.evaluate(() => {
    // 注意：parentId=0 按需求属于根标记，不能用作父引用；故根用 id=1 + parentId=null。
    const rows = [{ id: 1, parentId: null, name: 'root' }];
    for (let i = 2; i <= 5000; i++) rows.push({ id: i, parentId: 1, name: 'c' + i });
    const t0 = performance.now();
    const r = window.__qaBuild(rows, {});
    const t1 = performance.now();
    return { ms: t1 - t0, stats: r.stats, roots: r.roots.length,
             children: r.roots[0] && r.roots[0].children.length, outputLen: r.outputText.length };
  });
  results.performance.wide5000BuildMs = Math.round(wide.ms);
  record('A', 'A16', '宽树 5000 节点构建 < 1s 且结构正确',
    wide.ms < 1000 && wide.roots === 1 && wide.children === 4999 &&
    wide.stats.maxDepth === 2 && wide.stats.total === 5000,
    'ms<1000 / children=4999 / maxDepth=2 / total=5000',
    { ms: Math.round(wide.ms), roots: wide.roots, children: wide.children, stats: wide.stats });
});

/* ------------------------------------------------------------------
 * B 层：真实浏览器端到端
 * ---------------------------------------------------------------- */
async function readOut() {
  return norm(await page.evaluate(() => document.getElementById('outCode').textContent));
}
async function runAndWait() {
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
async function setFields(id, parent, children) {
  await page.evaluate(v => {
    document.getElementById('idField').value = v[0];
    document.getElementById('parentField').value = v[1];
    document.getElementById('childrenField').value = v[2];
    document.getElementById('dupMode').value = v[3] || 'first';
    document.getElementById('autoDetect').checked = v[4] !== false;
  }, [id, parent, children, 'first', true]);
}

await runCase('B', 'B03', '载入示例 → 执行 → 输出为合法 JSON 且树结构符合示例', async () => {
  await page.click('#loadExample');
  await page.waitForFunction(() => document.getElementById('statusMsg').textContent.includes('构建完成'), null, { timeout: 15000 });
  const text = await readOut();
  let parsed = null, err = '';
  try { parsed = JSON.parse(text); } catch (e) { err = e.message; }
  const roots = Array.isArray(parsed) ? parsed : [parsed];
  const hq = roots.find(r => r && r.id === 1);
  const rootOps = roots.find(r => r && r.id === 'root-ops');
  const orphan = roots.find(r => r && r.id === 9);
  record('B', 'B03', '示例输出合法且结构正确（4 层链 / 3 根 / 1 孤儿）',
    !err && roots.length === 3 && !!hq && hq.children.length === 2 &&
    hq.children[0].id === 2 && hq.children[0].children[0].id === 4 &&
    hq.children[0].children[0].children[0].id === 6 &&
    !!rootOps && !!orphan && orphan.parentId === 999,
    'JSON 合法 / roots=3 / 1→2→4→6 四层 / root-ops 与 9 为根',
    { err, rootIds: roots.map(r => r && r.id), hq: hq && hq.children.map(c => c.id) });
});

await runCase('B', 'B04', '统计 chips 数值正确', async () => {
  const chips = await page.evaluate(() => ({
    total: document.getElementById('stTotal').textContent,
    roots: document.getElementById('stRoots').textContent,
    depth: document.getElementById('stDepth').textContent,
    orphans: document.getElementById('stOrphans').textContent,
    cycles: document.getElementById('stCycles').textContent,
    dups: document.getElementById('stDups').textContent,
    self: document.getElementById('stSelf').textContent,
    note: document.getElementById('statNote').textContent,
    status: document.getElementById('statusMsg').textContent
  }));
  record('B', 'B04', 'chips = 9/3/4/1/0/0/0 且状态含用时',
    chips.total === '9' && chips.roots === '3' && chips.depth === '4' &&
    chips.orphans === '1' && chips.cycles === '0' && chips.dups === '0' &&
    chips.self === '0' && chips.note.includes('有效节点 9') &&
    chips.status.includes('用时'),
    '9 / 3 / 4 / 1 / 0 / 0 / 0，状态含用时', chips);
});

await runCase('B', 'B05', '树形视图：节点可见 / 单节点展开折叠', async () => {
  await page.click('#segTree');
  const visible = await page.evaluate(() => ({ hidden: document.getElementById('treeView').hidden,
    rows: document.querySelectorAll('#tree .jt-trow').length,
    text: document.getElementById('tree').textContent }));
  record('B', 'B05', '切到树形视图后 3 个根节点可见',
    visible.hidden === false && visible.rows === 3 && visible.text.includes('集团总部'),
    'treeView 可见 / 3 行 / 含“集团总部”', visible);
  await page.click('#tree .jt-ttoggle');
  await page.waitForFunction(() => document.querySelectorAll('#tree .jt-trow').length > 3);
  const expanded = await page.evaluate(() => document.querySelectorAll('#tree .jt-trow').length);
  await page.click('#tree .jt-ttoggle');
  await page.waitForFunction(() => document.querySelectorAll('#tree .jt-trow').length === 3);
  const collapsed = await page.evaluate(() => document.querySelectorAll('#tree .jt-trow').length);
  record('B', 'B05b', '单节点展开/折叠可用',
    expanded === 5 && collapsed === 3, '展开=5 行 / 折叠=3 行', { expanded, collapsed });
});

await runCase('B', 'B06', '全部展开 / 全部折叠', async () => {
  await page.click('#expandAll');
  const all = await page.evaluate(() => document.querySelectorAll('#tree .jt-trow').length);
  await page.click('#collapseAll');
  const none = await page.evaluate(() => document.querySelectorAll('#tree .jt-trow').length);
  record('B', 'B06', '全部展开 9 行 / 全部折叠 3 行',
    all === 9 && none === 3, '展开=9 / 折叠=3', { all, none });
});

await runCase('B', 'B07', '点击节点弹出原始对象并可关闭', async () => {
  await page.click('#expandAll');
  await page.evaluate(() => {
    const row = Array.from(document.querySelectorAll('#tree .jt-trow'))
      .find(r => r.getAttribute('data-uid') === 'n0');
    row.click();
  });
  await page.waitForFunction(() => !document.getElementById('modal').hidden);
  await page.waitForTimeout(220);
  const modal = await page.evaluate(() => ({
    hidden: document.getElementById('modal').hidden,
    show: document.getElementById('modal').classList.contains('show'),
    title: document.getElementById('modalTitle').textContent,
    path: document.getElementById('modalPath').textContent,
    code: document.getElementById('modalCode').textContent
  }));
  record('B', 'B07a', '弹窗显示原始对象内容与路径',
    !modal.hidden && modal.show && modal.title.includes('1') &&
    modal.path.includes('深度：1') && modal.code.includes('"name": "集团总部"'),
    '弹窗可见 / 标题含 id / 路径含深度 / 对象含 name', modal);
  await page.click('#modalOk');
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => ({ hidden: document.getElementById('modal').hidden,
    show: document.getElementById('modal').classList.contains('show') }));
  record('B', 'B07b', '关闭按钮生效且完全隐藏',
    closed.hidden === true && closed.show === false, 'hidden=true / 无 show', closed);
});

await runCase('B', 'B08', '快速关闭不会被 RAF 复活', async () => {
  const st = await page.evaluate(async () => {
    const row = document.querySelector('#tree .jt-trow');
    row.click();
    document.getElementById('modalOk').click();
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    await new Promise(res => setTimeout(res, 220));
    return { hidden: document.getElementById('modal').hidden,
             show: document.getElementById('modal').classList.contains('show') };
  });
  record('B', 'B08', '同一帧内打开并关闭后弹窗保持隐藏',
    st.hidden === true && st.show === false, 'hidden=true / show=false', st);
});

await runCase('B', 'B09', '截图 02-result-tree.png（树形视图，全部展开）', async () => {
  await page.click('#expandAll');
  const file = path.join(SHOTS, '02-result-tree.png');
  await page.screenshot({ path: file, fullPage: false });
  const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
  results.screenshots.push({ file, scene: '示例结果树形视图', bytes });
  record('B', 'B09', '截图 02-result-tree.png 生成', bytes > 5000, '> 5KB', bytes + ' bytes');
});

await runCase('B', 'B10', '复制输出：剪贴板内容与输出逐字一致（CRLF 归一化）', async () => {
  const expected = await readOut();
  await page.evaluate(() => {
    window.__qaCopied = null;
    const cp = navigator.clipboard;
    if (cp && cp.writeText) {
      try {
        Object.defineProperty(cp, 'writeText', {
          configurable: true, value: function (t) { window.__qaCopied = t; return Promise.resolve(); }
        });
      } catch (e) { window.__qaSpyErr = String(e); }
    }
  });
  await page.click('#copyOut');
  await page.waitForTimeout(120);
  let copied = await page.evaluate(() => window.__qaCopied);
  const spyErr = await page.evaluate(() => window.__qaSpyErr || '');
  if (copied == null) {
    try { copied = await page.evaluate(() => navigator.clipboard.readText()); } catch (e) { /* ignore */ }
  }
  record('B', 'B10', '复制得到完整输出 JSON',
    copied != null && norm(copied) === expected && expected.length > 200,
    '剪贴板文本 === 输出文本（归一化换行）',
    { copiedLen: copied == null ? null : norm(copied).length, expectedLen: expected.length, spyErr });
});

await runCase('B', 'B11', '下载 .json：文件名与内容合法', async () => {
  const expected = await readOut();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#downloadOut')
  ]);
  const filename = download.suggestedFilename();
  const stream = await download.createReadStream();
  let content = '';
  for await (const chunk of stream) content += chunk.toString('utf8');
  let parsed = null, err = '';
  try { parsed = JSON.parse(content); } catch (e) { err = e.message; }
  record('B', 'B11', '下载文件名正确且内容是合法 JSON 并与输出一致',
    filename === 'parent-child-tree.json' && !err && norm(content) === expected && Array.isArray(parsed),
    '文件名=parent-child-tree.json / 内容合法且与输出一致',
    { filename, err, len: content.length, rootCount: parsed && parsed.length });
});

await runCase('B', 'B12', '自定义字段名 UI 端到端', async () => {
  await setFields('uid', 'up', 'kids');
  await setInput(JSON.stringify([
    { uid: 'a', up: null, n: 'A' },
    { uid: 'b', up: 'a', n: 'B' },
    { uid: 'c', up: 'b', n: 'C' }
  ]));
  await runAndWait();
  const out = await readOut();
  let parsed = null, err = '';
  try { parsed = JSON.parse(out); } catch (e) { err = e.message; }
  record('B', 'B12', '自定义 uid/up/kids 正确构建三层树且保留 n 字段',
    !err && parsed && parsed.uid === 'a' && parsed.kids[0].uid === 'b' &&
    parsed.kids[0].kids[0].uid === 'c' && parsed.kids[0].kids[0].n === 'C' &&
    parsed.children === undefined,
    'root.uid=a → kids b → kids c，保留 n',
    { err, parsed, status: await page.evaluate(() => document.getElementById('statusMsg').textContent) });
});

await runCase('B', 'B13', '切换重复策略后结果变化', async () => {
  await setFields('id', 'parentId', 'children');
  await setInput(JSON.stringify([
    { id: 1, parentId: null, v: 'FIRST' },
    { id: 1, parentId: null, v: 'LAST' },
    { id: 2, parentId: 1, v: 'CHILD' }
  ]));
  await page.evaluate(() => { document.getElementById('dupMode').value = 'first'; });
  await runAndWait();
  const firstOut = await readOut();
  await page.evaluate(() => { document.getElementById('dupMode').value = 'last'; });
  await runAndWait();
  const lastOut = await readOut();
  let a = null, b = null, err = '';
  try { a = JSON.parse(firstOut); b = JSON.parse(lastOut); } catch (e) { err = e.message; }
  record('B', 'B13', 'first 保留 FIRST / last 保留 LAST，两者结果不同',
    !err && a && b && a.v === 'FIRST' && b.v === 'LAST' &&
    a.children[0].id === 2 && b.children[0].id === 2 && firstOut !== lastOut,
    'first.v=FIRST / last.v=LAST / 两者不同',
    { err, first: a && a.v, last: b && b.v, firstChildren: a && a.children.length, lastChildren: b && b.children.length });
});

await runCase('B', 'B14', '边界 UI：非法 JSON / 非数组 / 空数组中文错误条', async () => {
  await setFields('id', 'parentId', 'children');
  const cases = [
    { name: '非法 JSON', text: '{bad json', kw: 'JSON 解析失败' },
    { name: '非数组', text: '{"id":1,"parentId":null}', kw: '输入应为 JSON 数组' },
    { name: '空数组', text: '[]', kw: '输入数组为空' }
  ];
  for (const c of cases) {
    await setInput(c.text);
    await runAndWait();
    const bar = await page.evaluate(() => ({ hidden: document.getElementById('errBar').hidden,
      msg: document.getElementById('errMsg').textContent,
      outEmpty: document.getElementById('outEmpty').hidden }));
    record('B', 'B14-' + c.name, c.name + '显示中文错误条且无输出',
      bar.hidden === false && bar.msg.includes(c.kw) && bar.outEmpty === false && /[\u4e00-\u9fa5]/.test(bar.msg),
      '错误条可见 / 含“' + c.kw + '” / 输出空态可见', bar);
  }
});

await runCase('B', 'B15', '边界 UI：循环 / 自引用 / 孤儿提示且输出仍可用', async () => {
  await setFields('id', 'parentId', 'children');
  await setInput(JSON.stringify([
    { id: 'A', parentId: 'B', name: '循环A' },
    { id: 'B', parentId: 'A', name: '循环B' },
    { id: 'S', parentId: 'S', name: '自引用' },
    { id: 'O', parentId: 999, name: '孤儿' }
  ]));
  await runAndWait();
  const ui = await page.evaluate(() => ({
    status: document.getElementById('statusMsg').textContent,
    noticeHidden: document.getElementById('notice').hidden,
    noticeText: document.getElementById('notice').textContent,
    cycles: document.getElementById('stCycles').textContent,
    self: document.getElementById('stSelf').textContent,
    orphans: document.getElementById('stOrphans').textContent
  }));
  record('B', 'B15a', '提示区出现循环 / 自引用 / 孤儿三类文案且 chips 计数正确',
    ui.status.includes('构建完成') && ui.noticeHidden === false &&
    ui.noticeText.includes('循环') && ui.noticeText.includes('自引用') &&
    ui.noticeText.includes('父 ID「999」不存在') &&
    ui.cycles === '1' && ui.self === '1' && ui.orphans === '1',
    '提示含三类文案 / cycles=self=orphans=1', ui);
  const out = await readOut();
  let parsed = null, err = '';
  try { parsed = JSON.parse(out); } catch (e) { err = e.message; }
  const roots = Array.isArray(parsed) ? parsed : [parsed];
  const breaker = roots.find(r => r && r.id === 'B');
  record('B', 'B15b', '边界输入下输出仍是合法树（断环标记可见）',
    !err && roots.length === 3 && breaker && breaker.__circularRef === true &&
    breaker.children[0].id === 'A' && out.includes('__circularRef'),
    'roots=3 / 断环根 B 带 __circularRef / JSON 合法',
    { err, rootIds: roots.map(x => x && x.id), breaker });
});

await runCase('B', 'B16', '截图 03-boundary.png（边界提示 + 树形态）', async () => {
  await page.click('#segTree');
  await page.click('#expandAll');
  const file = path.join(SHOTS, '03-boundary.png');
  await page.screenshot({ path: file, fullPage: false });
  const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
  results.screenshots.push({ file, scene: '循环/自引用/孤儿边界提示', bytes });
  record('B', 'B16', '截图 03-boundary.png 生成', bytes > 5000, '> 5KB', bytes + ' bytes');
});

await runCase('B', 'B17', '主题切换 + 刷新后保持', async () => {
  const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await page.click('#themeBtn');
  const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const stored = await page.evaluate(() => localStorage.getItem('jtc-prototype-theme'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.ParentChildTreePrototype);
  const reloaded = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  record('B', 'B17', '切到 dark 并在刷新后保持',
    before === 'light' && after === 'dark' && stored === 'dark' && reloaded === 'dark',
    'light → dark，localStorage=dark，刷新后 dark',
    { before, after, stored, reloaded });
});

await runCase('B', 'B18', '截图 04-dark.png（深色主题）', async () => {
  await page.click('#loadExample');
  await page.waitForFunction(() => document.getElementById('statusMsg').textContent.includes('构建完成'), null, { timeout: 15000 });
  await page.click('#segTree');
  await page.click('#expandAll');
  const file = path.join(SHOTS, '04-dark.png');
  await page.screenshot({ path: file, fullPage: false });
  const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
  results.screenshots.push({ file, scene: '深色主题 + 示例树', bytes });
  record('B', 'B18', '截图 04-dark.png 生成', bytes > 5000 && await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark',
    '> 5KB 且主题为 dark', bytes + ' bytes');
});

await runCase('B', 'B19', 'Ctrl+Enter 快捷执行', async () => {
  await page.click('#clearOut');
  const cleared = await readOut();
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => document.getElementById('statusMsg').textContent.includes('构建完成'), null, { timeout: 15000 });
  const after = await readOut();
  let ok = false;
  try { ok = Array.isArray(JSON.parse(after)); } catch (e) { /* ignore */ }
  record('B', 'B19', '清空后 Ctrl+Enter 重新构建出合法 JSON',
    cleared.trim() === '' && ok && after.length > 100,
    '清空为空 → Ctrl+Enter → 合法 JSON', { clearedLen: cleared.length, afterLen: after.length });
});

await runCase('B', 'B20', '拖拽分栏可用', async () => {
  await setFields('id', 'parentId', 'children');
  const before = await page.evaluate(() => document.getElementById('inputPanel').style.flex);
  const box = await page.locator('#splitter').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 130, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = await page.evaluate(() => document.getElementById('inputPanel').style.flex);
  const pctOf = s => { const m = /([\d.]+)\s*%$/.exec(String(s)); return m ? Number(m[1]) : NaN; };
  record('B', 'B20', '拖动分隔条改变左面板宽度',
    pctOf(before) === 50 && after !== before && pctOf(after) > 50,
    '从 50% 拖到 > 50%', { before, after, beforePct: pctOf(before), afterPct: pctOf(after) });
});

await runCase('B', 'B21', '5000 节点端到端执行 < 1s 且无卡死', async () => {
  let arr = '';
  for (let i = 1; i <= 5000; i++) {
    if (i > 1) arr += ',';
    arr += '{"id":' + i + ',"parentId":' + (i - 1) + ',"name":"n' + i + '"}';
  }
  const big = '[' + arr + ']';
  await setFields('id', 'parentId', 'children');
  await setInput(big);
  const t0 = Date.now();
  await page.click('#runBtn');
  await page.waitForFunction(() => {
    const t = document.getElementById('statusMsg').textContent;
    return t.includes('构建完成') || t.includes('构建失败');
  }, null, { timeout: 20000 });
  const ms = Date.now() - t0;
  results.performance.e2e5000Ms = ms;
  const state = await page.evaluate(() => ({
    status: document.getElementById('statusMsg').textContent,
    total: document.getElementById('stTotal').textContent,
    depth: document.getElementById('stDepth').textContent,
    outLen: document.getElementById('outCode').textContent.length,
    failed: !document.getElementById('errBar').hidden
  }));
  record('B', 'B21a', '5000 节点端到端完成且统计正确',
    state.status.includes('构建完成') && !state.failed &&
    state.total === '5000' && state.depth === '5000' && state.outLen > 100000,
    '构建完成 / total=5000 / depth=5000 / 输出非空', { ms, ...state });
  record('B', 'B21b', '5000 节点端到端耗时 < 1s',
    ms < 1000, '< 1000 ms', ms + ' ms',
    '若超过 1s 则为性能观察项，需结合机器环境评估');
});

await runCase('B', 'B22', '全程 console error = 0 / pageerror = 0 / 失败请求 = 0', async () => {
  record('B', 'B22', '全程无 console error、无 pageerror、无失败请求',
    consoleErrors.length === 0 && pageErrors.length === 0 && failedRequests.length === 0,
    '三者均为 0', { consoleErrors, pageErrors, failedRequests });
});

/* -------------------------- 汇总 -------------------------- */
const all = results.assertions;
const passed = all.filter(a => a.passed).length;
const failed = all.filter(a => !a.passed).length;
const aPass = results.layers.A.filter(a => a.passed).length;
const bPass = results.layers.B.filter(a => a.passed).length;
results.summary = {
  total: all.length,
  passed,
  failed,
  layerA: { total: results.layers.A.length, passed: aPass, failed: results.layers.A.length - aPass },
  layerB: { total: results.layers.B.length, passed: bPass, failed: results.layers.B.length - bPass },
  estimatedCoverage: '核心 API 全覆盖（buildTree/isRootMarker/resolveFields/highlightJson 及全部参数分支）+ 主要 UI 路径全覆盖',
  consoleErrors: consoleErrors.length,
  pageErrors: pageErrors.length,
  failedRequests: failedRequests.length
};
results.meta.finishedAt = new Date().toISOString();
results.verdict = failed === 0 ? 'PASS' : 'FAIL';
results.routing = failed === 0 ? 'NoOne（全部通过）' : '待QA分析失败项后路由';

fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2), 'utf8');
console.log('\n=== 汇总 ===');
console.log('A 层: ' + aPass + '/' + results.layers.A.length + ' 通过');
console.log('B 层: ' + bPass + '/' + results.layers.B.length + ' 通过');
console.log('总计: ' + passed + '/' + all.length + ' 通过，失败 ' + failed);
console.log('性能: deep5000=' + results.performance.deep5000BuildMs + 'ms, wide5000=' +
  results.performance.wide5000BuildMs + 'ms, e2e5000=' + results.performance.e2e5000Ms + 'ms');
console.log('结果文件: ' + RESULTS);
console.log('截图: ' + results.screenshots.map(s => path.basename(s.file)).join(', '));
console.log('判定: ' + results.verdict);

await browser.close();
