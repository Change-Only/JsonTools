/*!
 * core/mdddl.js —— JSON 工具箱 · Markdown 表格 → 建表 DDL 纯逻辑层（零 DOM 依赖）
 * 职责：解析 Markdown 表格（表头别名识别 / 位置回退）、类型映射（MySQL/PostgreSQL/Oracle）、
 *       生成 CREATE TABLE 语句（命名风格 / 主键 / 字段注释）。
 * 加载方式：经典 <script>，暴露 window.JTCore.mdddl；Node 下暴露 globalThis.JTCore.mdddl。
 */
(function (root) {
  'use strict';

  var NS = (root.JTCore = root.JTCore || {});

  /* ============================ 命名风格（独立实现，避免跨 core 依赖） ============================ */

  /**
   * 将各种命名（camelCase / snake_case / PascalCase / 中文）拆分为单词数组。
   * @param {*} name 待拆分名称
   * @return {Array<string>} 单词数组
   */
  function splitWords(name) {
    return String(name == null ? '' : name)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/[^A-Za-z0-9\u4e00-\u9fa5]+/)
      .filter(function (w) { return w.length > 0; });
  }
  /** @param {*} name @return {string} PascalCase */
  function toPascal(name) {
    var w = splitWords(name);
    if (!w.length) return 'Type';
    return w.map(function (x) { return x.charAt(0).toUpperCase() + x.slice(1); }).join('');
  }
  /** @param {*} name @return {string} camelCase */
  function toCamel(name) {
    var p = toPascal(name);
    return p.charAt(0).toLowerCase() + p.slice(1);
  }
  /** @param {*} name @return {string} snake_case */
  function toSnake(name) {
    var w = splitWords(name);
    if (!w.length) return 'field';
    return w.map(function (x) { return x.toLowerCase(); }).join('_');
  }
  /**
   * 按风格转换列名，支持 snake / upper_snake / pascal / camel / keep。
   * @param {*} name 原始名称
   * @param {string} style 命名风格
   * @return {string} 转换后的名称
   */
  function styleName(name, style) {
    switch (style) {
      case 'snake': return toSnake(name);
      case 'upper_snake': return toSnake(name).toUpperCase();
      case 'pascal': return toPascal(name);
      case 'keep': return String(name == null ? '' : name);
      case 'camel':
      default: return toCamel(name);
    }
  }

  /* ============================ 通用小工具 ============================ */

  /** 向 notices 数组追加一条中文提示（自动去重）。 */
  function pushNotice(notices, msg) {
    if (!Array.isArray(notices) || !msg) return;
    if (notices.indexOf(msg) < 0) notices.push(msg);
  }

  /** 表头/取值归一化：去空白、下划线、横线、中英文冒号并转小写。 */
  function normKey(s) {
    return String(s == null ? '' : s).replace(/[\s_\-—–:：]/g, '').toLowerCase();
  }

  /** 标识符归一化：仅保留字母数字并转小写，用于跨命名风格比较主键。 */
  function normIdent(s) {
    return String(s == null ? '' : s).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  }

  /** 判断 arr 是否包含值 v。 */
  function inArr(arr, v) { return arr.indexOf(v) >= 0; }

  /**
   * 拆分一行 Markdown 表格单元格：支持有无首尾 |、单元格前后空格、转义 \|。
   * @param {string} line 表格中的一行文本
   * @return {Array<string>} 去空格后的单元格数组
   */
  function splitRow(line) {
    var PH = '\u0001';
    var s = String(line == null ? '' : line).replace(/\\\|/g, PH);
    s = s.replace(/^\s+|\s+$/g, '');
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
    return s.split('|').map(function (c) {
      return c.replace(new RegExp(PH, 'g'), '|').replace(/^\s+|\s+$/g, '');
    });
  }

  /** 判断是否为 --- / :--- / ---: / :---: 分隔行。 */
  function isSeparatorRow(cells) {
    if (!cells.length) return false;
    for (var i = 0; i < cells.length; i++) {
      if (!/^:?-+:?$/.test(cells[i].replace(/\s/g, ''))) return false;
    }
    return true;
  }

  /**
   * 从类型字符串中剥离内嵌长度，如 varchar(64) → { type:'varchar', length:'64' }、
   * decimal(10,2) → { type:'decimal', length:'10', scale:'2' }。
   * @param {string} raw 原始类型文本
   * @return {{type: string, length: string, scale: string}}
   */
  function extractTypeParts(raw) {
    var t = String(raw == null ? '' : raw).trim();
    var m = /^(.*?)\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/.exec(t);
    if (!m) return { type: t, length: '', scale: '' };
    return { type: m[1].trim(), length: m[2], scale: m[3] || '' };
  }

  /* ============================ 表头别名 ============================ */

  var HEADER_ALIASES = {
    name: ['英文名称', '字段名', '列名', 'name', 'column', 'field', 'english name'],
    type: ['类型', 'type', 'datatype', 'data type'],
    length: ['最大长度', '长度', 'length', 'max length', 'size'],
    notNull: ['是否非空', '非空', 'not null', 'nullable', 'required', '必填'],
    comment: ['参数说明', '说明', '描述', 'comment', 'description', 'remark', '备注']
  };
  var ALIAS_TO_FIELD = {};
  Object.keys(HEADER_ALIASES).forEach(function (field) {
    HEADER_ALIASES[field].forEach(function (alias) { ALIAS_TO_FIELD[normKey(alias)] = field; });
  });

  var NOT_NULL_TRUE = { '是': 1, 'y': 1, 'yes': 1, 'true': 1, '1': 1, '非空': 1, 'notnull': 1, '必填': 1 };
  var NOT_NULL_FALSE = { '否': 1, 'n': 1, 'no': 1, 'false': 1, '0': 1, '空': 1, '可空': 1, 'nullable': 1, 'null': 1, '': 1 };

  /* ============================ parseTable ============================ */

  /**
   * 解析 Markdown 表格为字段定义数组。
   * @param {string} text Markdown 表格文本
   * @return {{columns: Array<{name: string, type: string, length: (number|string), notNull: boolean, comment: string}>, error: string, errorLine: (number|null), notices: Array<string>}}
   */
  function parseTable(text) {
    var notices = [];
    var columns = [];
    var raw = String(text == null ? '' : text);
    var lines = raw.split(/\r\n|\r|\n/);

    var headerIdx = -1;
    var headers = [];
    for (var i = 0; i < lines.length; i++) {
      var cells = splitRow(lines[i]);
      if (cells.length === 1 && !cells[0]) continue; // 跳过空行
      headerIdx = i;
      headers = cells;
      break;
    }
    if (headerIdx < 0) {
      return { columns: [], error: '输入为空：请粘贴 Markdown 表格', errorLine: null, notices: notices };
    }
    if (headers.length < 2 || (headers.length === 1 && !headers[0])) {
      return { columns: [], error: '表格表头无效：至少需要「英文名称」与「类型」两列', errorLine: headerIdx + 1, notices: notices };
    }

    var mapping = { name: -1, type: -1, length: -1, notNull: -1, comment: -1 };
    headers.forEach(function (h, idx) {
      var field = ALIAS_TO_FIELD[normKey(h)];
      if (!field) {
        if (String(h).trim()) pushNotice(notices, '表头列「' + h + '」未能识别，已忽略');
        return;
      }
      if (mapping[field] >= 0) {
        pushNotice(notices, '表头列「' + h + '」与前面的列都识别为「' + field + '」，仅使用第一个');
        return;
      }
      mapping[field] = idx;
    });

    if (mapping.name < 0 || mapping.type < 0) {
      if (headers.length === 5) {
        mapping = { name: 0, type: 1, length: 2, notNull: 3, comment: 4 };
        pushNotice(notices, '表头未识别出「英文名称」与「类型」，已按 5 列默认顺序（名称/类型/最大长度/非空/说明）解析');
      } else {
        return { columns: [], error: '无法识别表头：至少需要「英文名称」与「类型」两列', errorLine: headerIdx + 1, notices: notices };
      }
    }

    var maxIdx = Math.max(mapping.name, mapping.type, mapping.length, mapping.notNull, mapping.comment);
    var warnedShort = false;
    var warnedLong = false;
    var dataStart = headerIdx + 1;
    if (dataStart < lines.length && isSeparatorRow(splitRow(lines[dataStart]))) dataStart++;

    function cellAt(cells, idx) { return idx >= 0 && idx < cells.length ? cells[idx] : ''; }

    for (var r = dataStart; r < lines.length; r++) {
      var lineNo = r + 1;
      var rowCells = splitRow(lines[r]);
      if (rowCells.length === 1 && !rowCells[0]) continue;
      if (isSeparatorRow(rowCells)) continue;
      if (rowCells.length === 1 && lines[r].indexOf('|') < 0) {
        pushNotice(notices, '第 ' + lineNo + ' 行缺少分隔符 |，已忽略');
        continue;
      }
      if (rowCells.length < maxIdx + 1 && !warnedShort) {
        pushNotice(notices, '存在列数不足的行（少于 ' + (maxIdx + 1) + ' 列），缺失单元格已按空处理');
        warnedShort = true;
      }
      if (rowCells.length > maxIdx + 1 && !warnedLong) {
        pushNotice(notices, '存在列数超出的行（多于 ' + (maxIdx + 1) + ' 列），多余单元格已忽略');
        warnedLong = true;
      }

      var name = cellAt(rowCells, mapping.name).trim();
      if (!name) {
        pushNotice(notices, '第 ' + lineNo + ' 行缺少英文名称，已跳过');
        continue;
      }
      var typeRaw = cellAt(rowCells, mapping.type).trim();
      var parts = extractTypeParts(typeRaw);
      var typeName = parts.type;
      if (!typeName) {
        typeName = 'varchar';
        pushNotice(notices, '第 ' + lineNo + ' 行缺少类型，已按 varchar 处理');
      }

      var lengthVal = '';
      var lenCell = cellAt(rowCells, mapping.length).trim();
      if (lenCell) {
        var lm = /^(\d+)(?:\s*,\s*\d+)?$/.exec(lenCell);
        if (lm) lengthVal = parseInt(lm[1], 10);
        else pushNotice(notices, '第 ' + lineNo + ' 行「最大长度」值「' + lenCell + '」非法，已忽略');
      }
      if ((lengthVal === '' || !isFinite(lengthVal)) && parts.length) {
        lengthVal = parseInt(parts.length, 10);
      }

      var nnRaw = cellAt(rowCells, mapping.notNull).trim();
      var nnKey = normKey(nnRaw);
      var notNull = !!NOT_NULL_TRUE[nnKey];
      if (!NOT_NULL_TRUE[nnKey] && !NOT_NULL_FALSE[nnKey]) {
        pushNotice(notices, '第 ' + lineNo + ' 行「是否非空」值「' + nnRaw + '」无法识别，已按「否」处理');
      }

      columns.push({
        name: name,
        type: typeName,
        length: lengthVal,
        notNull: notNull,
        comment: cellAt(rowCells, mapping.comment).trim()
      });
    }

    if (!columns.length) pushNotice(notices, '表格中没有可用的数据行');
    return { columns: columns, error: '', errorLine: null, notices: notices };
  }

  /* ============================ mapType ============================ */

  /**
   * 将表格中的类型名映射为目标方言的 SQL 类型。
   * 未知类型会经过安全过滤（仅保留字母数字下划线括号逗号）后大写透传，并通过 opts.report 给出提示。
   * @param {string} typeName 类型名（大小写不敏感）
   * @param {(number|string)} length 最大长度
   * @param {string} dialect 'mysql' | 'postgresql' | 'oracle'
   * @param {{report?: Array<string>, scale?: number}} opts 附加选项
   * @return {string} SQL 类型片段
   */
  function mapType(typeName, length, dialect, opts) {
    opts = opts || {};
    var report = opts.report;
    var d = String(dialect || 'mysql').toLowerCase();
    if (d !== 'mysql' && d !== 'postgresql' && d !== 'oracle') d = 'mysql';
    var isMy = d === 'mysql', isPg = d === 'postgresql', isOra = d === 'oracle';
    var raw = String(typeName == null ? '' : typeName).trim();
    var parts = extractTypeParts(raw);
    var t = parts.type.toLowerCase().replace(/\s+/g, '');
    if (!t && raw) t = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    var n = parseInt(length == null || length === '' ? parts.length : length, 10);
    if (!isFinite(n) || n <= 0) n = 0;
    function note(msg) { pushNotice(report, msg); }

    // 整数
    if (inArr(['int', 'integer', 'int32', 'serial'], t)) return isMy ? 'INT' : (isOra ? 'NUMBER(10)' : 'INTEGER');
    if (inArr(['bigint', 'int64', 'long', 'bigserial'], t)) return isMy ? 'BIGINT' : (isOra ? 'NUMBER(19)' : 'BIGINT');
    if (inArr(['smallint', 'short', 'int16', 'smallserial'], t)) return isMy ? 'SMALLINT' : (isOra ? 'NUMBER(5)' : 'SMALLINT');
    if (inArr(['tinyint', 'byte', 'int8'], t)) return isMy ? 'TINYINT' : (isOra ? 'NUMBER(3)' : 'SMALLINT');

    // 浮点与定点小数
    if (inArr(['float', 'double', 'doubleprecision', 'real'], t)) return isMy ? 'DOUBLE' : (isOra ? 'NUMBER' : 'DOUBLE PRECISION');
    if (inArr(['decimal', 'numeric', 'number', 'dec', 'money'], t)) {
      var prec = n || 10;
      var scale = parseInt(opts.scale, 10);
      if (!isFinite(scale) || scale < 0) scale = 2;
      if (scale > prec) scale = prec;
      return isMy ? ('DECIMAL(' + prec + ',' + scale + ')') : (isOra ? 'NUMBER' : 'NUMERIC');
    }

    // 字符串 / 大文本
    var LONG_TYPES = ['text', 'clob', 'longtext', 'mediumtext', 'ntext', 'long'];
    var STR_TYPES = ['varchar', 'varchar2', 'string', 'str', 'char', 'character', 'nvarchar', 'nchar'].concat(LONG_TYPES);
    if (inArr(STR_TYPES, t)) {
      if (inArr(LONG_TYPES, t)) {
        if (isOra) return 'CLOB';
        if (isMy) return (t === 'longtext' || t === 'long') ? 'LONGTEXT' : 'TEXT';
        return 'TEXT';
      }
      var size = n || 255;
      if (isOra && size > 4000) {
        note('长度 ' + size + ' 超过 Oracle VARCHAR2 上限 4000，已改用 CLOB');
        return 'CLOB';
      }
      if ((isMy || isPg) && size > 65535) {
        note('长度 ' + size + ' 过大，已改用长文本类型');
        return isMy ? 'LONGTEXT' : 'TEXT';
      }
      return (isOra ? 'VARCHAR2(' : 'VARCHAR(') + size + ')';
    }

    // 布尔：Oracle SQL 无 BOOLEAN，用 NUMBER(1) 存 0/1
    if (inArr(['bool', 'boolean', 'bit'], t)) {
      if (isOra) note('Oracle SQL 无 BOOLEAN 类型，已用 NUMBER(1)（0/1）代替');
      return isMy ? 'TINYINT(1)' : (isOra ? 'NUMBER(1)' : 'BOOLEAN');
    }

    // 日期时间：所有方言、所有别名统一映射为 TIMESTAMP
    var TIME_TYPES = [
      'date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset',
      'timestamp', 'timestamptz', 'timestampwithtimezone', 'timestampwithouttimezone',
      'time', 'timetz', 'timewithtimezone', 'timewithouttimezone'
    ];
    if (inArr(TIME_TYPES, t)) return 'TIMESTAMP';

    // JSON / 对象 / 数组
    if (inArr(['json', 'jsonb', 'array', 'object', 'map', 'list'], t)) {
      if (isOra) note('Oracle 无原生 JSON 标量列类型，已用 CLOB 承载');
      return isMy ? 'JSON' : (isPg ? 'JSONB' : 'CLOB');
    }

    // 二进制
    if (inArr(['blob', 'binary', 'bytes', 'bytea', 'varbinary', 'longblob'], t)) {
      if (isMy) return t === 'longblob' ? 'LONGBLOB' : 'BLOB';
      return isPg ? 'BYTEA' : 'BLOB';
    }

    // UUID
    if (t === 'uuid') return isMy ? 'CHAR(36)' : (isOra ? 'VARCHAR2(36)' : 'UUID');

    // 未知类型：安全过滤后大写透传
    var safe = raw.replace(/[^A-Za-z0-9_(),]/g, '').toUpperCase();
    if (!safe) safe = 'TEXT';
    note('未知类型 ' + raw + '，已原样输出');
    return safe;
  }

  /* ============================ toDDL ============================ */

  /**
   * 主键匹配：兼容原始字段名、转换后的列名，以及跨命名风格的归一化比较。
   * @param {string} rawName 原始字段名
   * @param {string} colName 转换后的列名
   * @param {string} pk 主键字段名
   * @return {boolean}
   */
  function isPkMatch(rawName, colName, pk) {
    if (!pk) return false;
    var a = normIdent(pk);
    if (!a) return false;
    if (normIdent(rawName) === a || normIdent(colName) === a) return true;
    var styles = ['snake', 'upper_snake', 'camel', 'pascal', 'keep'];
    for (var i = 0; i < styles.length; i++) {
      if (normIdent(styleName(pk, styles[i])) === a) {
        if (normIdent(rawName) === a || normIdent(colName) === a) return true;
      }
      if (normIdent(styleName(rawName, styles[i])) === a) return true;
    }
    return false;
  }

  /** MySQL 列尾注释：替换换行、转义反引号。 */
  function mysqlComment(s) {
    return String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/`/g, "'");
  }
  /** PG/Oracle 字符串字面量：单引号用 '' 转义。 */
  function sqlLiteral(s) {
    return String(s == null ? '' : s).replace(/'/g, "''");
  }

  /**
   * 依据字段定义生成 CREATE TABLE 语句。
   * @param {Array<{name: string, type: string, length: (number|string), notNull: boolean, comment: string}>} columns 字段定义
   * @param {{dialect?: string, tableName?: string, nameStyle?: string, primaryKey?: string, withComments?: boolean, report?: Array<string>}} opts 选项
   * @return {{output: string, notices: Array<string>, error: string}}
   */
  function toDDL(columns, opts) {
    opts = opts || {};
    var notices = Array.isArray(opts.report) ? opts.report : [];
    var dialect = String(opts.dialect || 'mysql').toLowerCase();
    if (dialect !== 'mysql' && dialect !== 'postgresql' && dialect !== 'oracle') {
      pushNotice(notices, '未知方言「' + dialect + '」，已按 MySQL 输出');
      dialect = 'mysql';
    }
    var isMy = dialect === 'mysql';

    if (!Array.isArray(columns) || !columns.length) {
      pushNotice(notices, '没有可生成 DDL 的列');
      return { output: '', notices: notices, error: '没有可生成 DDL 的列：请检查 Markdown 表格是否包含数据行' };
    }

    var tableRaw = String(opts.tableName == null ? '' : opts.tableName).trim();
    if (!tableRaw) tableRaw = 'my_table';
    var table = tableRaw.replace(/[`"'\[\];\r\n\t\\]/g, '');
    if (table !== tableRaw) pushNotice(notices, '表名包含引号/分号等非法字符，已自动清理');
    table = table.replace(/^\.+|\.+$/g, '');
    if (!table) return { output: '', notices: notices, error: '表名非法或为空，请重新填写' };

    var quote = isMy ? '`' : '"';
    function q(s) { return quote + s + quote; }

    var lines = [];
    if (isMy) lines.push('-- MySQL 建表语句（由 Markdown 表格生成，仅供参考）');
    else if (dialect === 'postgresql') lines.push('-- PostgreSQL 建表语句（由 Markdown 表格生成，仅供参考）');
    else lines.push('-- Oracle 建表语句（由 Markdown 表格生成，仅供参考）');
    lines.push('CREATE TABLE ' + q(table) + ' (');

    var pk = String(opts.primaryKey == null ? '' : opts.primaryKey).trim();
    var withComments = opts.withComments !== false;
    var seen = {};
    var pkAssigned = false;
    var cols = [];
    var commentStmts = [];

    for (var i = 0; i < columns.length; i++) {
      var col = columns[i] || {};
      var base = styleName(col.name, opts.nameStyle);
      if (!base) {
        pushNotice(notices, '第 ' + (i + 1) + ' 个字段名称无效，已跳过');
        continue;
      }
      var finalName = base;
      if (seen[finalName]) {
        var k = 1;
        while (seen[finalName + '_' + k]) k++;
        finalName = base + '_' + k;
        pushNotice(notices, '列名 ' + base + ' 重复，已自动改名为 ' + finalName);
      }
      seen[finalName] = true;

      var sqlType = mapType(col.type, col.length, dialect, { report: notices });
      var part = '  ' + q(finalName) + ' ' + sqlType;
      var isPk = !pkAssigned && isPkMatch(String(col.name == null ? '' : col.name), finalName, pk);
      if (isPk) { pkAssigned = true; part += ' PRIMARY KEY'; }
      else if (!!col.notNull) part += ' NOT NULL';

      var cmt = String(col.comment == null ? '' : col.comment).trim();
      if (withComments && cmt) {
        if (isMy) part += '  -- ' + mysqlComment(cmt);
        else commentStmts.push('COMMENT ON COLUMN ' + q(table) + '.' + q(finalName) + " IS '" + sqlLiteral(cmt) + "';");
      }
      cols.push(part);
    }

    if (!cols.length) {
      pushNotice(notices, '所有字段均无效，无法生成 DDL');
      return { output: '', notices: notices, error: '没有可生成 DDL 的有效列：请检查字段名称是否合法' };
    }
    if (pk && !pkAssigned) pushNotice(notices, '主键字段「' + pk + '」未在表格中找到，已忽略');

    lines.push(cols.join(',\n'));
    lines.push(');');
    if (commentStmts.length) {
      lines.push('');
      lines.push(commentStmts.join('\n'));
    }
    return { output: lines.join('\n'), notices: notices, error: '' };
  }

  NS.mdddl = {
    parseTable: parseTable,
    mapType: mapType,
    toDDL: toDDL
  };
})(typeof window !== 'undefined' ? window : globalThis);
