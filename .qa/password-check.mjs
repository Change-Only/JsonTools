/* eslint-disable */
/**
 * password-check.mjs —— 密码生成器 Node 层专项（独立证伪式验证）
 * 运行：node .qa/password-check.mjs
 * 只读产品代码；结果写入 .qa/password-results.json。
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

/* ============================ 加载 core ============================ */
globalThis.window = globalThis;
function loadScript(p) { vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: p }); }
const CORE = ['vendor/libs.js', 'js/core/json.js', 'js/core/convert.js', 'js/core/codegen.js', 'js/core/codec.js', 'js/core/analyze.js', 'js/core/password.js'];
for (const f of CORE) loadScript(path.join(WEB, f));
loadScript(path.join(WEB, 'js/tools-registry.js'));

const P = globalThis.JTCore.password;
const reg = globalThis.JT.registry;
if (!P) { console.error('FATAL: JTCore.password 未加载'); process.exit(2); }

/* ============================ A. API 与常量 ============================ */
group('A-API与常量');
const API = ['TEMPLATES', 'AMBIGUOUS', 'createRandomSource', 'createSampler', 'resolvePattern', 'generate', 'sample', 'validate'];
API.forEach((k) => ok('导出 API 存在: ' + k, P[k] !== undefined));
eq('AMBIGUOUS 常量值', P.AMBIGUOUS, '0Oo1lI|');
eq('内置模板数 = 5', P.TEMPLATES.length, 5);
eq('模板 id 顺序', P.TEMPLATES.map((t) => t.value).join(','), 'strong,alnum,pin,hex,unambiguous');
P.TEMPLATES.forEach((t) => {
  ok('模板 ' + t.value + ' 结构完整', !!(t.value && t.label && t.pattern && t.desc));
  let valid = false; try { new RegExp(t.pattern); valid = true; } catch (e) {}
  ok('模板 ' + t.value + ' 正则合法', valid);
});

/* ============================ B. 内置模板批量生成 ============================ */
const EXPECT = {
  strong: { re: /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])[A-Za-z0-9!@#$%^&*]{12,16}$/, min: 12, max: 16 },
  alnum: { re: /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])[A-Za-z0-9]{10,20}$/, min: 10, max: 20 },
  pin: { re: /^[0-9]{6}$/, min: 6, max: 6 },
  hex: { re: /^[0-9a-f]{32}$/, min: 32, max: 32 },
  unambiguous: { re: /^[A-HJ-NP-Za-hjkmnp-z2-9]{12}$/, min: 12, max: 12 }
};
for (const t of P.TEMPLATES) {
  group('B-模板-' + t.value);
  const e = EXPECT[t.value];
  const anchored = new RegExp('^(?:' + t.pattern + ')$');
  const r = P.generate(t.pattern, { count: 5 });
  ok('生成成功 ok=true', r.ok === true, JSON.stringify(r.error));
  eq('values 恰 5 条', r.values.length, 5);
  eq('output 恰 5 行', r.output.split('\n').length, 5);
  ok('每条严格匹配模板正则（全串）', r.values.every((v) => anchored.test(v)), r.values.join(' | '));
  ok('每条匹配独立期望正则', r.values.every((v) => e.re.test(v)), r.values.join(' | '));
  ok('长度全部在 ' + e.min + '-' + e.max, r.values.every((v) => v.length >= e.min && v.length <= e.max), r.values.map((v) => v.length).join(','));
  eq('5 条无重复', new Set(r.values).size, 5, r.values.join(' | '));
  eq('error 为 null', r.error, null);
  eq('output 与 values.join 一致', r.output, r.values.join('\n'));
  ok('notices 为数组', Array.isArray(r.notices));
  ok('无换行字符混入单条', r.values.every((v) => !/[\r\n]/.test(v)));
}
group('B-模板-字符集专项');
const hexVals = P.generate('[0-9a-f]{32}', { count: 5 }).values;
ok('hex 仅含 0-9a-f', hexVals.every((v) => /^[0-9a-f]+$/.test(v)));
const pinVals = P.generate('[0-9]{6}', { count: 5 }).values;
ok('pin 仅含数字', pinVals.every((v) => /^[0-9]+$/.test(v)));
const unambVals = P.generate('[A-HJ-NP-Za-hjkmnp-z2-9]{12}', { count: 5 }).values;
ok('unambiguous 不含 0/O/o/1/l/I', unambVals.every((v) => !/[0Oo1lI]/.test(v)), unambVals.join(' | '));
const strongVals = P.generate('(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])[A-Za-z0-9!@#$%^&*]{12,16}', { count: 5 }).values;
ok('strong 四类字符均出现', strongVals.every((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v) && /[!@#$%^&*]/.test(v)));

/* ============================ C. count 边界与钳制 ============================ */
group('C-count边界');
const PIN = '[0-9]{6}';
eq('count=1 生成 1 条', P.generate(PIN, { count: 1 }).values.length, 1);
eq('count=50 生成 50 条', P.generate(PIN, { count: 50 }).values.length, 50);
eq('count=0 钳制为 1', P.generate(PIN, { count: 0 }).values.length, 1);
eq('count=-3 钳制为 1', P.generate(PIN, { count: -3 }).values.length, 1);
eq('count=100 钳制为 50', P.generate(PIN, { count: 100 }).values.length, 50);
eq('count=abc 非法回落默认 5', P.generate(PIN, { count: 'abc' }).values.length, 5);
eq('count 未提供默认 5', P.generate(PIN, {}).values.length, 5);
eq('count=3.7 四舍五入为 4', P.generate(PIN, { count: 3.7 }).values.length, 4);
eq('count=null 按数字 0 钳制为 1', P.generate(PIN, { count: null }).values.length, 1);
eq('count=Infinity 回落默认 5', P.generate(PIN, { count: Infinity }).values.length, 5);

/* ============================ D. 排除易混淆字符 ============================ */
group('D-排除易混淆');
const exOn = P.generate('[0-9a-zA-Z]{24}', { count: 20, excludeAmbiguous: true });
ok('排除开启结果不含 0Oo1lI|', exOn.values.every((v) => !/[0Oo1lI|]/.test(v)), exOn.values.filter((v) => /[0Oo1lI|]/.test(v)).join(' | '));
eq('排除开启仍生成 20 条', exOn.values.length, 20);
const exOff = P.generate('[0-9a-zA-Z]{24}', { count: 20, excludeAmbiguous: false });
ok('排除关闭正常生成', exOff.ok === true && exOff.values.length === 20);
const onlyAmbOn = P.generate('[01]{8}', { count: 3, excludeAmbiguous: true });
ok('字符集全易混淆+排除开启 → error 而非死循环', onlyAmbOn.ok === false && !!onlyAmbOn.error, JSON.stringify(onlyAmbOn));
const onlyAmbOff = P.generate('[01]{8}', { count: 3, excludeAmbiguous: false });
ok('字符集全易混淆+排除关闭 → 正常生成', onlyAmbOff.ok === true && onlyAmbOff.values.length === 3);
ok('onlyAmbOff 每条匹配 [01]{8}', onlyAmbOff.values.every((v) => /^[01]{8}$/.test(v)));

/* ============================ E. 自定义正则 ============================ */
group('E-自定义正则');
const c1 = P.generate('[A-HJ-NP-Z2-9]{10}', { count: 5 });
ok('自定义 [A-HJ-NP-Z2-9]{10} 成功', c1.ok === true);
ok('自定义 A-HJ... 每条严格匹配', c1.values.every((v) => /^[A-HJ-NP-Z2-9]{10}$/.test(v)), c1.values.join(' | '));
const c2 = P.generate('\\d{4}-\\d{4}', { count: 5 });
ok('自定义 \\d{4}-\\d{4} 成功', c2.ok === true);
ok('自定义 \\d 转义与字面横线正确', c2.values.every((v) => /^\d{4}-\d{4}$/.test(v)), c2.values.join(' | '));
const c3 = P.generate('(?=.*[a-z])(?=.*[A-Z])[A-Za-z]{8}', { count: 5 });
ok('自定义含零宽断言成功', c3.ok === true);
ok('自定义断言约束成立', c3.values.every((v) => /^(?=.*[a-z])(?=.*[A-Z])[A-Za-z]{8}$/.test(v)));
const c4 = P.generate('AB[0-9]{2}CD', { count: 5 });
ok('自定义字面量+量词正确', c4.values.every((v) => /^AB[0-9]{2}CD$/.test(v)));
const c5 = P.generate('[a-c]{2}|[0-9]{3}', { count: 20 });
ok('自定义选择分支均可生成', c5.values.some((v) => /^[a-c]{2}$/.test(v)) && c5.values.some((v) => /^[0-9]{3}$/.test(v)), c5.values.join(' | '));

/* ============================ F. 矛盾正则有限失败 ============================ */
group('F-矛盾正则');
function timed(fn) { const t = Date.now(); const r = fn(); return { r, ms: Date.now() - t }; }
const bad1 = timed(() => P.generate('(?!)', { count: 3 }));
ok('(?!)：有限时间返回 error', bad1.r.ok === false && !!bad1.r.error, JSON.stringify(bad1.r));
ok('(?!)：耗时 < 3000ms（无死循环）', bad1.ms < 3000, bad1.ms + 'ms');
const bad2 = timed(() => P.generate('(?=.*[A-Z])[a-z]{3}', { count: 3 }));
ok('全小写+强制大写断言：返回 error', bad2.r.ok === false && !!bad2.r.error, JSON.stringify(bad2.r));
ok('全小写+强制大写断言：耗时 < 3000ms', bad2.ms < 3000, bad2.ms + 'ms');
const bad3 = timed(() => P.generate('[^\\s\\S]', { count: 3 }));
ok('取反空字符类：返回 error', bad3.r.ok === false && !!bad3.r.error, JSON.stringify(bad3.r));
ok('取反空字符类：耗时 < 3000ms', bad3.ms < 3000, bad3.ms + 'ms');
ok('矛盾正则 error 文案含检查提示', /正则|约束|重试|字符/.test(bad1.r.error || ''), bad1.r.error);

/* ============================ G. resolvePattern 优先级 ============================ */
group('G-resolvePattern');
let rp = P.resolvePattern('pin', '');
eq('模板 pin 的 pattern', rp.pattern, '[0-9]{6}');
eq('模板来源 source=template', rp.source, 'template');
eq('模板 id=pin', rp.template, 'pin');
ok('模板 label 非空', !!rp.label);
rp = P.resolvePattern('pin', '   \\d{4}   ');
eq('自定义优先于模板', rp.pattern, '\\d{4}');
eq('自定义来源 source=custom', rp.source, 'custom');
eq('自定义时 template 为空', rp.template, '');
rp = P.resolvePattern('bogus-id', '   ');
eq('无效模板回落首个模板 strong', rp.template, 'strong');
eq('回落模板 pattern 为 strong 正则', rp.pattern, P.TEMPLATES[0].pattern);
rp = P.resolvePattern('', 'abc');
eq('空模板 id + 自定义 → custom', rp.source, 'custom');
eq('自定义去首尾空白', rp.pattern, 'abc');

/* ============================ H. validate 非法正则 ============================ */
group('H-validate');
ok('validate 合法正则 ok=true', P.validate('[a-z]{3}').ok === true);
ok('validate 合法复杂正则 ok=true', P.validate('(?=.*[A-Z])[A-Za-z0-9]{8}').ok === true);
ok('validate 空正则报错', P.validate('').ok === false);
ok('validate 缺右括号报错', P.validate('[a-z').ok === false);
ok('validate 量词上下界颠倒报错', P.validate('a{5,2}').ok === false);
ok('validate 反向引用报错', P.validate('(a)\\1').ok === false);
ok('validate 自相矛盾但语法合法 → ok=true', P.validate('(?=.*[A-Z])[a-z]{3}').ok === true);
ok('validate 报错含 error 文案', !!P.validate('[').error);

/* ============================ I. 随机源/采样器/便捷 API ============================ */
group('I-随机源与采样器');
const rs = P.createRandomSource();
ok('createRandomSource.secure 为布尔', typeof rs.secure === 'boolean');
ok('createRandomSource.notices 为数组', Array.isArray(rs.notices));
ok('createRandomSource.randomInt 为函数', typeof rs.randomInt === 'function');
let inRange = true;
for (let i = 0; i < 100; i++) { const v = rs.randomInt(7); if (!Number.isInteger(v) || v < 0 || v >= 7) inRange = false; }
ok('randomInt(7) 100 次均落在 [0,7)', inRange);
let threw = false; try { rs.randomInt(0); } catch (e) { threw = true; }
ok('randomInt(0) 抛错', threw);
const sp = P.createSampler('[0-9]{4}');
ok('createSampler.sample 为函数', typeof sp.sample === 'function');
const one = sp.sample();
ok('sampler.sample 返回合法结果', !!one && /^\d{4}$/.test(one.value), JSON.stringify(one));
ok('sampler.sample.attempts >= 1', one && one.attempts >= 1);
const many = [sp.sample().value, sp.sample().value, sp.sample().value];
ok('同一 sampler 可重复采样', many.every((v) => /^\d{4}$/.test(v)), many.join(','));
const sm = P.sample('[0-9]{4}');
ok('便捷 sample 返回合法值', /^\d{4}$/.test(sm.value));
ok('便捷 sample.secure 为布尔', typeof sm.secure === 'boolean');
ok('便捷 sample.notices 为数组', Array.isArray(sm.notices));
let threw2 = false; try { P.sample('(?!)'); } catch (e) { threw2 = true; }
ok('便捷 sample 矛盾正则抛异常', threw2);

/* ============================ J. 随机性统计 ============================ */
group('J-随机性统计');
eq('hex 20 条去重率 = 20/20', new Set(P.generate('[0-9a-f]{32}', { count: 20 }).values).size, 20);
const pin20 = P.generate('[0-9]{6}', { count: 20 }).values;
ok('PIN 20 条去重 >= 18', new Set(pin20).size >= 18, 'unique=' + new Set(pin20).size);
const big = P.generate('[0-9a-f]{32}', { count: 200 }).values.join('');
ok('大样本同时出现 0-9', /[0-9]/.test(big));
ok('大样本同时出现 a-f', /[a-f]/.test(big));
const charFreq = {}; for (const ch of big) charFreq[ch] = (charFreq[ch] || 0) + 1;
ok('大样本覆盖全部 16 个 hex 字符', Object.keys(charFreq).length === 16, 'distinct=' + Object.keys(charFreq).length);

/* ============================ K. 注册表装配（静态+运行时） ============================ */
group('K-注册表装配');
eq('工具总数 = 69', reg.tools.length, 69);
const tw = reg.get('utility-password');
ok('utility-password 可查', !!tw);
eq('utility-password 分类 = utility', tw.cat, 'utility');
eq('utility-password 名称', tw.name, '密码生成器');
const pids = tw.params.map((p) => p.id).join(',');
eq('参数 id 顺序', pids, 'template,customPattern,count,excludeAmbiguous');
const pm = {}; tw.params.forEach((p) => { pm[p.id] = p; });
eq('template 控件类型 = select', pm.template.type, 'select');
eq('template 默认值 = strong', pm.template.default, 'strong');
eq('template 选项数 = 5', pm.template.options.length, 5);
eq('customPattern 控件类型 = textarea', pm.customPattern.type, 'textarea');
eq('count 控件类型 = number', pm.count.type, 'number');
eq('count 默认值 = 5', pm.count.default, 5);
eq('count 最小值 = 1', pm.count.min, 1);
eq('count 最大值 = 50', pm.count.max, 50);
eq('excludeAmbiguous 控件类型 = checkbox', pm.excludeAmbiguous.type, 'checkbox');
const ddTool = reg.get('convert-ddl');
ok('convert-ddl 可查', !!ddTool);
const dialect = ddTool.params.find((p) => p.id === 'dialect');
ok('convert-ddl 方言含 oracle', !!dialect && dialect.options.some((o) => o.value === 'oracle'));
ok('convert-ddl 方言含 mysql/postgresql/sqlite', !!dialect && ['mysql', 'postgresql', 'sqlite'].every((v) => dialect.options.some((o) => o.value === v)));
ok('convert-ddl 含 nameStyle 参数', ddTool.params.some((p) => p.id === 'nameStyle'));
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const pwIdx = html.indexOf('js/core/password.js');
const uiIdx = html.indexOf('js/ui/');
ok('index.html 引用 password.js', pwIdx > 0, 'idx=' + pwIdx);
ok('password.js 位于 UI 段之前', pwIdx > 0 && uiIdx > pwIdx, 'pw=' + pwIdx + ' ui=' + uiIdx);
const coreRefs = html.match(/js\/core\/[a-z]+\.js/g) || [];
ok('password.js 在 core 段列表内', coreRefs.includes('js/core/password.js'), coreRefs.join(','));

/* ============================ L. 注册表 run 端到端 ============================ */
group('L-注册表run端到端');
const ctx = { parseInput: () => ({ ok: true, value: {} }) };
const rr1 = tw.run('', { template: 'pin', customPattern: '', count: 3, excludeAmbiguous: false }, ctx);
ok('run(pin,3) 返回成功', !!rr1 && typeof rr1.output === 'string' && !rr1.error, JSON.stringify(rr1));
eq('run(pin,3) 输出 3 行', rr1.output.split('\n').length, 3);
ok('run(pin,3) 每行 6 位数字', rr1.output.split('\n').every((l) => /^\d{6}$/.test(l)), rr1.output);
ok('run notices 含模板提示', (rr1.notices || []).some((n) => n.indexOf('使用模板') >= 0), JSON.stringify(rr1.notices));
const rr2 = tw.run('', { template: 'strong', customPattern: '\\d{4}', count: 2, excludeAmbiguous: false }, ctx);
ok('run(自定义正则) 成功', !!rr2 && typeof rr2.output === 'string' && !rr2.error, JSON.stringify(rr2));
ok('run(自定义正则) 优先于模板', rr2.output.split('\n').every((l) => /^\d{4}$/.test(l)), rr2.output);
ok('run notices 含自定义正则提示', (rr2.notices || []).some((n) => n.indexOf('自定义正则') >= 0));
const rr3 = tw.run('', { template: 'strong', customPattern: '(?!)', count: 2, excludeAmbiguous: false }, ctx);
ok('run(矛盾正则) 返回 error', !!rr3 && !!rr3.error, JSON.stringify(rr3));

/* ============================ 汇总 ============================ */
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
const out = { summary: { total: results.length, passed, failed }, results };
fs.writeFileSync(path.join(__dirname, 'password-results.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('\n================ 密码生成器 Node 专项 ================');
console.log('=== 通过 ' + passed + ' / 失败 ' + failed + ' ===');
if (failed) {
  console.log('--- 失败明细 ---');
  results.filter((r) => !r.pass).forEach((r) => console.log('[' + r.group + '] ' + r.name + '\n    ' + r.detail));
}
