/* eslint-disable */
/**
 * ddl-check.mjs —— 建表 DDL（Oracle 新增 + 命名风格修复）Node 层专项
 * 运行：node .qa/ddl-check.mjs
 * 只读产品代码；结果写入 .qa/ddl-results.json。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');

/* ============================ 断言框架 ============================ */
const results = [];
let curGroup = '(none)';
function group(g) { curGroup = g; }
function rec(name, pass, detail) {
  results.push({ group: curGroup, name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
  return !!pass;
}
function eq(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  return rec(name, pass, pass ? '' : 'expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
}
function ok(name, cond, detail) { return rec(name, !!cond, detail); }
function hasCol(out, q, name, type) {
  const needle = q + name + q + ' ' + type;
  return out.indexOf(needle) >= 0;
}

/* ============================ 加载 core ============================ */
globalThis.window = globalThis;
function loadScript(p) { vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); }
for (const f of ['vendor/libs.js', 'js/core/json.js', 'js/core/convert.js', 'js/core/codegen.js', 'js/core/codec.js', 'js/core/analyze.js']) loadScript(path.join(WEB, f));
loadScript(path.join(WEB, 'js/tools-registry.js'));
const G = globalThis.JTCore.codegen;
const reg = globalThis.JT.registry;
if (!G || typeof G.toDDL !== 'function') { console.error('FATAL: JTCore.codegen.toDDL 未加载'); process.exit(2); }

/* ============================ A. 四方言头注释与引号 ============================ */
group('A-四方言头注释');
const simple = { id: 1, name: '张三' };
const DIALECT_HEADER = {
  mysql: 'MySQL', postgresql: 'PostgreSQL', sqlite: 'SQLite', oracle: 'Oracle'
};
for (const d of Object.keys(DIALECT_HEADER)) {
  const q = d === 'mysql' ? '`' : '"';
  const out = G.toDDL(simple, { dialect: d, tableName: 't_demo', nameStyle: 'snake', withComments: false, primaryKey: 'id' });
  ok(d + ' 头注释正确', out.indexOf('-- ' + DIALECT_HEADER[d] + ' 建表语句') === 0, out.split('\n')[0]);
  ok(d + ' CREATE TABLE 使用正确引号', out.indexOf('CREATE TABLE ' + q + 't_demo' + q + ' (') >= 0, out.split('\n')[1]);
  ok(d + ' 含 PRIMARY KEY 列', /PRIMARY KEY/.test(out));
  ok(d + ' 输出以 ); 结尾', /\);\s*$/.test(out));
}

/* ============================ B. Oracle 各类型映射逐项 ============================ */
group('B-Oracle类型映射');
const typeObj = {
  intCol: 42,
  numCol: 3.14,
  boolCol: true,
  dateCol: '2024-01-01',
  dtCol: '2024-01-01T12:30:00Z',
  strCol: 'hello',
  objCol: { a: 1 },
  arrCol: [1, 2],
  nullCol: null
};
const ora = G.toDDL(typeObj, { dialect: 'oracle', tableName: 'T_TYPES', nameStyle: 'keep', withComments: true });
ok('Oracle integer → NUMBER(10)', hasCol(ora, '"', 'intCol', 'NUMBER(10)'), ora);
ok('Oracle number → NUMBER', hasCol(ora, '"', 'numCol', 'NUMBER'), ora);
ok('Oracle boolean → NUMBER(1)', hasCol(ora, '"', 'boolCol', 'NUMBER(1)'), ora);
ok('Oracle date → DATE', hasCol(ora, '"', 'dateCol', 'DATE'), ora);
ok('Oracle date-time → TIMESTAMP', hasCol(ora, '"', 'dtCol', 'TIMESTAMP'), ora);
ok('Oracle string → VARCHAR2(255)', hasCol(ora, '"', 'strCol', 'VARCHAR2(255)'), ora);
ok('Oracle 嵌套对象 → CLOB', hasCol(ora, '"', 'objCol', 'CLOB'), ora);
ok('Oracle 数组 → CLOB', hasCol(ora, '"', 'arrCol', 'CLOB'), ora);
ok('Oracle null → CLOB', hasCol(ora, '"', 'nullCol', 'CLOB'), ora);
ok('Oracle 布尔列注释保留 boolean', /-- boolCol : boolean/.test(ora), ora);
ok('Oracle 不出现 MySQL/PG 专有类型', !/TINYINT|JSONB|DOUBLE PRECISION|DATETIME/.test(ora), ora);
ok('Oracle 不出现无长度裸 VARCHAR(', !/\bVARCHAR\(/.test(ora), ora);
const bigSchema = { type: 'object', props: { big: { type: 'string', format: 'longtext' } }, required: { big: true } };
const oraLong = G.toDDL(null, { dialect: 'oracle', schema: bigSchema, nameStyle: 'keep', withComments: false });
ok('Oracle longtext → CLOB', hasCol(oraLong, '"', 'big', 'CLOB'), oraLong);
const oraEmpty = G.toDDL({}, { dialect: 'oracle', tableName: 'T_EMPTY' });
ok('Oracle 空对象兜底列类型为 NUMBER(10)', /"id" NUMBER\(10\) PRIMARY KEY/.test(oraEmpty), oraEmpty);

/* ============================ C. 四种命名风格 ============================ */
group('C-命名风格');
const nameObj = { userName: '张三', user_id: 1, HTTPCode: 200, 'created-at': '2024-01-01' };
const STYLE_EXPECT = {
  snake: ['user_name', 'user_id', 'http_code', 'created_at'],
  upper_snake: ['USER_NAME', 'USER_ID', 'HTTP_CODE', 'CREATED_AT'],
  camel: ['userName', 'userId', 'hTTPCode', 'createdAt'],
  pascal: ['UserName', 'UserId', 'HTTPCode', 'CreatedAt'],
  keep: ['userName', 'user_id', 'HTTPCode', 'created-at']
};
for (const style of Object.keys(STYLE_EXPECT)) {
  const q = '`';
  const out = G.toDDL(nameObj, { dialect: 'mysql', nameStyle: style, withComments: false });
  const cols = STYLE_EXPECT[style];
  cols.forEach((c) => ok(style + ' 列名含 ' + c, out.indexOf(q + c + q + ' ') >= 0, out));
  const lines = out.split('\n').filter((l) => /^\s{2}`/.test(l));
  eq(style + ' 列数 = 4', lines.length, 4);
  const outWithC = G.toDDL(nameObj, { dialect: 'mysql', nameStyle: style, withComments: true });
  ok(style + ' 注释保留全部 4 个原始 JSON 键', ['userName', 'user_id', 'HTTPCode', 'created-at'].every((k) => outWithC.indexOf('-- ' + k + ' :') >= 0), outWithC);
}
eq('styleName upper_snake: userName → USER_NAME', G.styleName('userName', 'upper_snake'), 'USER_NAME');
eq('styleName upper_snake: HTTPCode → HTTP_CODE', G.styleName('HTTPCode', 'upper_snake'), 'HTTP_CODE');
eq('styleName upper_snake: created-at → CREATED_AT', G.styleName('created-at', 'upper_snake'), 'CREATED_AT');
const defaultOut = G.toDDL(nameObj, { dialect: 'mysql', withComments: false });
ok('未指定 nameStyle 时默认 camel（user_name 不出现）', defaultOut.indexOf('`user_name`') < 0, defaultOut);
ok('未指定 nameStyle 时默认 camel（userName 出现）', defaultOut.indexOf('`userName`') >= 0, defaultOut);

/* ============================ D. 主键跨风格匹配且只标一次 ============================ */
group('D-主键跨风格');
const pk1 = G.toDDL({ user_id: 1, userName: 'x' }, { dialect: 'mysql', nameStyle: 'camel', primaryKey: 'user_id', withComments: false });
ok('pk=user_id 在 camel 列 userId 上被识别', /`userId` INT PRIMARY KEY/.test(pk1), pk1);
eq('camel 主键仅标注一次', (pk1.match(/PRIMARY KEY/g) || []).length, 1);
const pk2 = G.toDDL({ user_id: 1, userId: 2, name: 'x' }, { dialect: 'mysql', nameStyle: 'snake', primaryKey: 'user_id', withComments: false });
eq('归一化同名时 PRIMARY KEY 只出现 1 次', (pk2.match(/PRIMARY KEY/g) || []).length, 1, pk2);
ok('同名第二列带 NOT NULL 而非 PK', /`user_id` INT NOT NULL/.test(pk2), pk2);
const pk3 = G.toDDL({ userId: 1 }, { dialect: 'postgresql', nameStyle: 'pascal', primaryKey: 'user_id', withComments: false });
ok('pk=user_id 在 pascal 列 UserId 上被识别', /"UserId" INTEGER PRIMARY KEY/.test(pk3), pk3);
const pk4 = G.toDDL({ 'user-id': 1 }, { dialect: 'sqlite', nameStyle: 'camel', primaryKey: 'user_id', withComments: false });
ok('连字符键 camel 化后主键仍匹配', /"userId" INTEGER PRIMARY KEY/.test(pk4), pk4);
const pk6 = G.toDDL({ user_id: 1 }, { dialect: 'oracle', nameStyle: 'upper_snake', primaryKey: 'user_id', withComments: false });
ok('pk=user_id 在 UPPER_SNAKE_CASE 列 USER_ID 上被识别', /"USER_ID" NUMBER\(10\) PRIMARY KEY/.test(pk6), pk6);
eq('UPPER_SNAKE_CASE 主键仅标注一次', (pk6.match(/PRIMARY KEY/g) || []).length, 1);
const pk5 = G.toDDL({ id: 1, name: 'x' }, { dialect: 'oracle', nameStyle: 'keep', primaryKey: 'id', withComments: false });
ok('Oracle 主键 NUMBER(10)+PRIMARY KEY', /"id" NUMBER\(10\) PRIMARY KEY/.test(pk5), pk5);
const noPk = G.toDDL({ id: 1, name: 'x' }, { dialect: 'mysql', nameStyle: 'snake', primaryKey: '', withComments: false });
ok('未指定主键时列均为 NOT NULL 且无 PRIMARY KEY', noPk.indexOf('PRIMARY KEY') < 0 && /`id` INT NOT NULL/.test(noPk), noPk);

/* ============================ E. 旧三方言类型映射回归不变 ============================ */
group('E-旧方言类型回归');
const legacyObj = {
  intVal: 1, floatVal: 2.5, flag: true,
  day: '2024-01-01', ts: '2024-01-01T10:00:00Z', title: 'abc',
  obj: { k: 1 }, arr: [1]
};
const mysqlOut = G.toDDL(legacyObj, { dialect: 'mysql', nameStyle: 'snake', withComments: false });
ok('MySQL integer → INT', hasCol(mysqlOut, '`', 'int_val', 'INT'), mysqlOut);
ok('MySQL number → DOUBLE', hasCol(mysqlOut, '`', 'float_val', 'DOUBLE'), mysqlOut);
ok('MySQL boolean → TINYINT(1)', hasCol(mysqlOut, '`', 'flag', 'TINYINT(1)'), mysqlOut);
ok('MySQL date → DATE', hasCol(mysqlOut, '`', 'day', 'DATE'), mysqlOut);
ok('MySQL date-time → DATETIME', hasCol(mysqlOut, '`', 'ts', 'DATETIME'), mysqlOut);
ok('MySQL string → VARCHAR(255)', hasCol(mysqlOut, '`', 'title', 'VARCHAR(255)'), mysqlOut);
ok('MySQL 对象 → JSON', hasCol(mysqlOut, '`', 'obj', 'JSON'), mysqlOut);
ok('MySQL 数组 → JSON', hasCol(mysqlOut, '`', 'arr', 'JSON'), mysqlOut);
const pgOut = G.toDDL(legacyObj, { dialect: 'postgresql', nameStyle: 'snake', withComments: false });
ok('PG integer → INTEGER', hasCol(pgOut, '"', 'int_val', 'INTEGER'), pgOut);
ok('PG number → DOUBLE PRECISION', hasCol(pgOut, '"', 'float_val', 'DOUBLE PRECISION'), pgOut);
ok('PG boolean → BOOLEAN', hasCol(pgOut, '"', 'flag', 'BOOLEAN'), pgOut);
ok('PG date → DATE', hasCol(pgOut, '"', 'day', 'DATE'), pgOut);
ok('PG date-time → TIMESTAMP', hasCol(pgOut, '"', 'ts', 'TIMESTAMP'), pgOut);
ok('PG string → VARCHAR(255)', hasCol(pgOut, '"', 'title', 'VARCHAR(255)'), pgOut);
ok('PG 对象 → JSONB', hasCol(pgOut, '"', 'obj', 'JSONB'), pgOut);
const liteOut = G.toDDL(legacyObj, { dialect: 'sqlite', nameStyle: 'snake', withComments: false });
ok('SQLite integer → INTEGER', hasCol(liteOut, '"', 'int_val', 'INTEGER'), liteOut);
ok('SQLite number → REAL', hasCol(liteOut, '"', 'float_val', 'REAL'), liteOut);
ok('SQLite boolean → INTEGER', hasCol(liteOut, '"', 'flag', 'INTEGER'), liteOut);
ok('SQLite date → TEXT', hasCol(liteOut, '"', 'day', 'TEXT'), liteOut);
ok('SQLite date-time → TEXT', hasCol(liteOut, '"', 'ts', 'TEXT'), liteOut);
ok('SQLite 对象 → TEXT', hasCol(liteOut, '"', 'obj', 'TEXT'), liteOut);
const mysqlEmpty = G.toDDL({}, { dialect: 'mysql' });
const pgEmpty = G.toDDL({}, { dialect: 'postgresql' });
const liteEmpty = G.toDDL({}, { dialect: 'sqlite' });
ok('MySQL 空对象兜底 → INT', /`id` INT PRIMARY KEY/.test(mysqlEmpty), mysqlEmpty);
ok('PG 空对象兜底 → INTEGER', /"id" INTEGER PRIMARY KEY/.test(pgEmpty), pgEmpty);
ok('SQLite 空对象兜底 → INTEGER', /"id" INTEGER PRIMARY KEY/.test(liteEmpty), liteEmpty);

/* ============================ F. 注释开关与嵌套提示 ============================ */
group('F-注释与嵌套提示');
const withC = G.toDDL({ a: 1 }, { dialect: 'mysql', nameStyle: 'keep', withComments: true });
const noC = G.toDDL({ a: 1 }, { dialect: 'mysql', nameStyle: 'keep', withComments: false });
ok('withComments=true 含原键注释', /-- a : integer/.test(withC), withC);
ok('withComments=false 不含原键注释', !/-- a :/.test(noC), noC);
const nested = G.toDDL({ a: { b: 1 }, c: 2 }, { dialect: 'mysql', nameStyle: 'keep', withComments: false });
ok('嵌套对象生成折叠提示注释', /个嵌套对象类型，已折叠为 JSON 列/.test(nested), nested);

/* ============================ G. 注册表 convert-ddl run 端到端 ============================ */
group('G-注册表DDL端到端');
const dd = reg.get('convert-ddl');
ok('convert-ddl 可查', !!dd);
const ctx = { parseInput: () => ({ ok: true, value: { id: 1, user_id: 2, name: 'x', active: true } }) };
const rOra = dd.run('', { dialect: 'oracle', tableName: 'T_EMP', primaryKey: 'id', withComments: true, nameStyle: 'snake' }, ctx);
ok('run(oracle) 无 error', !!rOra && !rOra.error, JSON.stringify(rOra));
ok('run(oracle) 头注释含 Oracle', /-- Oracle 建表语句/.test(rOra.output), rOra.output);
ok('run(oracle) 使用双引号标识符', /"user_id"/.test(rOra.output), rOra.output);
ok('run(oracle) boolean → NUMBER(1)', /"active" NUMBER\(1\)/.test(rOra.output), rOra.output);
ok('run(oracle) 主键 NUMBER(10) 且唯一', /"id" NUMBER\(10\) PRIMARY KEY/.test(rOra.output) && (rOra.output.match(/PRIMARY KEY/g) || []).length === 1, rOra.output);
eq('run 返回 outLang=sql', rOra.outLang, 'sql');
const rMy = dd.run('', { dialect: 'mysql', tableName: 't_emp', primaryKey: '', withComments: false, nameStyle: 'snake' }, ctx);
ok('run(mysql) 头注释含 MySQL', /-- MySQL 建表语句/.test(rMy.output), rMy.output);
ok('run(mysql) 反引号标识符', /`user_id` INT/.test(rMy.output), rMy.output);
ok('run(mysql) boolean → TINYINT(1)', /`active` TINYINT\(1\)/.test(rMy.output), rMy.output);

/* ============================ 汇总 ============================ */
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
fs.writeFileSync(path.join(__dirname, 'ddl-results.json'), JSON.stringify({ summary: { total: results.length, passed, failed }, results }, null, 2), 'utf8');
console.log('\n================ 建表 DDL Node 专项 ================');
console.log('=== 通过 ' + passed + ' / 失败 ' + failed + ' ===');
if (failed) {
  console.log('--- 失败明细 ---');
  results.filter((r) => !r.pass).forEach((r) => console.log('[' + r.group + '] ' + r.name + '\n    ' + (r.detail || '').slice(0, 800)));
}
