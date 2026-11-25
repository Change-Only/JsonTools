/* eslint-disable */
/**
 * mdddl-check.mjs —— Markdown 表格 → 建表 DDL 工具 · Node 层专项证伪测试
 * 加载 web/js/core/mdddl.js（IIFE），覆盖 parseTable / mapType / toDDL / run / 注册表装配。
 * 只读产品代码，结果写入 .qa/mdddl-results.json。
 * 运行：node .qa/mdddl-check.mjs
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
  return rec(name, pass, '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}
function ok(name, cond, detail) { return rec(name, !!cond, detail === undefined ? '' : String(detail)); }
function has(name, str, sub) {
  return rec(name, String(str).indexOf(sub) >= 0, '未包含「' + sub + '」；全文：' + String(str).slice(0, 220));
}
function notHas(name, str, sub) {
  return rec(name, String(str).indexOf(sub) < 0, '不应包含「' + sub + '」；全文：' + String(str).slice(0, 220));
}
function countOf(str, sub) { return String(str).split(sub).length - 1; }

/* ============================ 加载 core 与注册表 ============================ */
globalThis.window = globalThis;
function load(rel) {
  const p = path.join(WEB, rel);
  vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p });
}
const CORES = ['vendor/libs.js', 'js/core/json.js', 'js/core/convert.js', 'js/core/codegen.js',
  'js/core/codec.js', 'js/core/analyze.js', 'js/core/password.js', 'js/core/treebuild.js', 'js/core/mdddl.js'];
for (const f of CORES) load(f);
load('js/tools-registry.js');

const M = globalThis.JTCore && globalThis.JTCore.mdddl;
const REG = globalThis.JT && globalThis.JT.registry;
const BS = String.fromCharCode(92); // 反斜杠，避免源码转义歧义

if (!M || typeof M.parseTable !== 'function' || typeof M.mapType !== 'function' || typeof M.toDDL !== 'function') {
  rec('mdddl 模块加载', false, 'window.JTCore.mdddl 未正确暴露 parseTable/mapType/toDDL');
} else {
  rec('mdddl 模块加载', true, 'parseTable/mapType/toDDL 均为函数');

  /* ============================ parseTable ============================ */
  group('parseTable-标准');
  const std =
    '| 英文名称 | 类型 | 最大长度 | 是否非空 | 参数说明 |\n' +
    '| --- | --- | --- | --- | --- |\n' +
    '| user_name | varchar | 64 | 是 | 用户登录名 |\n' +
    '| age | int |  | 否 | 年龄 |';
  let r = M.parseTable(std);
  eq('标准表无 error', r.error, '');
  eq('标准表 2 列', r.columns.length, 2);
  eq('标准表列1完整', r.columns[0], { name: 'user_name', type: 'varchar', length: 64, notNull: true, comment: '用户登录名' });
  eq('标准表列2完整', r.columns[1], { name: 'age', type: 'int', length: '', notNull: false, comment: '年龄' });

  group('parseTable-别名');
  const cn =
    '| 字段名 | 类型 | 最大长度 | 是否非空 | 说明 |\n' +
    '| --- | --- | --- | --- | --- |\n' +
    '| id | int |  | 是 | 主键编号 |';
  r = M.parseTable(cn);
  eq('中文别名无 error', r.error, '');
  eq('中文别名列解析', r.columns[0], { name: 'id', type: 'int', length: '', notNull: true, comment: '主键编号' });
  const en =
    '| name | type | length | not null | comment |\n' +
    '| :--- | ---: | :---: | --- | ---: |\n' +
    '| email | varchar | 128 | Y | 邮箱 |';
  r = M.parseTable(en);
  eq('英文别名+对齐行无 error', r.error, '');
  eq('英文别名列解析', r.columns[0], { name: 'email', type: 'varchar', length: 128, notNull: true, comment: '邮箱' });

  group('parseTable-无首尾竖线与对齐');
  const noBar =
    '英文名称 | 类型 | 最大长度 | 是否非空 | 参数说明\n' +
    'user_name | varchar | 32 | 是 | 名称';
  r = M.parseTable(noBar);
  eq('无首尾 | 无 error', r.error, '');
  eq('无首尾 | 列解析', r.columns[0], { name: 'user_name', type: 'varchar', length: 32, notNull: true, comment: '名称' });
  const align =
    '| name | type | length | not null | comment |\n' +
    '| :--- | ---: | :---: | :---: | ---: |\n' +
    '| col_a | varchar | 10 | 是 | 说明 |';
  r = M.parseTable(align);
  eq('对齐行被跳过', r.columns.length, 1);
  eq('对齐行列内容', r.columns[0].name, 'col_a');

  group('parseTable-转义竖线');
  const esc = '| name | type | length | not null | comment |\n' +
    '| --- | --- | --- | --- | --- |\n' +
    '| col_a | varchar | 10 | 是 | a' + BS + '|b |';
  r = M.parseTable(esc);
  eq('转义竖线：仍为 1 列', r.columns.length, 1);
  eq('转义竖线：comment 还原为 a|b', r.columns[0].comment, 'a|b');
  eq('转义竖线：name 正确', r.columns[0].name, 'col_a');

  group('parseTable-列数不足与超出');
  const shortLong =
    '| name | type | length | not null | comment |\n' +
    '| --- | --- | --- | --- | --- |\n' +
    '| col_a | varchar |\n' +
    '| col_b | int |  | 否 | 备注 | extra |';
  r = M.parseTable(shortLong);
  eq('不足+超出共 2 行', r.columns.length, 2);
  ok('列数不足 notice', r.notices.some((n) => n.indexOf('列数不足') >= 0), JSON.stringify(r.notices));
  ok('列数超出 notice', r.notices.some((n) => n.indexOf('列数超出') >= 0), JSON.stringify(r.notices));

  group('parseTable-空行缺名');
  const blanks =
    '| name | type |\n' +
    '\n' +
    '| col_a | varchar |\n' +
    '|  | int |\n' +
    '| col_b | int |';
  r = M.parseTable(blanks);
  eq('空行/缺名后剩 2 列', r.columns.length, 2);
  ok('缺名称行 notice', r.notices.some((n) => n.indexOf('缺少英文名称') >= 0), JSON.stringify(r.notices));

  group('parseTable-无分隔行');
  const noSep = '| name | type |\n| col_a | varchar |';
  r = M.parseTable(noSep);
  eq('无 --- 分隔行仍解析', r.columns.length, 1);
  eq('无 --- 首行内容', r.columns[0].name, 'col_a');

  group('parseTable-位置回退');
  const fallback =
    '| A | B | C | D | E |\n' +
    '| --- | --- | --- | --- | --- |\n' +
    '| col | varchar | 12 | 是 | 说明 |';
  r = M.parseTable(fallback);
  eq('位置回退无 error', r.error, '');
  eq('位置回退列解析', r.columns[0], { name: 'col', type: 'varchar', length: 12, notNull: true, comment: '说明' });
  ok('位置回退 notice', r.notices.some((n) => n.indexOf('按 5 列默认顺序') >= 0), JSON.stringify(r.notices));

  group('parseTable-无法识别表头报错');
  r = M.parseTable('| A | B |\n| col | varchar |');
  ok('无法识别表头返回 error', !!r.error, r.error);
  ok('无法识别表头 error 为中文', r.error.indexOf('无法识别表头') >= 0, r.error);
  eq('errorLine 指向表头行', r.errorLine, 1);

  group('parseTable-空输入报错');
  r = M.parseTable('');
  ok('空输入 error', !!r.error && r.error.indexOf('输入为空') >= 0, r.error);
  r = M.parseTable('   \n\n  ');
  ok('纯空白行 error', !!r.error && r.error.indexOf('输入为空') >= 0, r.error);

  group('parseTable-notNull全集');
  function nnRow(v) {
    return '| name | type | length | not null | comment |\n| --- | --- | --- | --- | --- |\n| c | varchar | 10 | ' + v + ' | x |';
  }
  for (const v of ['是', 'Y', 'yes', 'TRUE', '1', '非空', 'not null', '必填']) {
    const rr = M.parseTable(nnRow(v));
    eq('notNull 真值 ' + v, rr.columns[0] && rr.columns[0].notNull, true);
  }
  for (const v of ['否', 'N', 'no', 'false', '0', '空', '可空', '']) {
    const rr = M.parseTable(nnRow(v));
    eq('notNull 假值 ' + (v || '(空)'), rr.columns[0] && rr.columns[0].notNull, false);
  }
  const rrBad = M.parseTable(nnRow('unknown'));
  eq('notNull 非法值按否', rrBad.columns[0].notNull, false);
  ok('notNull 非法值 notice', rrBad.notices.some((n) => n.indexOf('无法识别') >= 0), JSON.stringify(rrBad.notices));

  group('parseTable-内嵌类型长度');
  r = M.parseTable('| name | type | length | not null | comment |\n| --- | --- | --- | --- | --- |\n| c | varchar(64) |  | 否 | x |');
  eq('varchar(64) type', r.columns[0].type, 'varchar');
  eq('varchar(64) length', r.columns[0].length, 64);
  r = M.parseTable('| name | type | length | not null | comment |\n| --- | --- | --- | --- | --- |\n| c | decimal(10,2) |  | 否 | x |');
  eq('decimal(10,2) type', r.columns[0].type, 'decimal');
  eq('decimal(10,2) length=10', r.columns[0].length, 10);

  /* ============================ mapType ============================ */
  group('mapType-整数');
  function mt(name, type, len, dialect, expected, opts) {
    const rep = [];
    const o = Object.assign({ report: rep }, opts || {});
    const got = M.mapType(type, len, dialect, o);
    eq(name, got, expected);
    return rep;
  }
  mt('int→INT(mysql)', 'int', 64, 'mysql', 'INT');
  mt('int→INTEGER(pg)', 'int', 64, 'postgresql', 'INTEGER');
  mt('int→NUMBER(10)(oracle)', 'int', 64, 'oracle', 'NUMBER(10)');
  mt('integer→INT', 'integer', 0, 'mysql', 'INT');
  mt('int32→INT', 'int32', 0, 'mysql', 'INT');
  mt('serial→INT', 'serial', 0, 'mysql', 'INT');
  mt('bigint→BIGINT(mysql)', 'bigint', 0, 'mysql', 'BIGINT');
  mt('bigint→BIGINT(pg)', 'bigint', 0, 'postgresql', 'BIGINT');
  mt('bigint→NUMBER(19)(oracle)', 'bigint', 0, 'oracle', 'NUMBER(19)');
  mt('int64→BIGINT', 'int64', 0, 'mysql', 'BIGINT');
  mt('long→BIGINT', 'long', 0, 'mysql', 'BIGINT');
  mt('bigserial→BIGINT', 'bigserial', 0, 'mysql', 'BIGINT');
  mt('smallint→SMALLINT(mysql)', 'smallint', 0, 'mysql', 'SMALLINT');
  mt('smallint→NUMBER(5)(oracle)', 'smallint', 0, 'oracle', 'NUMBER(5)');
  mt('short→SMALLINT', 'short', 0, 'mysql', 'SMALLINT');
  mt('int16→SMALLINT', 'int16', 0, 'mysql', 'SMALLINT');
  mt('smallserial→SMALLINT', 'smallserial', 0, 'mysql', 'SMALLINT');
  mt('tinyint→TINYINT(mysql)', 'tinyint', 0, 'mysql', 'TINYINT');
  mt('tinyint→SMALLINT(pg)', 'tinyint', 0, 'postgresql', 'SMALLINT');
  mt('tinyint→NUMBER(3)(oracle)', 'tinyint', 0, 'oracle', 'NUMBER(3)');
  mt('byte→TINYINT', 'byte', 0, 'mysql', 'TINYINT');
  mt('int8→TINYINT', 'int8', 0, 'mysql', 'TINYINT');

  group('mapType-浮点与定点');
  mt('float→DOUBLE(mysql)', 'float', 0, 'mysql', 'DOUBLE');
  mt('float→DOUBLE PRECISION(pg)', 'float', 0, 'postgresql', 'DOUBLE PRECISION');
  mt('float→NUMBER(oracle)', 'float', 0, 'oracle', 'NUMBER');
  mt('double→DOUBLE', 'doubleprecision', 0, 'mysql', 'DOUBLE');
  mt('real→DOUBLE', 'real', 0, 'mysql', 'DOUBLE');
  mt('decimal(10)→DECIMAL(10,2)', 'decimal', 10, 'mysql', 'DECIMAL(10,2)');
  mt('decimal 默认精度10', 'decimal', 0, 'mysql', 'DECIMAL(10,2)');
  mt('decimal scale=3', 'decimal', 12, 'mysql', 'DECIMAL(12,3)', { scale: 3 });
  mt('scale>precision 收敛', 'decimal', 2, 'mysql', 'DECIMAL(2,2)', { scale: 5 });
  mt('numeric→NUMERIC(pg)', 'numeric', 10, 'postgresql', 'NUMERIC');
  mt('number→NUMBER(oracle)', 'number', 10, 'oracle', 'NUMBER');
  mt('dec→DECIMAL(mysql)', 'dec', 8, 'mysql', 'DECIMAL(8,2)');
  mt('money→DECIMAL(mysql)', 'money', 8, 'mysql', 'DECIMAL(8,2)');

  group('mapType-字符串与长度边界');
  mt('varchar 默认255', 'varchar', 0, 'mysql', 'VARCHAR(255)');
  mt('varchar 64(mysql)', 'varchar', 64, 'mysql', 'VARCHAR(64)');
  mt('varchar 64(pg)', 'varchar', 64, 'postgresql', 'VARCHAR(64)');
  mt('varchar 100(oracle)', 'varchar', 100, 'oracle', 'VARCHAR2(100)');
  mt('varchar2 100(oracle)', 'varchar2', 100, 'oracle', 'VARCHAR2(100)');
  mt('string→VARCHAR', 'string', 20, 'mysql', 'VARCHAR(20)');
  mt('char→VARCHAR', 'char', 20, 'mysql', 'VARCHAR(20)');
  mt('nvarchar→VARCHAR', 'nvarchar', 20, 'mysql', 'VARCHAR(20)');
  let rep = mt('varchar 5001→CLOB(oracle)', 'varchar', 5001, 'oracle', 'CLOB');
  ok('Oracle 超长 notice', rep.some((n) => n.indexOf('超过 Oracle VARCHAR2 上限') >= 0), JSON.stringify(rep));
  mt('varchar 4000(oracle)仍VARCHAR2', 'varchar', 4000, 'oracle', 'VARCHAR2(4000)');
  rep = mt('varchar 70000→LONGTEXT(mysql)', 'varchar', 70000, 'mysql', 'LONGTEXT');
  ok('MySQL 过大 notice', rep.some((n) => n.indexOf('过大') >= 0), JSON.stringify(rep));
  rep = mt('varchar 70000→TEXT(pg)', 'varchar', 70000, 'postgresql', 'TEXT');
  ok('PG 过大 notice', rep.some((n) => n.indexOf('过大') >= 0), JSON.stringify(rep));

  group('mapType-大文本');
  mt('text→TEXT(mysql)', 'text', 0, 'mysql', 'TEXT');
  mt('text→TEXT(pg)', 'text', 0, 'postgresql', 'TEXT');
  mt('text→CLOB(oracle)', 'text', 0, 'oracle', 'CLOB');
  mt('clob→CLOB(oracle)', 'clob', 0, 'oracle', 'CLOB');
  mt('longtext→LONGTEXT(mysql)', 'longtext', 0, 'mysql', 'LONGTEXT');
  mt('mediumtext→TEXT(mysql)', 'mediumtext', 0, 'mysql', 'TEXT');

  group('mapType-布尔');
  mt('bool→TINYINT(1)(mysql)', 'bool', 0, 'mysql', 'TINYINT(1)');
  mt('bool→BOOLEAN(pg)', 'bool', 0, 'postgresql', 'BOOLEAN');
  rep = mt('bool→NUMBER(1)(oracle)', 'bool', 0, 'oracle', 'NUMBER(1)');
  ok('Oracle BOOLEAN notice', rep.some((n) => n.indexOf('Oracle SQL 无 BOOLEAN') >= 0), JSON.stringify(rep));
  mt('boolean→BOOLEAN(pg)', 'boolean', 0, 'postgresql', 'BOOLEAN');
  mt('bit→TINYINT(1)(mysql)', 'bit', 0, 'mysql', 'TINYINT(1)');

  group('mapType-日期时间');
  mt('date→TIMESTAMP(mysql)', 'date', 0, 'mysql', 'TIMESTAMP');
  mt('date→TIMESTAMP(oracle)', 'date', 0, 'oracle', 'TIMESTAMP');
  mt('datetime→TIMESTAMP(mysql)', 'datetime', 0, 'mysql', 'TIMESTAMP');
  mt('datetime→TIMESTAMP(pg)', 'datetime', 0, 'postgresql', 'TIMESTAMP');
  mt('datetime→TIMESTAMP(oracle)', 'datetime', 0, 'oracle', 'TIMESTAMP');
  mt('timestamp→TIMESTAMP(mysql)', 'timestamp', 0, 'mysql', 'TIMESTAMP');
  mt('timestamptz→TIMESTAMP(pg)', 'timestamptz', 0, 'postgresql', 'TIMESTAMP');
  mt('time→TIMESTAMP(mysql)', 'time', 0, 'mysql', 'TIMESTAMP');
  mt('time→TIMESTAMP(pg)', 'time', 0, 'postgresql', 'TIMESTAMP');
  mt('time→TIMESTAMP(oracle)', 'time', 0, 'oracle', 'TIMESTAMP');
  mt('datetime2→TIMESTAMP(mysql)', 'datetime2', 0, 'mysql', 'TIMESTAMP');
  mt('smalldatetime→TIMESTAMP(mysql)', 'smalldatetime', 0, 'mysql', 'TIMESTAMP');
  mt('timestamp with time zone→TIMESTAMP(pg)', 'timestamp with time zone', 0, 'postgresql', 'TIMESTAMP');
  mt('time with time zone→TIMESTAMP(oracle)', 'time with time zone', 0, 'oracle', 'TIMESTAMP');

  group('mapType-JSON与对象');
  mt('json→JSON(mysql)', 'json', 0, 'mysql', 'JSON');
  mt('json→JSONB(pg)', 'json', 0, 'postgresql', 'JSONB');
  rep = mt('json→CLOB(oracle)', 'json', 0, 'oracle', 'CLOB');
  ok('Oracle JSON notice', rep.some((n) => n.indexOf('无原生 JSON') >= 0), JSON.stringify(rep));
  mt('jsonb→JSONB(pg)', 'jsonb', 0, 'postgresql', 'JSONB');
  mt('array→JSON(mysql)', 'array', 0, 'mysql', 'JSON');
  mt('object→JSON(mysql)', 'object', 0, 'mysql', 'JSON');
  mt('map→JSON(mysql)', 'map', 0, 'mysql', 'JSON');
  mt('list→JSON(mysql)', 'list', 0, 'mysql', 'JSON');

  group('mapType-二进制与UUID');
  mt('blob→BLOB(mysql)', 'blob', 0, 'mysql', 'BLOB');
  mt('blob→BYTEA(pg)', 'blob', 0, 'postgresql', 'BYTEA');
  mt('blob→BLOB(oracle)', 'blob', 0, 'oracle', 'BLOB');
  mt('bytea→BYTEA(pg)', 'bytea', 0, 'postgresql', 'BYTEA');
  mt('binary→BLOB(mysql)', 'binary', 0, 'mysql', 'BLOB');
  mt('varbinary→BLOB(mysql)', 'varbinary', 0, 'mysql', 'BLOB');
  mt('longblob→LONGBLOB(mysql)', 'longblob', 0, 'mysql', 'LONGBLOB');
  mt('uuid→CHAR(36)(mysql)', 'uuid', 0, 'mysql', 'CHAR(36)');
  mt('uuid→UUID(pg)', 'uuid', 0, 'postgresql', 'UUID');
  mt('uuid→VARCHAR2(36)(oracle)', 'uuid', 0, 'oracle', 'VARCHAR2(36)');

  group('mapType-未知类型透传');
  rep = mt('未知 foobar 透传', 'foobar', 0, 'mysql', 'FOOBAR');
  ok('未知类型 notice', rep.some((n) => n.indexOf('未知类型 foobar') >= 0), JSON.stringify(rep));
  rep = mt('未知 weird-type 安全过滤', 'weird-type', 0, 'mysql', 'WEIRDTYPE');
  ok('未知类型过滤 notice', rep.some((n) => n.indexOf('未知类型') >= 0), JSON.stringify(rep));
  mt('未知类型带括号', 'mytype(8)', 0, 'mysql', 'MYTYPE(8)');

  /* ============================ toDDL ============================ */
  const COLS = [
    { name: 'user_name', type: 'varchar', length: 64, notNull: true, comment: '登录名' },
    { name: 'age', type: 'int', length: '', notNull: false, comment: '年龄' }
  ];
  group('toDDL-MySQL');
  let d = M.toDDL(COLS, { dialect: 'mysql', tableName: 't_user', nameStyle: 'keep', withComments: true });
  eq('MySQL 无 error', d.error, '');
  has('MySQL 头注释', d.output, '-- MySQL 建表语句');
  has('MySQL CREATE TABLE 反引号', d.output, 'CREATE TABLE `t_user` (');
  has('MySQL VARCHAR 列+NOT NULL+行尾注释', d.output, '`user_name` VARCHAR(64) NOT NULL  -- 登录名');
  has('MySQL INT 列', d.output, '`age` INT');
  has('MySQL 结束括号', d.output, ');');

  group('toDDL-PostgreSQL');
  d = M.toDDL(COLS, { dialect: 'postgresql', tableName: 't_user', nameStyle: 'keep', withComments: true });
  eq('PG 无 error', d.error, '');
  has('PG 头注释', d.output, '-- PostgreSQL 建表语句');
  has('PG 双引号 CREATE', d.output, 'CREATE TABLE "t_user" (');
  has('PG 双引号列', d.output, '"user_name" VARCHAR(64) NOT NULL');
  notHas('PG 无行尾 -- 注释', d.output, '-- 登录名');
  has('PG COMMENT ON COLUMN 登录名', d.output, 'COMMENT ON COLUMN "t_user"."user_name" IS ' + "'登录名'" + ';');
  has('PG COMMENT ON COLUMN 年龄', d.output, 'COMMENT ON COLUMN "t_user"."age" IS ' + "'年龄'" + ';');

  group('toDDL-Oracle');
  d = M.toDDL(COLS, { dialect: 'oracle', tableName: 't_user', nameStyle: 'keep', withComments: true });
  eq('Oracle 无 error', d.error, '');
  has('Oracle 头注释', d.output, '-- Oracle 建表语句');
  has('Oracle 双引号 CREATE', d.output, 'CREATE TABLE "t_user" (');
  has('Oracle VARCHAR2 列', d.output, '"user_name" VARCHAR2(64) NOT NULL');
  has('Oracle COMMENT ON COLUMN', d.output, 'COMMENT ON COLUMN "t_user"."user_name" IS ' + "'登录名'" + ';');

  group('toDDL-withComments开关');
  d = M.toDDL(COLS, { dialect: 'mysql', tableName: 't', nameStyle: 'keep', withComments: false });
  notHas('withComments=false 无注释(mysql)', d.output, '登录名');
  d = M.toDDL(COLS, { dialect: 'postgresql', tableName: 't', nameStyle: 'keep', withComments: false });
  notHas('withComments=false 无注释(pg)', d.output, 'COMMENT ON COLUMN');
  d = M.toDDL(COLS, { dialect: 'mysql', tableName: 't', nameStyle: 'keep' });
  has('withComments 默认 true', d.output, '-- 登录名');

  group('toDDL-注释转义');
  d = M.toDDL([{ name: 'c', type: 'varchar', length: 10, notNull: false, comment: "it's ok" }],
    { dialect: 'postgresql', tableName: 't', nameStyle: 'keep', withComments: true });
  has('PG 单引号转义为两个', d.output, "IS 'it''s ok';");
  const BT = String.fromCharCode(96); // 反引号
  d = M.toDDL([{ name: 'c', type: 'varchar', length: 10, notNull: false, comment: 'a' + BT + 'b' + String.fromCharCode(10) + 'c' }],
    { dialect: 'mysql', tableName: 't', nameStyle: 'keep', withComments: true });
  has('MySQL 反引号转义为单引号', d.output, "a'b");
  notHas('MySQL 注释换行被替换为空格', d.output, String.fromCharCode(10) + 'c');

  group('toDDL-主键跨风格');
  const pkCols = [{ name: 'userName', type: 'varchar', length: 32, notNull: true, comment: '' }];
  d = M.toDDL(pkCols, { dialect: 'mysql', tableName: 't', nameStyle: 'snake', primaryKey: 'user_name' });
  has('pk=user_name 命中 userName→user_name', d.output, '`user_name` VARCHAR(32) PRIMARY KEY');
  notHas('主键行不再追加 NOT NULL', d.output, 'PRIMARY KEY NOT NULL');
  d = M.toDDL(pkCols, { dialect: 'mysql', tableName: 't', nameStyle: 'snake', primaryKey: 'userName' });
  has('pk=userName 命中 userName→user_name', d.output, '`user_name` VARCHAR(32) PRIMARY KEY');
  const pkDup = [{ name: 'userName', type: 'int', length: '', notNull: false, comment: '' },
    { name: 'user_name', type: 'int', length: '', notNull: false, comment: '' }];
  d = M.toDDL(pkDup, { dialect: 'mysql', tableName: 't', nameStyle: 'keep', primaryKey: 'userName' });
  eq('重复主键只标一次', countOf(d.output, 'PRIMARY KEY'), 1);
  const pkNone = M.toDDL(COLS, { dialect: 'mysql', tableName: 't', nameStyle: 'keep', primaryKey: 'not_exist' });
  ok('主键未找到 notice', pkNone.notices.some((n) => n.indexOf('未在表格中找到') >= 0), JSON.stringify(pkNone.notices));
  notHas('主键未找到无 PRIMARY KEY', pkNone.output, 'PRIMARY KEY');

  group('toDDL-重复列名');
  const dupCols = [{ name: 'a', type: 'int', length: '', notNull: false, comment: '' },
    { name: 'a', type: 'int', length: '', notNull: false, comment: '' }];
  d = M.toDDL(dupCols, { dialect: 'mysql', tableName: 't', nameStyle: 'keep' });
  has('重复列名改为 a_1', d.output, '`a_1` INT');
  ok('重复列名 notice', d.notices.some((n) => n.indexOf('已自动改名为 a_1') >= 0), JSON.stringify(d.notices));

  group('toDDL-非法表名与空列');
  d = M.toDDL(COLS, { dialect: 'mysql', tableName: 'ba;d`name', nameStyle: 'keep' });
  has('非法表名被清理', d.output, 'CREATE TABLE `badname` (');
  ok('非法表名 notice', d.notices.some((n) => n.indexOf('非法字符') >= 0), JSON.stringify(d.notices));
  d = M.toDDL(COLS, { dialect: 'mysql', tableName: ';;;', nameStyle: 'keep' });
  ok('表名清理后为空 error', !!d.error && d.error.indexOf('表名非法') >= 0, d.error);
  d = M.toDDL([], { dialect: 'mysql', tableName: 't', nameStyle: 'keep' });
  ok('空列 error', !!d.error && d.error.indexOf('没有可生成 DDL 的列') >= 0, d.error);

  group('toDDL-未知方言降级');
  const repDialect = [];
  d = M.toDDL(COLS, { dialect: 'sqlite', tableName: 't', nameStyle: 'keep', report: repDialect });
  has('未知方言按 MySQL 头注释', d.output, '-- MySQL 建表语句');
  ok('未知方言 notice', repDialect.some((n) => n.indexOf('未知方言') >= 0), JSON.stringify(repDialect));

  group('toDDL-五种命名风格');
  const styleCols = [{ name: 'userName', type: 'varchar', length: 20, notNull: false, comment: '' }];
  const styleExpect = {
    camel: '`userName`', snake: '`user_name`', upper_snake: '`USER_NAME`',
    pascal: '`UserName`', keep: '`userName`'
  };
  for (const st of Object.keys(styleExpect)) {
    const dd = M.toDDL(styleCols, { dialect: 'mysql', tableName: 't', nameStyle: st });
    has('命名风格 ' + st + ' → ' + styleExpect[st], dd.output, styleExpect[st]);
  }

  /* ============================ run() 工具执行 ============================ */
  group('run-正常与回退');
  const tool = REG.get('convert-md-ddl');
  ok('convert-md-ddl 工具存在', !!tool);
  if (tool) {
    const params = { mdTable: std, dialect: 'oracle', tableName: 't_user', primaryKey: '', withComments: true, nameStyle: 'keep' };
    const res = tool.run('', params, { parseInput: () => ({ ok: false }) });
    eq('run view=code', res.view, 'code');
    eq('run outLang=sql', res.outLang, 'sql');
    has('run Oracle 输出', res.output, '-- Oracle 建表语句');
    eq('run 无 error', res.error, '');
    const resFallback = tool.run(std, { mdTable: '', dialect: 'mysql', tableName: 't', primaryKey: '', withComments: true, nameStyle: 'keep' }, { parseInput: () => ({ ok: false }) });
    has('run mdTable 空回退 input', resFallback.output, '-- MySQL 建表语句');
    const resErr = tool.run('', { mdTable: '| A | B |\n| x | y |', dialect: 'mysql', tableName: 't', primaryKey: '', withComments: true, nameStyle: 'keep' }, { parseInput: () => ({ ok: false }) });
    ok('run 无法识别表头返回中文 error', !!resErr.error && resErr.error.indexOf('无法识别表头') >= 0, resErr.error);
    const resEmpty = tool.run('', { mdTable: '', dialect: 'mysql', tableName: 't', primaryKey: '', withComments: true, nameStyle: 'keep' }, { parseInput: () => ({ ok: false }) });
    ok('run 空输入返回中文 error', !!resEmpty.error && resEmpty.error.indexOf('输入为空') >= 0, resEmpty.error);
  }

  /* ============================ 注册表与静态一致性 ============================ */
  group('注册表');
  eq('工具总数 71', REG.tools.length, 71);
  const catCounts = {};
  REG.tools.forEach((t) => { catCounts[t.cat] = (catCounts[t.cat] || 0) + 1; });
  eq('convert 分类 22', catCounts.convert, 22);
  if (tool) {
    eq('tool id', tool.id, 'convert-md-ddl');
    eq('tool cat', tool.cat, 'convert');
    eq('tool name', tool.name, 'Markdown 表格 → 建表 DDL');
    eq('tool icon', tool.icon, 'db');
    eq('tool outLang', tool.outLang, 'sql');
    eq('tool view', tool.view, 'code');
    const pids = (tool.params || []).map((p) => p.id);
    eq('参数 id 顺序齐全', pids, ['mdTable', 'dialect', 'tableName', 'primaryKey', 'withComments', 'nameStyle']);
    const ptypes = (tool.params || []).map((p) => p.type);
    eq('参数类型齐全', ptypes, ['textarea', 'select', 'text', 'text', 'checkbox', 'select']);
    const dialectP = tool.params.find((p) => p.id === 'dialect');
    eq('dialect 三个选项', dialectP.options.map((o) => o.value), ['mysql', 'postgresql', 'oracle']);
    const wcP = tool.params.find((p) => p.id === 'withComments');
    eq('withComments 默认 true', wcP.default, true);
    const nsP = tool.params.find((p) => p.id === 'nameStyle');
    eq('nameStyle 五选项', nsP.options.map((o) => o.value), ['camel', 'snake', 'upper_snake', 'pascal', 'keep']);
  }

  group('静态资源');
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const mdddlPos = scripts.findIndex((s) => /core\/mdddl\.js$/.test(s));
  const tbPos = scripts.findIndex((s) => /core\/treebuild\.js$/.test(s));
  const uiPos = scripts.findIndex((s) => /js\/ui\//.test(s));
  ok('index.html 含 mdddl.js', mdddlPos >= 0, 'scripts=' + scripts.join(','));
  ok('mdddl.js 在 core 段（treebuild.js 之后）', mdddlPos > tbPos && tbPos >= 0, 'tbPos=' + tbPos + ' mdddlPos=' + mdddlPos);
  ok('mdddl.js 早于 UI 段', mdddlPos >= 0 && uiPos > mdddlPos, 'mdddlPos=' + mdddlPos + ' uiPos=' + uiPos);
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  ok('README 工具数 71', /内置 \*\*71 个\*\*/.test(readme) && /功能总览（71 个工具）/.test(readme), 'readme head=' + readme.slice(0, 200));
}

/* ============================ 汇总输出 ============================ */
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
const summary = {
  suite: 'mdddl-check',
  total: results.length,
  passed,
  failed,
  failures: results.filter((r) => !r.pass),
  results
};
fs.writeFileSync(path.join(__dirname, 'mdddl-results.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log('================ Markdown DDL · Node 专项 ================');
console.log('=== 通过 ' + passed + ' / 失败 ' + failed + ' ===');
if (failed) {
  console.log('\n--- 失败明细 ---');
  summary.failures.forEach((f) => console.log('[' + f.group + '] ' + f.name + '\n  ' + f.detail));
}
process.exitCode = failed ? 1 : 0;
