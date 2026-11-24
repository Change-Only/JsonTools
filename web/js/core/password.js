/*!
 * core/password.js —— JSON 工具箱 · 密码 / 令牌生成纯逻辑层（零 DOM 依赖）
 * 职责：按正则模式「随机采样」生成字符串（非单纯校验），内置模板 + 自定义正则，
 *       生成后用 new RegExp(pattern).test(result) 自检，失败则在有限次数内重试。
 *
 * 支持语法：字符类 [a-zA-Z0-9] / 范围 [a-z] / 取反 [^...]、转义 \d \w \s \W \D \S、
 *           量词 {n} {n,m} {n,} + * ?（含惰性后缀 ?）、分组 (...) (?:...)、选择 a|b、
 *           字面量、常见转义 (\n \t \r \f \v \0 \xHH \uHHHH \\ \. 等)、零宽断言 (?!...) (?=...)。
 * 零宽断言（^ $ \b (?=...) (?!...)）在采样阶段跳过，由最终 RegExp 自检保证约束成立；
 * 若正则自相矛盾导致始终无法自检通过，则在有限重试后返回失败结果，绝不死循环。
 */
(function (root) {
  'use strict';

  var NS = (root.JTCore = root.JTCore || {});

  /* ============================ 常量 ============================ */

  var MAX_REPEAT = 512;       // 单个量词的采样上限，防止 {100000000} 拖死页面
  var MAX_LENGTH = 4096;      // 单条结果的长度上限
  var MAX_ATTEMPTS = 200;     // 单条结果的自检重试上限
  var UNBOUNDED_EXTRA = 8;    // * / + / {n,} 的额外随机长度
  var AMBIGUOUS = '0Oo1lI|';  // 易混淆字符（可选项：命中即整条重采样）

  var DIGITS = '0123456789';
  var LOWER = 'abcdefghijklmnopqrstuvwxyz';
  var UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var WORD = LOWER + UPPER + DIGITS + '_';
  var SPACE_CHARS = ' \t\u00a0'; // 空格 / Tab / NBSP，均能被 JS 的 \s 匹配，且不会产生换行

  var PRINTABLE = [];
  for (var ci = 0x20; ci <= 0x7e; ci++) PRINTABLE.push(String.fromCharCode(ci));

  function inSet(ch, set) { return set.indexOf(ch) >= 0; }
  function nonOf(set) {
    var out = [];
    for (var i = 0; i < PRINTABLE.length; i++) if (!inSet(PRINTABLE[i], set)) out.push(PRINTABLE[i]);
    return out;
  }
  var NON_DIGIT = nonOf(DIGITS);
  var NON_WORD = nonOf(WORD);
  var NON_SPACE = nonOf(SPACE_CHARS);

  /** 内置规则模板（select 参数的数据源；每个模板都是一条可自检的正则）。 */
  var TEMPLATES = [
    {
      value: 'strong',
      label: '强密码（大小写+数字+符号，12-16 位）',
      pattern: '(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])[A-Za-z0-9!@#$%^&*]{12,16}',
      desc: '四类字符至少各出现一次'
    },
    {
      value: 'alnum',
      label: '字母数字（大小写+数字，10-20 位）',
      pattern: '(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])[A-Za-z0-9]{10,20}',
      desc: '不含符号，适合有符号限制的账号'
    },
    {
      value: 'pin',
      label: '纯数字 PIN（6 位）',
      pattern: '[0-9]{6}',
      desc: '6 位数字'
    },
    {
      value: 'hex',
      label: 'Hex Token（32 位）',
      pattern: '[0-9a-f]{32}',
      desc: '16 进制令牌'
    },
    {
      value: 'unambiguous',
      label: '无歧义字符（去掉 0/O/o/1/l/I，12 位）',
      pattern: '[A-HJ-NP-Za-hjkmnp-z2-9]{12}',
      desc: '人工抄写友好的字符集'
    }
  ];

  /* ============================ 随机源（无模偏差） ============================ */

  /**
   * 优先使用 crypto.getRandomValues；file:// 或旧浏览器不可用时回退 Math.random。
   * 两者均采用「拒绝采样」消除取模偏差（modulo bias）。
   * @returns {{secure:boolean, notices:string[], randomInt:function(number):number}}
   */
  function createRandomSource() {
    var notices = [];
    var cryptoObj = null;
    try {
      if (root.crypto && typeof root.crypto.getRandomValues === 'function') cryptoObj = root.crypto;
    } catch (e) { cryptoObj = null; }
    if (cryptoObj) {
      // 实际探测一次，排除「存在接口但被安全策略禁用」的假可用状态
      try { cryptoObj.getRandomValues(new Uint32Array(1)); } catch (e) { cryptoObj = null; }
    }
    if (!cryptoObj) {
      notices.push('当前环境无可用 crypto.getRandomValues（file:// 或旧浏览器可能受限），已回退 Math.random，随机安全性降低，请勿用于生产密钥。');
    }
    var secure = !!cryptoObj;

    function randomUint32() {
      if (secure) {
        var buf = new Uint32Array(1);
        cryptoObj.getRandomValues(buf);
        return buf[0];
      }
      return Math.floor(Math.random() * 4294967296);
    }

    /**
     * 返回 [0, maxExclusive) 内的均匀整数。
     * 丢弃落在最后一个不完整区间内的采样值，从根本上避免 x % max 的模偏差。
     */
    function randomInt(maxExclusive) {
      if (!(maxExclusive > 0) || maxExclusive > 4294967296) {
        throw new Error('随机区间必须介于 1 到 2^32 之间');
      }
      var limit = Math.floor(4294967296 / maxExclusive) * maxExclusive;
      var x = 0;
      do { x = randomUint32(); } while (x >= limit);
      return x % maxExclusive;
    }

    return { secure: secure, notices: notices, randomInt: randomInt };
  }

  function clampInt(v, min, max, dflt) {
    var n = Number(v);
    if (!isFinite(n)) n = dflt;
    n = Math.round(n);
    return Math.max(min, Math.min(max, n));
  }

  function hasAmbiguous(s) {
    for (var i = 0; i < s.length; i++) if (AMBIGUOUS.indexOf(s.charAt(i)) >= 0) return true;
    return false;
  }

  /* ============================ 正则解析器（递归下降） ============================ */

  function uniqueChars(chars) {
    var seen = {};
    var out = [];
    for (var i = 0; i < chars.length; i++) {
      var c = chars[i];
      if (!seen[c]) { seen[c] = true; out.push(c); }
    }
    return out;
  }

  function rangeChars(a, b) {
    var lo = a.charCodeAt(0), hi = b.charCodeAt(0);
    if (lo > hi) throw new Error('字符类范围端点颠倒：' + a + '-' + b);
    if (hi - lo > MAX_LENGTH) throw new Error('字符类范围过大：' + a + '-' + b);
    var out = [];
    for (var i = lo; i <= hi; i++) out.push(String.fromCharCode(i));
    return out;
  }

  function hexChar(src, pos, digits) {
    var s = src.substr(pos, digits);
    if (s.length !== digits || !/^[0-9a-fA-F]+$/.test(s)) throw new Error('无效的十六进制转义：\\' + (digits === 2 ? 'x' : 'u') + s);
    return { ch: String.fromCharCode(parseInt(s, 16)), next: pos + digits };
  }

  function Parser(pattern) {
    this.src = String(pattern == null ? '' : pattern);
    this.pos = 0;
  }

  /** 解析整条正则，返回可采样的 AST。 */
  Parser.prototype.parse = function () {
    if (!this.src) throw new Error('正则不能为空');
    var node = this.parseAlternation();
    if (this.pos < this.src.length) {
      throw new Error('不支持的正则语法（位置 ' + this.pos + '）：' + this.src.charAt(this.pos));
    }
    return node;
  };

  Parser.prototype.parseAlternation = function () {
    var alts = [this.parseSequence()];
    while (this.peek() === '|') { this.pos++; alts.push(this.parseSequence()); }
    if (alts.length === 1) return alts[0];
    return { type: 'alt', options: alts };
  };

  Parser.prototype.parseSequence = function () {
    var items = [];
    while (this.pos < this.src.length) {
      var c = this.src.charAt(this.pos);
      if (c === '|' || c === ')') break;
      var atom = this.parseAtom();
      var quant = this.parseQuantifier(); // 即使 atom 为零宽也消费量词，避免误解析后续字符
      if (!atom) continue;
      if (quant) items.push({ type: 'repeat', min: quant.min, max: quant.max, child: atom });
      else items.push(atom);
    }
    return { type: 'seq', items: items };
  };

  Parser.prototype.peek = function () { return this.src.charAt(this.pos); };

  Parser.prototype.parseAtom = function () {
    var c = this.peek();

    if (c === '(') {
      if (this.src.charAt(this.pos + 1) === '?') {
        var kind = this.src.charAt(this.pos + 2);
        if (kind === '=' || kind === '!') {
          // 零宽前后顾断言：采样阶段跳过，最终由 new RegExp(...).test() 自检保证
          this.skipGroup();
          return null;
        }
        if (kind === ':') this.pos += 3;
        else throw new Error('不支持的分组语法：(?' + kind);
      } else {
        this.pos += 1;
      }
      var inner = this.parseAlternation();
      if (this.peek() !== ')') throw new Error('分组缺少右括号 )');
      this.pos += 1;
      return inner;
    }

    if (c === '[') return this.parseClass();
    if (c === '\\') return this.parseEscape();
    if (c === '^' || c === '$') { this.pos++; return null; } // 零宽锚点
    if (c === '.') { this.pos++; return { type: 'chars', chars: nonOf('\r\n') }; }

    this.pos++;
    return { type: 'chars', chars: [c] };
  };

  /** 跳过一个完整分组（不解析内部），用于忽略零宽断言。 */
  Parser.prototype.skipGroup = function () {
    var depth = 0;
    while (this.pos < this.src.length) {
      var c = this.peek();
      if (c === '\\') { this.pos += 2; continue; }
      if (c === '[') { this.skipClass(); continue; }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) { this.pos++; return; }
      }
      this.pos++;
    }
    throw new Error('分组缺少右括号 )');
  };

  Parser.prototype.skipClass = function () {
    this.pos++; // [
    if (this.peek() === '^') this.pos++;
    var first = true;
    while (this.pos < this.src.length) {
      var c = this.peek();
      if (c === '\\') { this.pos += 2; continue; }
      if (c === ']' && !first) { this.pos++; return; }
      first = false;
      this.pos++;
    }
    throw new Error('字符类缺少右括号 ]');
  };

  Parser.prototype.parseClass = function () {
    this.pos++; // [
    var negate = false;
    if (this.peek() === '^') { negate = true; this.pos++; }
    var chars = [];
    var first = true;
    while (this.pos < this.src.length) {
      var c = this.peek();
      if (c === ']' && !first) { this.pos++; break; }
      first = false;
      var left = this.readClassItem();
      if (left.length === 1 && this.peek() === '-' && this.src.charAt(this.pos + 1) !== '' && this.src.charAt(this.pos + 1) !== ']') {
        this.pos++; // '-'
        var right = this.readClassItem();
        if (right.length !== 1) throw new Error('字符类范围端点必须是单个字符');
        chars = chars.concat(rangeChars(left[0], right[0]));
      } else {
        chars = chars.concat(left);
      }
    }
    var set = uniqueChars(chars);
    if (!set.length) throw new Error('空字符类 [] 无法采样');
    if (negate) {
      var excluded = {};
      set.forEach(function (x) { excluded[x] = true; });
      set = PRINTABLE.filter(function (x) { return !excluded[x]; });
      if (!set.length) throw new Error('取反字符类没有可采样字符');
    }
    return { type: 'chars', chars: set };
  };

  /** 读取字符类中的一个条目（单字符或 \d 之类的集合），返回字符数组。 */
  Parser.prototype.readClassItem = function () {
    var c = this.peek();
    if (c === '\\') {
      this.pos++;
      var e = this.peek();
      this.pos++;
      switch (e) {
        case 'd': return DIGITS.split('');
        case 'D': return NON_DIGIT.slice();
        case 'w': return WORD.split('');
        case 'W': return NON_WORD.slice();
        case 's': return SPACE_CHARS.split('');
        case 'S': return NON_SPACE.slice();
        case 'n': return ['\n'];
        case 'r': return ['\r'];
        case 't': return ['\t'];
        case 'f': return ['\f'];
        case 'v': return ['\v'];
        case '0': return ['\0'];
        case 'x': {
          var h = hexChar(this.src, this.pos, 2);
          this.pos = h.next;
          return [h.ch];
        }
        case 'u': {
          var u = hexChar(this.src, this.pos, 4);
          this.pos = u.next;
          return [u.ch];
        }
        default: return [e]; // \] \- \\ \. 等转义字面量
      }
    }
    this.pos++;
    return [c];
  };

  /** 解析类外转义，返回字符节点；零宽 \b 返回 null。 */
  Parser.prototype.parseEscape = function () {
    this.pos++; // \
    var e = this.peek();
    this.pos++;
    switch (e) {
      case 'b': return null; // 词边界：零宽，跳过
      case 'd': return { type: 'chars', chars: DIGITS.split('') };
      case 'D': return { type: 'chars', chars: NON_DIGIT.slice() };
      case 'w': return { type: 'chars', chars: WORD.split('') };
      case 'W': return { type: 'chars', chars: NON_WORD.slice() };
      case 's': return { type: 'chars', chars: SPACE_CHARS.split('') };
      case 'S': return { type: 'chars', chars: NON_SPACE.slice() };
      case 'n': return { type: 'chars', chars: ['\n'] };
      case 'r': return { type: 'chars', chars: ['\r'] };
      case 't': return { type: 'chars', chars: ['\t'] };
      case 'f': return { type: 'chars', chars: ['\f'] };
      case 'v': return { type: 'chars', chars: ['\v'] };
      case '0': return { type: 'chars', chars: ['\0'] };
      case 'x': {
        var h = hexChar(this.src, this.pos, 2);
        this.pos = h.next;
        return { type: 'chars', chars: [h.ch] };
      }
      case 'u': {
        var u = hexChar(this.src, this.pos, 4);
        this.pos = u.next;
        return { type: 'chars', chars: [u.ch] };
      }
      case '1': case '2': case '3': case '4': case '5':
      case '6': case '7': case '8': case '9':
        throw new Error('不支持反向引用 \\' + e);
      default: return { type: 'chars', chars: [e] }; // 转义字面量
    }
  };

  Parser.prototype.parseQuantifier = function () {
    var c = this.peek();
    if (c === '{') {
      var m = /^\{(\d+)(,(\d*)?)?\}/.exec(this.src.substr(this.pos));
      if (!m) return null; // 非量词的 '{' 按字面量处理
      this.pos += m[0].length;
      var min = parseInt(m[1], 10);
      var max = (m[2] === undefined) ? min : (m[3] === '' ? -1 : parseInt(m[3], 10));
      if (min > MAX_LENGTH) throw new Error('量词次数过大：' + m[0]);
      if (max >= 0 && max < min) throw new Error('量词上下界颠倒：' + m[0]);
      if (this.peek() === '?') this.pos++; // 惰性量词：采样分布相同，忽略
      return { min: min, max: max };
    }
    if (c === '+') { this.pos++; if (this.peek() === '?') this.pos++; return { min: 1, max: -1 }; }
    if (c === '*') { this.pos++; if (this.peek() === '?') this.pos++; return { min: 0, max: -1 }; }
    if (c === '?') { this.pos++; if (this.peek() === '?') this.pos++; return { min: 0, max: 1 }; }
    return null;
  };

  /* ============================ 采样引擎 ============================ */

  function effectiveMax(q) {
    var max = q.max < 0 ? q.min + UNBOUNDED_EXTRA : q.max;
    if (max > MAX_REPEAT) max = MAX_REPEAT;
    if (max < q.min) max = q.min;
    return max;
  }

  function generateNode(node, out, random) {
    switch (node.type) {
      case 'seq':
        for (var i = 0; i < node.items.length; i++) generateNode(node.items[i], out, random);
        return;
      case 'alt':
        generateNode(node.options[random.randomInt(node.options.length)], out, random);
        return;
      case 'chars':
        out.push(node.chars[random.randomInt(node.chars.length)]);
        return;
      case 'repeat': {
        var max = effectiveMax(node);
        var n = node.min + random.randomInt(max - node.min + 1);
        for (var j = 0; j < n; j++) generateNode(node.child, out, random);
        return;
      }
      default:
        throw new Error('未知语法节点：' + node.type);
    }
  }

  function compile(pattern) {
    var p = String(pattern == null ? '' : pattern);
    if (!p) throw new Error('正则不能为空');
    try { return new RegExp(p); }
    catch (e) { throw new Error('自定义正则无效：' + ((e && e.message) || String(e))); }
  }

  /**
   * 创建采样器：一次编译 + 一次随机源探测，可重复采样多条。
   * @param {string} pattern 正则模式
   * @param {{excludeAmbiguous?:boolean, attempts?:number}} opts 选项
   * @returns {{secure:boolean, notices:string[], attempts:number, sample:function():({value:string,attempts:number}|null)}}
   */
  function createSampler(pattern, opts) {
    opts = opts || {};
    var re = compile(pattern);
    var ast = new Parser(pattern).parse();
    var random = createRandomSource();
    var attempts = clampInt(opts.attempts, 1, 1000, MAX_ATTEMPTS);
    var excludeAmbiguous = !!opts.excludeAmbiguous;

    return {
      secure: random.secure,
      notices: random.notices.slice(),
      attempts: attempts,
      sample: function () {
        for (var i = 0; i < attempts; i++) {
          var out = [];
          generateNode(ast, out, random);
          var s = out.join('');
          if (s.length > MAX_LENGTH) continue;
          if (/[\r\n]/.test(s)) continue; // 保证「一行一个」的输出结构
          if (!re.test(s)) continue;      // 强制自检：零宽断言等约束在此生效
          if (excludeAmbiguous && hasAmbiguous(s)) continue; // 易混淆字符整条重采样
          return { value: s, attempts: i + 1 };
        }
        return null;
      }
    };
  }

  /* ============================ 公开 API ============================ */

  /**
   * 根据模板 id 与自定义正则文本框解析出最终使用的正则。
   * 自定义正则（trim 后非空）优先；否则回落到模板，模板 id 无效时回落到首个模板。
   * @param {string} templateId 模板 value
   * @param {string} customPattern 用户填写的正则
   * @returns {{pattern:string, source:'custom'|'template', template:string, label:string}}
   */
  function resolvePattern(templateId, customPattern) {
    var custom = String(customPattern == null ? '' : customPattern).trim();
    if (custom) return { pattern: custom, source: 'custom', template: '', label: '自定义正则' };
    var found = null;
    for (var i = 0; i < TEMPLATES.length; i++) {
      if (TEMPLATES[i].value === templateId) { found = TEMPLATES[i]; break; }
    }
    if (!found) found = TEMPLATES[0];
    return { pattern: found.pattern, source: 'template', template: found.value, label: found.label };
  }

  /**
   * 批量生成：核心入口。
   * @param {string} pattern 正则模式
   * @param {{count?:number, excludeAmbiguous?:boolean, attempts?:number}} opts 选项（count 限 1-50）
   * @returns {{ok:boolean, output:string, values:string[], notices:string[], error:string|null}}
   */
  function generate(pattern, opts) {
    opts = opts || {};
    var count = clampInt(opts.count, 1, 50, 5);
    var sampler;
    try {
      sampler = createSampler(pattern, opts);
    } catch (e) {
      return { ok: false, output: '', values: [], notices: [], error: (e && e.message) || String(e) };
    }
    var values = [];
    var notices = sampler.notices.slice();
    var failed = 0;
    for (var i = 0; i < count; i++) {
      var r = sampler.sample();
      if (r) values.push(r.value);
      else failed++;
    }
    if (failed) {
      notices.push('有 ' + failed + ' 条在 ' + sampler.attempts + ' 次重试内未满足约束，已跳过；请检查正则是否可满足。');
    }
    if (!values.length) {
      notices.push('未生成任何结果。');
      return { ok: false, output: '', values: [], notices: notices, error: '无法在限定重试次数内生成满足正则的结果，请检查正则约束或关闭「排除易混淆字符」。' };
    }
    return { ok: true, output: values.join('\n'), values: values, notices: notices, error: null };
  }

  /**
   * 生成单条（便捷 API），失败时抛出异常。
   * @param {string} pattern 正则模式
   * @param {{excludeAmbiguous?:boolean, attempts?:number}} opts 选项
   * @returns {{value:string, attempts:number, secure:boolean, notices:string[]}}
   */
  function sample(pattern, opts) {
    var sampler = createSampler(pattern, opts);
    var r = sampler.sample();
    if (!r) throw new Error('在 ' + sampler.attempts + ' 次重试内未能生成满足正则的结果');
    return { value: r.value, attempts: r.attempts, secure: sampler.secure, notices: sampler.notices.slice() };
  }

  /** 校验正则可否被本引擎采样。 */
  function validate(pattern) {
    try {
      compile(pattern);
      new Parser(pattern).parse();
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  NS.password = {
    TEMPLATES: TEMPLATES,
    AMBIGUOUS: AMBIGUOUS,
    createRandomSource: createRandomSource,
    createSampler: createSampler,
    resolvePattern: resolvePattern,
    generate: generate,
    sample: sample,
    validate: validate
  };
})(typeof window !== 'undefined' ? window : globalThis);
