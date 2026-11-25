/* eslint-disable */
/**
 * treebuild-check.mjs —— 「JSON 数组 → 父子结构」集成版 · Node 层独立证伪式验证（QA 严过关）
 *
 * 目标：直接加载 web/js/core/treebuild.js（IIFE / globalThis），验证核心算法行为；
 *       同时做注册表静态/动态核查与工具 run() 端到端（Node 侧）。
 * 纪律：只读产品代码；仅写 .qa/treebuild-results.json；不修改 web/ 与文档，不提交 git。
 * 运行：node .qa/treebuild-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB = path.join(ROOT, 'web');
const RESULTS = path.join(HERE, 'treebuild-results.json');

const report = {
  meta: {
    task: 'JSON 数组 → 父子结构 集成版 Node 层专项验证',
    qa: '严过关 (Yan) / software-qa-engineer',
    startedAt: new Date().toISOString(),
    nodeVersion: process.version,
    spec: 'team-lead 任务书：树构建/边界/注册表/工具 run',
    mode: '独立证伪式：直接以设计行为为准断言，源码不符即判失败'
  },
  layers: { core: [], registry: [] },
  assertions: [],
  defects: [],
  performance: {},
  routing: '待判定',
  verdict: '待判定'
};

function fmt(v) {
  if (typeof v === 'string') return v;
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : (s.length > 900 ? s.slice(0, 900) + '…' : s);
  } catch (e) { return String(v); }
}

function record(layer, id, name, passed, expected, actual, note) {
  const item = { layer, id, name, passed: !!passed, expected, actual: fmt(actual) };
  if (note !== undefined && note !== null) item.note = note;
  report.assertions.push(item);
  report.layers[layer].push(item);
  console.log('  ' + (passed ? '✓' : '✗') + ' [' + id + '] ' + name +
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

/* ===== 加载被测代码（Node 直载 IIFE） ===== */
globalThis.window = globalThis;
function loadScript(rel) {
  const file = path.join(WEB, rel);
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
}
const CORE_FILES = [
  'vendor/libs.js', 'js/core/json.js', 'js/core/convert.js', 'js/core/codegen.js',
  'js/core/codec.js', 'js/core/analyze.js', 'js/core/password.js', 'js/core/treebuild.js'
];
for (const f of CORE_FILES) loadScript(f);
loadScript('js/tools-registry.js');

const TB = globalThis.JTCore && globalThis.JTCore.treebuild;
const REG = globalThis.JT && globalThis.JT.registry;
if (!TB || !REG) {
  report.defects.push({ file: 'web/js/core/treebuild.js / web/js/tools-registry.js', issue: 'Node 加载后未找到 JTCore.treebuild 或 JT.registry' });
  report.verdict = 'FAIL';
  fs.writeFileSync(RESULTS, JSON.stringify(report, null, 2), 'utf8');
  console.error('FATAL: treebuild 或 registry 未加载');
  process.exit(2);
}

/* ===== 测试夹具 ===== */
const DEF = {
  idField: 'id', parentField: 'parentId', childrenField: 'children',
  autoDetect: false, removeParent: false, keepOther: true, dupMode: 'first'
};
const B = (rows, opts) => TB.buildTree(rows, Object.assign({}, DEF, opts || {}));
function errOf(rows, opts) {
  try { B(rows, opts); return { threw: false }; }
  catch (e) { return { threw: true, message: (e && e.message) || String(e) }; }
}
const NORMAL = [
  { id: 1, parentId: null, name: '总部', code: 'HQ' },
  { id: 2, parentId: 1, name: '技术中心', owner: '张三' },
  { id: 3, parentId: 1, name: '市场中心', owner: '李四' },
  { id: 4, parentId: 2, name: '前端组', size: 8 }
];

console.log('\n===== 一、核心算法（C01–C22） =====');

await runCase('core', 'C01', '正常 3 层树：结构 / 字段保留 / stats / issues', async () => {
  const r = B(NORMAL);
  record('core', 'C01a', '树结构与子节点顺序正确',
    r.roots.length === 1 && r.roots[0].id === 1 &&
    r.roots[0].children.length === 2 &&
    r.roots[0].children[0].id === 2 && r.roots[0].children[1].id === 3 &&
    r.roots[0].children[0].children.length === 1 &&
    r.roots[0].children[0].children[0].id === 4 &&
    r.roots[0].children[1].children.length === 0,
    '根=1；1→[2,3]；2→[4]；3 无子',
    { roots: r.roots.length, tree: r.roots[0] });
  record('core', 'C01b', '其它字段保留且 stats/issues 正确',
    r.stats.maxDepth === 3 && r.stats.roots === 1 && r.stats.total === 4 &&
    r.stats.valid === 4 && r.stats.skipped === 0 &&
    r.stats.orphans === 0 && r.stats.cycles === 0 && r.stats.duplicates === 0 &&
    r.issues.length === 0 &&
    r.roots[0].name === '总部' && r.roots[0].code === 'HQ' &&
    r.roots[0].children[0].owner === '张三' &&
    r.roots[0].children[0].children[0].size === 8,
    'maxDepth=3,roots=1,total=4,valid=4,issues=0,name/code/owner/size 保留',
    { stats: r.stats, issues: r.issues, root: r.roots[0] });
});

await runCase('core', 'C02', '单根输出单个对象 / 多根输出数组 / meta 键齐全', async () => {
  const one = B(NORMAL);
  record('core', 'C02a', '单根 meta.outputValue 是对象而非单元素数组',
    !Array.isArray(one.meta.outputValue) && one.meta.outputValue.id === 1 &&
    one.meta.outputText.trim().startsWith('{') && one.roots.length === 1,
    'outputValue 为对象，outputText 以 { 开头',
    { isArray: Array.isArray(one.meta.outputValue), head: one.meta.outputText.slice(0, 60) });
  const many = B([{ id: 1, parentId: null }, { id: 2, parentId: null }]);
  record('core', 'C02b', '多根 meta.outputValue 为数组且文本以 [ 开头',
    Array.isArray(many.meta.outputValue) && many.meta.outputValue.length === 2 &&
    many.meta.outputText.trim().startsWith('[') && many.roots.length === 2,
    'outputValue 为 2 元素数组，outputText 以 [ 开头',
    { isArray: Array.isArray(many.meta.outputValue), len: many.meta.outputValue.length });
  record('core', 'C02c', 'meta 含 outputValue/outputText/byKey/byUid/order/fields/roots',
    ['outputValue', 'outputText', 'byKey', 'byUid', 'order', 'fields', 'roots'].every(k => one.meta[k] !== undefined) &&
    one.meta.byKey instanceof Map && one.meta.byUid instanceof Map &&
    Array.isArray(one.meta.order) && one.meta.order.length === 4 &&
    one.meta.fields.idField === 'id' && one.meta.fields.parentField === 'parentId' &&
    one.meta.fields.childrenField === 'children',
    '7 个 meta 键存在，Map/数组/fields 类型正确',
    Object.keys(one.meta));
});

await runCase('core', 'C03', '混合 id 类型：数字 1 与字符串 "1" 统一为 String 键', async () => {
  const rows = [
    { id: 1, parentId: null, name: '根' },
    { id: '1', parentId: 1, name: '重复字符串' },
    { id: 2, parentId: '1', name: '按字符串父引用挂接' }
  ];
  const first = B(rows, { dupMode: 'first' });
  record('core', 'C03a', 'first：前两项合并为键 "1"，id:2 挂到根下',
    first.roots.length === 1 && first.roots[0].id === 1 &&
    first.roots[0].children.length === 1 && first.roots[0].children[0].id === 2 &&
    first.stats.duplicates === 1 && first.stats.valid === 2 &&
    first.meta.byKey.has('1'),
    'root.id=1, children=[2], duplicates=1, valid=2, byKey 含 "1"',
    { root: first.roots[0], stats: first.stats, keys: [...first.meta.byKey.keys()] });
  const last = B(rows, { dupMode: 'last' });
  record('core', 'C03b', 'last：覆盖后 root.id 为 "1"，id:2 仍挂到键 "1"',
    last.roots.length === 1 && last.roots[0].id === '1' &&
    last.roots[0].children.length === 1 && last.roots[0].children[0].id === 2 &&
    last.stats.duplicates === 1 && last.stats.skipped === 0,
    'root.id="1", children=[2], duplicates=1, skipped=0',
    { root: last.roots[0], stats: last.stats });
});

await runCase('core', 'C04', '自动探测父字段 parent_id / pid / parent / pId / PARENT_ID', async () => {
  for (const pf of ['parent_id', 'pid', 'parent', 'pId', 'PARENT_ID']) {
    const rows = [{ id: 1, [pf]: null, name: '根' }, { id: 2, [pf]: 1, name: '子' }];
    const r = B(rows, { autoDetect: true, parentField: 'parentId' });
    record('core', 'C04-' + pf, '自动探测父字段 ' + pf,
      r.meta.fields.parentField === pf && r.roots.length === 1 &&
      r.roots[0].children.length === 1 && r.roots[0].children[0].id === 2 &&
      r.issues.some(i => i.tag === '探测' && i.text.includes(pf)),
      'fields.parentField=' + pf + '，子挂接成功，含探测提示',
      { fields: r.meta.fields, roots: r.roots.length, issues: r.issues });
  }
});

await runCase('core', 'C05', '自动探测 ID 字段 _id / key / uuid / ID', async () => {
  for (const idf of ['_id', 'key', 'uuid', 'ID']) {
    const rows = [{ [idf]: 1, parentId: null }, { [idf]: 2, parentId: 1 }];
    const r = B(rows, { autoDetect: true, idField: 'id' });
    record('core', 'C05-' + idf, '自动探测 ID 字段 ' + idf,
      r.meta.fields.idField === idf && r.roots.length === 1 &&
      r.roots[0].children.length === 1 && r.roots[0].children[0][idf] === 2 &&
      r.issues.some(i => i.tag === '探测'),
      'fields.idField=' + idf + '，子挂接成功，含探测提示',
      { fields: r.meta.fields, roots: r.roots.length, issues: r.issues });
  }
});

await runCase('core', 'C06', '关闭自动探测时按手填字段工作（parent_id 不被识别）', async () => {
  const rows = [{ id: 1, parent_id: null }, { id: 2, parent_id: 1 }];
  const r = B(rows, { autoDetect: false, parentField: 'parentId' });
  record('core', 'C06', 'autoDetect=false：两者均为根，无探测提示',
    r.meta.fields.parentField === 'parentId' && r.roots.length === 2 &&
    r.stats.maxDepth === 1 && r.stats.orphans === 0 && r.issues.length === 0 &&
    r.roots.every(x => x.children.length === 0),
    'roots=2, maxDepth=1, orphans=0, issues=0',
    { fields: r.meta.fields, roots: r.roots.length, stats: r.stats });
});

await runCase('core', 'C07', '自定义 children 字段名 items 生效（含深层）', async () => {
  const r = B(NORMAL, { childrenField: 'items' });
  const root = r.roots[0];
  record('core', 'C07', '输出使用 items 而非 children',
    Array.isArray(root.items) && root.items.length === 2 &&
    root.children === undefined &&
    Array.isArray(root.items[0].items) && root.items[0].items[0].id === 4 &&
    r.meta.fields.childrenField === 'items',
    'root.items=[2,3]，无 children，深层也用 items',
    { keys: Object.keys(root), items: root.items && root.items.map(x => x.id) });
});

await runCase('core', 'C08', '移除父字段 / 关闭保留其它字段', async () => {
  const r1 = B(NORMAL, { removeParent: true });
  record('core', 'C08a', 'removeParent=true：输出不含 parentId 但保留其它字段',
    r1.roots[0].parentId === undefined && r1.roots[0].name === '总部' &&
    r1.roots[0].children[0].parentId === undefined &&
    r1.roots[0].children[0].owner === '张三',
    '无 parentId，保留 name/owner', Object.keys(r1.roots[0]));
  const r2 = B(NORMAL, { keepOther: false });
  const keys = Object.keys(r2.roots[0]);
  record('core', 'C08b', 'keepOther=false：只保留 id 与 children',
    keys.length === 2 && keys.includes('id') && keys.includes('children') &&
    r2.roots[0].name === undefined && r2.roots[0].parentId === undefined &&
    r2.roots[0].children[0].children[0].size === undefined,
    'keys=[id,children]，深层其它字段亦不保留',
    { keys, deep: Object.keys(r2.roots[0].children[0]) });
});

await runCase('core', 'C09', '7 种根标记与 isRootMarker 边界', async () => {
  const markers = [null, undefined, '', 0, '0', 'root', ' ROOT '];
  const rows = markers.map((m, i) => ({ id: i + 1, parentId: m, name: 'm' + i }));
  const r = B(rows);
  record('core', 'C09a', '7 种根标记全部提升为根且无问题提示',
    r.roots.length === 7 && r.stats.maxDepth === 1 &&
    r.stats.orphans === 0 && r.stats.selfRefs === 0 && r.issues.length === 0,
    'roots=7, maxDepth=1, orphans=0, issues=0',
    { roots: r.roots.length, stats: r.stats, issues: r.issues });
  const flags = [null, undefined, '', 0, '0', 'root', ' ROOT ', 'Root', ' root ', 1, 'X', false]
    .map(v => TB.isRootMarker(v));
  record('core', 'C09b', 'isRootMarker 直接调用（忽略大小写/trim，false 与 1 非根）',
    JSON.stringify(flags) === JSON.stringify([true, true, true, true, true, true, true, true, true, false, false, false]),
    '[T,T,T,T,T,T,T,T,T,F,F,F]', flags);
});

await runCase('core', 'C10', '孤儿 / 自引用提升为根 + stats + 提示', async () => {
  const orphan = B([{ id: 1, parentId: null }, { id: 2, parentId: 999 }]);
  record('core', 'C10a', '孤儿：roots=2, orphans=1, 提示含 999',
    orphan.roots.length === 2 && orphan.stats.orphans === 1 &&
    orphan.issues.some(i => i.tag === '孤儿' && i.text.includes('999')) &&
    orphan.meta.roots.some(n => n.key === '2' && n.orphan === true),
    'roots=2, orphans=1, tag=孤儿 且含 999，内部节点标 orphan',
    { roots: orphan.roots.length, stats: orphan.stats, issues: orphan.issues });
  const selfRef = B([{ id: 1, parentId: 1 }]);
  record('core', 'C10b', '自引用：roots=1, selfRefs=1, 提示含自身',
    selfRef.roots.length === 1 && selfRef.stats.selfRefs === 1 &&
    selfRef.issues.some(i => i.tag === '自引用' && i.text.includes('自身')) &&
    selfRef.meta.roots[0].selfRef === true,
    'roots=1, selfRefs=1, tag=自引用 且含自身',
    { roots: selfRef.roots.length, stats: selfRef.stats, issues: selfRef.issues });
  const objParent = B([{ id: 1, parentId: { x: 1 } }]);
  record('core', 'C10c', '父字段为对象：按孤儿处理并提升为根',
    objParent.roots.length === 1 && objParent.stats.orphans === 1 &&
    objParent.issues.some(i => i.tag === '孤儿' && i.text.includes('无效类型')),
    'roots=1, orphans=1, 提示含"无效类型"',
    { stats: objParent.stats, issues: objParent.issues });
});

await runCase('core', 'C11', '循环 A→B→C→A：断环 + __circularRef + 环路径', async () => {
  const t0 = performance.now();
  const r = B([
    { id: 'A', parentId: 'B', name: 'A' },
    { id: 'B', parentId: 'C', name: 'B' },
    { id: 'C', parentId: 'A', name: 'C' }
  ]);
  const ms = performance.now() - t0;
  report.performance.cycleBuildMs = Math.round(ms);
  const cycIssue = r.issues.find(i => i.tag === '循环');
  record('core', 'C11', '环被断开，断环节点成为根并标记 __circularRef，issue 含环路径',
    r.roots.length === 1 && r.roots[0].id === 'C' &&
    r.roots[0].__circularRef === true &&
    r.roots[0].children.length === 1 && r.roots[0].children[0].id === 'B' &&
    r.roots[0].children[0].children[0].id === 'A' &&
    r.stats.cycles === 1 && !!cycIssue &&
    /C\s*→\s*A/.test(cycIssue.text) && cycIssue.text.includes('__circularRef') &&
    r.meta.outputText.includes('__circularRef') && ms < 1000,
    'root=C 带 __circularRef，链 C→B→A，cycles=1，issue 含 "C → A"，<1s',
    { root: r.roots[0], stats: r.stats, issue: cycIssue && cycIssue.text, ms: Math.round(ms) });
});

await runCase('core', 'C12', '重复 ID 双策略结果差异与提示序号', async () => {
  const rows = [
    { id: 1, parentId: null, v: 'first' },
    { id: 1, parentId: null, v: 'last' },
    { id: 2, parentId: 1, v: 'child' }
  ];
  const f = B(rows, { dupMode: 'first' });
  const l = B(rows, { dupMode: 'last' });
  const df = f.issues.find(i => i.tag === '重复');
  const dl = l.issues.find(i => i.tag === '重复');
  record('core', 'C12a', 'first：保留首个，后者跳过并计数',
    f.roots[0].v === 'first' && f.roots[0].children.length === 1 &&
    f.stats.duplicates === 1 && f.stats.skipped === 1 && f.stats.valid === 2 &&
    !!df && df.text.includes('第 1、2 项') && df.text.includes('保留首个'),
    'root.v=first, duplicates=1, skipped=1, 提示含第 1、2 项/保留首个',
    { root: f.roots[0], stats: f.stats, issue: df && df.text });
  record('core', 'C12b', 'last：后者覆盖，不额外计数 skipped',
    l.roots[0].v === 'last' && l.roots[0].children.length === 1 &&
    l.stats.duplicates === 1 && l.stats.skipped === 0 &&
    !!dl && dl.text.includes('第 1、2 项') && dl.text.includes('保留最后'),
    'root.v=last, duplicates=1, skipped=0, 提示含保留最后',
    { root: l.roots[0], stats: l.stats, issue: dl && dl.text });
  record('core', 'C12c', '两种策略输出文本确实不同',
    f.meta.outputText !== l.meta.outputText &&
    f.meta.outputText.includes('first') && l.meta.outputText.includes('last'),
    'first 文本含 first 且不含 last 的根值；last 反之',
    { f: f.meta.outputText.slice(0, 130), l: l.meta.outputText.slice(0, 130) });
});

await runCase('core', 'C13', '非法行跳过并逐条提示，不崩溃', async () => {
  const bad = [null, 123, 'str', [], {}, { id: 2, parentId: null, name: 'ok' }];
  const r = B(bad);
  const skips = r.issues.filter(i => i.tag === '跳过');
  record('core', 'C13', '5 条非法行跳过；total=6/valid=1/skipped=5；提示含项号',
    r.roots.length === 1 && r.roots[0].id === 2 &&
    r.stats.total === 6 && r.stats.valid === 1 && r.stats.skipped === 5 &&
    skips.length === 5 && skips[0].text.includes('第 1 项') &&
    skips.every(i => i.level === 'warn'),
    'total=6, valid=1, skipped=5, 5 条 warn 级跳过提示',
    { stats: r.stats, skips: skips.map(i => i.text) });
});

await runCase('core', 'C14', '空数组 / 非数组 / 字段名空或同名 → 中文 Error', async () => {
  const empty = errOf([]);
  record('core', 'C14a', '空数组抛中文错误',
    empty.threw && /输入数组为空/.test(empty.message),
    '抛错且含"输入数组为空"', empty);
  const nonArr = errOf({ a: 1 });
  record('core', 'C14b', '非数组抛中文错误',
    nonArr.threw && /输入应为 JSON 数组/.test(nonArr.message),
    '抛错且含"输入应为 JSON 数组"', nonArr);
  const emptyField = errOf(NORMAL, { idField: '   ' });
  record('core', 'C14c', '字段名空白抛中文错误',
    emptyField.threw && /字段名不能为空/.test(emptyField.message),
    '抛错且含"字段名不能为空"', emptyField);
  const sameField = errOf(NORMAL, { idField: 'id', parentField: 'id' });
  record('core', 'C14d', '字段名同名抛中文错误',
    sameField.threw && /不能相同/.test(sameField.message),
    '抛错且含"不能相同"', sameField);
  const sameChild = errOf(NORMAL, { childrenField: 'id' });
  record('core', 'C14e', 'children 与 id 同名抛中文错误',
    sameChild.threw && /不能相同/.test(sameChild.message),
    '抛错且含"不能相同"', sameChild);
  record('core', 'C14f', 'validateOptions 直接调用给出相同校验',
    TB.validateOptions({ idField: '', parentField: 'p', childrenField: 'c' }).includes('不能为空') &&
    TB.validateOptions({ idField: 'x', parentField: 'x', childrenField: 'c' }).includes('不能相同') &&
    TB.validateOptions(DEF) === '',
    '空→不能为空 / 同名→不能相同 / 正常→空串',
    { a: TB.validateOptions({ idField: '' }), b: TB.validateOptions({ idField: 'x', parentField: 'x', childrenField: 'c' }) });
});

await runCase('core', 'C15', '5000 层深链不爆栈，自动紧凑输出', async () => {
  const rows = [];
  for (let i = 1; i <= 5000; i++) rows.push({ id: i, parentId: i - 1, name: 'n' + i });
  const t0 = performance.now();
  const r = B(rows);
  const ms = performance.now() - t0;
  report.performance.deep5000BuildMs = Math.round(ms);
  const idCount = (r.meta.outputText.match(/"id":/g) || []).length;
  const childCount = (r.meta.outputText.match(/"children":/g) || []).length;
  record('core', 'C15a', '5000 层构建成功且 maxDepth=5000',
    r.roots.length === 1 && r.stats.maxDepth === 5000 &&
    r.stats.total === 5000 && r.stats.valid === 5000 && ms < 3000,
    'roots=1, maxDepth=5000, total=5000, <3s',
    { roots: r.roots.length, stats: r.stats, ms: Math.round(ms) });
  record('core', 'C15b', '>1000 层自动切换紧凑输出并有输出提示',
    r.meta.outputText.indexOf('\n') === -1 && idCount === 5000 && childCount === 5000 &&
    r.meta.outputText.startsWith('{"id":1,') &&
    r.issues.some(i => i.tag === '输出' && i.text.includes('紧凑')),
    '无换行 / 5000 个 id / 5000 个 children / 以根开头 / 含输出提示',
    { hasNewline: r.meta.outputText.includes('\n'), idCount, childCount, head: r.meta.outputText.slice(0, 90), issues: r.issues });
});

await runCase('core', 'C16', 'stringifyJson 与原生 JSON.stringify 在 200 层逐字一致', async () => {
  const rows = [];
  for (let i = 1; i <= 200; i++) rows.push({ id: i, parentId: i - 1, name: 'n' + i });
  const r = B(rows);
  let native = '', err = '';
  try { native = JSON.stringify(r.meta.outputValue, null, 2); } catch (e) { err = String(e && e.message || e); }
  record('core', 'C16', '200 层缩进输出逐字一致（含换行）',
    !err && r.meta.outputText === native && r.meta.outputText.includes('\n') &&
    r.stats.maxDepth === 200,
    '逐字一致 / 带缩进 / depth=200',
    { same: r.meta.outputText === native, err, lenA: r.meta.outputText.length, lenB: native.length, depth: r.stats.maxDepth });
  const compactSame = TB.stringifyJson({ a: [1, null, 'x'], b: { c: true } }, 0) ===
    JSON.stringify({ a: [1, null, 'x'], b: { c: true } });
  record('core', 'C16b', 'stringifyJson 紧凑模式与原生一致',
    compactSame, '逐字一致', { a: TB.stringifyJson({ a: [1, null, 'x'], b: { c: true } }, 0) });
});

await runCase('core', 'C17', '宽树 5000 节点构建 < 1s 且结构正确', async () => {
  const rows = [{ id: 1, parentId: null, name: 'root' }];
  for (let i = 2; i <= 5000; i++) rows.push({ id: i, parentId: 1, name: 'c' + i });
  const t0 = performance.now();
  const r = B(rows);
  const ms = performance.now() - t0;
  report.performance.wide5000BuildMs = Math.round(ms);
  record('core', 'C17', '宽树 5000 节点：roots=1, children=4999, <1s',
    ms < 1000 && r.roots.length === 1 &&
    r.roots[0].children.length === 4999 && r.stats.maxDepth === 2 &&
    r.stats.total === 5000 && r.stats.valid === 5000,
    'ms<1000 / children=4999 / maxDepth=2 / total=5000',
    { ms: Math.round(ms), roots: r.roots.length, children: r.roots[0].children.length, stats: r.stats });
});

await runCase('core', 'C18', 'resolveFields / shallowOutput / 常量导出可用', async () => {
  const rows = [{ _id: 1, parent_id: null }, { _id: 2, parent_id: 1 }];
  const issues = [];
  const on = TB.resolveFields(rows, { idField: 'id', parentField: 'parentId', childrenField: 'children', autoDetect: true }, issues);
  const issues2 = [];
  const off = TB.resolveFields(rows, { idField: 'id', parentField: 'parentId', childrenField: 'children', autoDetect: false }, issues2);
  record('core', 'C18a', 'resolveFields 开/关探测行为正确',
    on.idField === '_id' && on.parentField === 'parent_id' && issues.length === 2 &&
    off.idField === 'id' && off.parentField === 'parentId' && issues2.length === 0,
    'on→(_id,parent_id,2 提示)，off→(id,parentId,0 提示)',
    { on, issues, off, issues2 });
  const fields = { idField: 'id', parentField: 'parentId', childrenField: 'children' };
  const so = TB.shallowOutput({ row: { id: 7, parentId: null, name: 'x', children: [] }, circular: true }, fields, { keepOther: true, removeParent: false });
  record('core', 'C18b', 'shallowOutput 保留字段并标记循环',
    so.id === 7 && so.parentId === null && so.name === 'x' &&
    so.children === undefined && so.__circularRef === true,
    '保留 id/parentId/name，剔除 children，置 __circularRef',
    so);
  record('core', 'C18c', '导出 API 与候选常量齐全',
    ['buildTree', 'resolveFields', 'isRootMarker', 'stringifyJson', 'shallowOutput',
      'makeIssue', 'collectKeys', 'validateOptions', 'typeName'].every(k => typeof TB[k] === 'function') &&
    Array.isArray(TB.ID_CANDIDATES) && Array.isArray(TB.PARENT_CANDIDATES) &&
    TB.ID_CANDIDATES.includes('_id') && TB.PARENT_CANDIDATES.includes('parent_id'),
    '11 个导出存在，候选常量含 _id/parent_id',
    Object.keys(TB));
});

await runCase('core', 'C19', '八类 issue tag 的标签文案与级别', async () => {
  const rows = [
    { id: 'A', parentId: 'B' }, { id: 'B', parentId: 'A' },       // 循环
    { id: 9, parentId: 999 },                                     // 孤儿
    { id: 10, parentId: 10 },                                     // 自引用
    { id: 11, parentId: null },                                   // 正常（探测用）
    null                                                          // 跳过
  ];
  const r = B(rows, { autoDetect: true });
  const tags = r.issues.map(i => i.tag);
  record('core', 'C19a', '跳过/孤儿/自引用/循环 四类 tag 出现且级别 warn',
    ['跳过', '孤儿', '自引用', '循环'].every(t => tags.includes(t)) &&
    r.issues.filter(i => ['跳过', '孤儿', '自引用', '循环'].includes(i.tag)).every(i => i.level === 'warn'),
    '四类 tag 均出现且 level=warn', tags);
  record('core', 'C19b', 'makeIssue 结构正确',
    JSON.stringify(TB.makeIssue('info', '探测', 'x')) === JSON.stringify({ level: 'info', tag: '探测', text: 'x' }),
    '{level,tag,text}', TB.makeIssue('info', '探测', 'x'));
});

console.log('\n===== 二、注册表与工具 run()（R01–R09） =====');

await runCase('registry', 'R01', '静态：index.html 加载顺序与 README 工具数', async () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const tbPos = html.indexOf('js/core/treebuild.js');
  const pwdPos = html.indexOf('js/core/password.js');
  const uiMark = html.indexOf('<!-- UI 层 -->');
  const domPos = html.indexOf('js/ui/dom.js');
  record('registry', 'R01a', 'treebuild.js 位于 core 段（password.js 之后、UI 层之前）',
    tbPos > pwdPos && tbPos > 0 && tbPos < uiMark && uiMark < domPos,
    'password.js < treebuild.js < <!-- UI 层 --> < dom.js',
    { pwdPos, tbPos, uiMark, domPos });
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  record('registry', 'R01b', 'README 工具数 70 且含新工具条目与截图引用',
    /内置 \*\*70 个\*\*/.test(readme) && /功能总览（70 个工具）/.test(readme) &&
    readme.includes('JSON 数组 → 父子结构') &&
    readme.includes('docs/screenshots/10-parent-child-tree.png') &&
    !/内置 \*\*69 个\*\*/.test(readme),
    '工具数 70、新工具条目、10 号截图引用齐全且无残留 69',
    { has70: readme.includes('**70 个**'), hasEntry: readme.includes('JSON 数组 → 父子结构') });
});

await runCase('registry', 'R02', '动态：工具总数 70 且新工具可查', async () => {
  record('registry', 'R02a', '注册表工具总数 = 70',
    REG.tools.length === 70, '70', REG.tools.length);
  const t = REG.get('convert-parent-child');
  record('registry', 'R02b', 'convert-parent-child 可查且元数据正确',
    !!t && t.id === 'convert-parent-child' && t.cat === 'convert' &&
    t.name === 'JSON 数组 → 父子结构' && t.outLang === 'json' && t.view === 'text',
    'id/cat/name/outLang/view 全部正确',
    t && { id: t.id, cat: t.cat, name: t.name, outLang: t.outLang, view: t.view });
  record('registry', 'R02c', '工具 id 全局唯一',
    new Set(REG.tools.map(x => x.id)).size === REG.tools.length,
    '70 个 id 唯一', new Set(REG.tools.map(x => x.id)).size);
});

await runCase('registry', 'R03', '动态：7 个参数 id/类型/默认值齐全', async () => {
  const t = REG.get('convert-parent-child');
  const spec = [
    { id: 'idField', type: 'text', default: 'id' },
    { id: 'parentField', type: 'text', default: 'parentId' },
    { id: 'childrenField', type: 'text', default: 'children' },
    { id: 'duplicateStrategy', type: 'select', default: 'first' },
    { id: 'autoDetect', type: 'checkbox', default: true },
    { id: 'removeParentField', type: 'checkbox', default: false },
    { id: 'keepOtherFields', type: 'checkbox', default: true }
  ];
  record('registry', 'R03a', '参数数量 = 7 且 id 顺序正确',
    !!t && t.params.length === 7 &&
    JSON.stringify(t.params.map(p => p.id)) === JSON.stringify(spec.map(s => s.id)),
    'id 顺序 ' + spec.map(s => s.id).join(','), t && t.params.map(p => p.id));
  record('registry', 'R03b', '参数类型与默认值正确',
    spec.every((s, i) => t.params[i].type === s.type && t.params[i].default === s.default) &&
    JSON.stringify(t.defaultParams) === JSON.stringify(Object.fromEntries(spec.map(s => [s.id, s.default]))),
    '类型/默认值逐项对齐', t && t.defaultParams);
  const dup = t.params.find(p => p.id === 'duplicateStrategy');
  record('registry', 'R03c', 'duplicateStrategy 选项为 first/last',
    !!dup && dup.options.length === 2 &&
    dup.options[0].value === 'first' && dup.options[1].value === 'last',
    '[first,last]', dup && dup.options.map(o => o.value));
});

const RUNCTX = (value, okParse = true) => ({ parseInput: () => ({ ok: okParse, value, error: okParse ? undefined : 'JSON 解析失败' }) });
function runTool(rows, overrides) {
  const t = REG.get('convert-parent-child');
  return t.run(JSON.stringify(rows), Object.assign({}, t.defaultParams, overrides || {}), RUNCTX(rows));
}

await runCase('registry', 'R04', '工具 run()：正常输入 → JSON 文本 + data + 摘要 notices', async () => {
  const res = runTool(NORMAL);
  let parsed = null, err = '';
  try { parsed = JSON.parse(res.output); } catch (e) { err = e.message; }
  record('registry', 'R04a', '输出为合法 JSON 且与 data 深等价',
    !res.error && !err && !!parsed && parsed.id === 1 &&
    JSON.stringify(parsed) === JSON.stringify(res.data),
    'JSON.parse 成功且 output 与 data 深等价',
    { err, error: res.error, head: (res.output || '').slice(0, 120) });
  const summary = res.notices && res.notices[0];
  record('registry', 'R04b', '摘要格式正确（输入 4 / 有效 4 / 根 1 / 深度 3 / 自动处理 0）',
    typeof summary === 'string' &&
    summary.startsWith('构建完成 · 输入 4 项 / 有效 4 项 / 根 1 个 / 最大深度 3，自动处理 0 项。'),
    '构建完成 · 输入 4 项 / 有效 4 项 / 根 1 个 / 最大深度 3，自动处理 0 项。', summary);
  record('registry', 'R04c', 'view=text / outLang=json / notices 为字符串数组',
    res.view === 'text' && res.outLang === 'json' &&
    Array.isArray(res.notices) && res.notices.every(n => typeof n === 'string'),
    'view=text, outLang=json, notices 全字符串',
    { view: res.view, outLang: res.outLang, notices: res.notices });
});

await runCase('registry', 'R05', '工具 run()：issues 转为 [tag] text 且 K 计数为非 info 数', async () => {
  const rows = [
    { id: 1, parentId: null },
    { id: 2, parentId: 999 },
    { id: 3, parentId: 3 },
    null
  ];
  const res = runTool(rows);
  record('registry', 'R05', 'notices 含 [孤儿]/[自引用]/[跳过]，摘要 K=3',
    res.notices.some(n => n.startsWith('[孤儿] ')) &&
    res.notices.some(n => n.startsWith('[自引用] ')) &&
    res.notices.some(n => n.startsWith('[跳过] ')) &&
    res.notices[0].includes('自动处理 3 项'),
    '三类 tag 提示齐全且 K=3', res.notices);
});

await runCase('registry', 'R06', '工具 run()：参数映射（策略/移除父字段/字段名）', async () => {
  const dupRows = [
    { id: 1, parentId: null, v: 'first' },
    { id: 1, parentId: null, v: 'last' },
    { id: 2, parentId: 1 }
  ];
  const f = runTool(dupRows, { duplicateStrategy: 'first' });
  const l = runTool(dupRows, { duplicateStrategy: 'last' });
  record('registry', 'R06a', 'duplicateStrategy=first/last 输出不同',
    f.output !== l.output && f.data.v === 'first' && l.data.v === 'last',
    'v 分别为 first / last', { f: f.data.v, l: l.data.v });
  const rm = runTool(NORMAL, { removeParentField: true });
  record('registry', 'R06b', 'removeParentField=true 移除 parentId',
    rm.data.parentId === undefined && rm.data.name === '总部' &&
    rm.data.children[0].parentId === undefined,
    '输出无 parentId 但保留 name', Object.keys(rm.data));
  const noOther = runTool(NORMAL, { keepOtherFields: false });
  record('registry', 'R06c', 'keepOtherFields=false 仅 id/children',
    Object.keys(noOther.data).sort().join(',') === 'children,id',
    'keys=[children,id]', Object.keys(noOther.data));
  const customRows = [{ uid: 'r', par: null, itemsOld: 1, label: '根' }, { uid: 'c', par: 'r', label: '子' }];
  const custom = runTool(customRows, { idField: 'uid', parentField: 'par', childrenField: 'items' });
  record('registry', 'R06d', '自定义 id/parent/children 字段名可执行',
    !custom.error && custom.data.uid === 'r' &&
    Array.isArray(custom.data.items) && custom.data.items[0].uid === 'c' &&
    custom.data.children === undefined,
    'root.uid=r，items=[c]，无 children',
    { error: custom.error, data: custom.data });
});

await runCase('registry', 'R07', '工具 run()：非法 JSON / 非数组 / 空数组 → 中文错误', async () => {
  const t = REG.get('convert-parent-child');
  const badJson = t.run('{bad', Object.assign({}, t.defaultParams), RUNCTX(null, false));
  record('registry', 'R07a', '非法 JSON 返回中文错误',
    !!badJson.error && /JSON/.test(badJson.error), '含 JSON 的中文错误', badJson.error);
  const nonArr = runTool({ a: 1 });
  record('registry', 'R07b', '非数组返回中文错误',
    !!nonArr.error && /输入应为 JSON 数组/.test(nonArr.error),
    '含"输入应为 JSON 数组"', nonArr.error);
  const emptyArr = runTool([]);
  record('registry', 'R07c', '空数组返回中文错误',
    !!emptyArr.error && /输入数组为空/.test(emptyArr.error),
    '含"输入数组为空"', emptyArr.error);
  const emptyInput = t.run('', Object.assign({}, t.defaultParams), RUNCTX(''));
  record('registry', 'R07d', '空输入串返回中文错误',
    !!emptyInput.error && /输入为空/.test(emptyInput.error),
    '含"输入为空"', emptyInput.error);
});

await runCase('registry', 'R08', '工具 run()：字段名空/同名 → 中文错误', async () => {
  const empty = runTool(NORMAL, { idField: ' ' });
  const same = runTool(NORMAL, { idField: 'id', parentField: 'id' });
  const sameChild = runTool(NORMAL, { childrenField: 'parentId' });
  record('registry', 'R08', '字段名空或同名均由 run() 返回中文错误',
    !!empty.error && /字段名不能为空/.test(empty.error) &&
    !!same.error && /不能相同/.test(same.error) &&
    !!sameChild.error && /不能相同/.test(sameChild.error),
    '空→字段名不能为空；同名→不能相同',
    { empty: empty.error, same: same.error, sameChild: sameChild.error });
});

await runCase('registry', 'R09', '全量 70 工具：新增工具未破坏既有工具可执行性', async () => {
  const input = '{"a":1,"b":[1,2,3]}';
  const ctx = { parseInput: () => ({ ok: true, value: { a: 1, b: [1, 2, 3] } }) };
  const broken = [];
  for (const t of REG.tools) {
    try {
      const res = t.run(input, Object.assign({}, t.defaultParams), ctx);
      if (!res || typeof res !== 'object') broken.push(t.id + ':无返回');
    } catch (e) { broken.push(t.id + ':抛异常 ' + (e && e.message)); }
  }
  record('registry', 'R09', '70 工具逐一调用 run() 无异常、均有返回',
    broken.length === 0, '0 个异常', broken);
});

/* ===== 汇总与路由 ===== */
const total = report.assertions.length;
const passed = report.assertions.filter(a => a.passed).length;
const failed = report.assertions.filter(a => !a.passed);
report.summary = {
  total, passed, failed: failed.length,
  byLayer: {
    core: { total: report.layers.core.length, passed: report.layers.core.filter(a => a.passed).length },
    registry: { total: report.layers.registry.length, passed: report.layers.registry.filter(a => a.passed).length }
  }
};
report.routing = failed.length === 0 ? 'NoOne' : '待分析（见 defects / failed 明细）';
report.verdict = failed.length === 0 ? 'PASS' : 'FAIL';
report.finishedAt = new Date().toISOString();

console.log('\n=== Node 层专项：通过 ' + passed + ' / ' + total + '，失败 ' + failed.length + ' ===');
if (failed.length) {
  console.log('失败明细：');
  failed.forEach(f => console.log('  [' + f.id + '] ' + f.name + ' | 期望=' + fmt(f.expected) + ' 实际=' + fmt(f.actual)));
}
console.log('路由判定：' + report.routing + '  最终判定：' + report.verdict);
fs.writeFileSync(RESULTS, JSON.stringify(report, null, 2), 'utf8');
process.exit(0);
