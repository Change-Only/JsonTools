/*!
 * core/treebuild.js —— JSON 工具箱 · JSON 数组 → 父子结构重建纯逻辑层（零 DOM 依赖）
 *
 * 由 prototype/parent-child-tree.html 中已验收的核心算法原样迁移而来，仅去掉渲染层、
 * 弹窗、主题、Toast、拖拽分栏等 DOM 代码；算法行为（键规范化 / 重复 ID 双策略 /
 * 环检测断环 / 孤儿与自引用提升为根 / 迭代序列化）与原型保持一致。
 *
 * 加载方式：经典 <script>，挂载 window.JTCore.treebuild；
 * Node 中可直接 require（root 回退到 globalThis）。
 */
(function (root) {
  'use strict';

  var NS = (root.JTCore = root.JTCore || {});

  /* ============================ 常量 ============================ */

  var ID_CANDIDATES = ['id', '_id', 'ID', 'key', 'uuid'];
  var PARENT_CANDIDATES = ['parentId', 'parent_id', 'pid', 'parent', 'pId', 'PARENT_ID'];

  /* ============================ 基础工具 ============================ */

  /**
   * 给出值的中文类型名，用于跳过行提示。
   * @param {*} value 任意值
   * @returns {string}
   */
  function typeName(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return '数组';
    if (typeof value === 'object') return '对象';
    if (typeof value === 'string') return '字符串';
    if (typeof value === 'number') return '数字';
    if (typeof value === 'boolean') return '布尔值';
    return typeof value;
  }

  /**
   * 构造一条处理提示。
   * @param {string} level 'info' | 'warn'
   * @param {string} tag 简短分类标签
   * @param {string} text 中文说明
   * @returns {{level: string, tag: string, text: string}}
   */
  function makeIssue(level, tag, text) {
    return { level: level, tag: tag, text: text };
  }

  /**
   * 判断父字段值是否表示「根节点」。
   * null / undefined / 0 / 空串 / '0' / 'root'（忽略大小写与首尾空白）均视为根。
   * @param {*} value 父字段值
   * @returns {boolean}
   */
  function isRootMarker(value) {
    if (value === null || value === undefined) return true;
    if (value === 0) return true;
    if (typeof value === 'string') {
      var t = value.trim();
      if (t === '' || t === '0') return true;
      if (t.toLowerCase() === 'root') return true;
    }
    return false;
  }

  /** 收集所有对象行中出现过的字段名（原型行为：非对象行忽略）。 */
  function collectKeys(rows) {
    var set = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      for (var key in row) {
        if (Object.prototype.hasOwnProperty.call(row, key)) set[key] = true;
      }
    }
    return set;
  }

  /** 返回候选列表中第一个在数据中出现的字段名，未命中返回空串。 */
  function firstPresent(candidates, keySet) {
    for (var i = 0; i < candidates.length; i++) {
      if (keySet[candidates[i]]) return candidates[i];
    }
    return '';
  }

  /**
   * 解析实际使用的字段名：优先用户显式填写且数据中存在的字段；
   * 开启自动探测时，为缺失的字段挑选第一个命中的常见候选名。
   * @param {Array<Object>} rows 输入数组
   * @param {Object} opts 规范化的构建选项
   * @param {Array<Object>} issues 提示收集数组（会被就地追加）
   * @returns {{idField: string, parentField: string, childrenField: string}}
   */
  function resolveFields(rows, opts, issues) {
    var keySet = collectKeys(rows);
    var idField = opts.idField || 'id';
    var parentField = opts.parentField || 'parentId';

    if (opts.autoDetect && !keySet[idField]) {
      var detectedId = firstPresent(ID_CANDIDATES, keySet);
      if (detectedId) {
        idField = detectedId;
        issues.push(makeIssue('info', '探测', '未找到「' + opts.idField + '」，已自动探测 ID 字段为「' + detectedId + '」。'));
      }
    }
    if (opts.autoDetect && !keySet[parentField]) {
      var detectedParent = firstPresent(PARENT_CANDIDATES, keySet);
      if (detectedParent) {
        parentField = detectedParent;
        issues.push(makeIssue('info', '探测', '未找到「' + opts.parentField + '」，已自动探测父字段为「' + detectedParent + '」。'));
      }
    }
    return {
      idField: idField,
      parentField: parentField,
      childrenField: opts.childrenField || 'children'
    };
  }

  /**
   * 校验字段名：不能为空、不能同名。原型的 UI 层校验迁移至此，保证 Node 直接调用也一致。
   * @param {Object} opts 构建选项
   * @returns {string} 错误说明；空串表示通过
   */
  function validateOptions(opts) {
    var o = opts || {};
    function raw(name, fallback) {
      var v = o[name];
      return (v === undefined || v === null) ? fallback : String(v).trim();
    }
    var id = raw('idField', 'id');
    var parent = raw('parentField', 'parentId');
    var children = raw('childrenField', 'children');
    if (!id || !parent || !children) {
      return '字段名不能为空，请检查 ID 字段、父字段与子节点字段名。';
    }
    if (id === parent || id === children || parent === children) {
      return 'ID 字段、父字段与子节点字段名不能相同。';
    }
    return '';
  }

  /** 把外部选项归一化为完整选项对象（缺省值对齐原型界面默认值）。 */
  function normalizeOptions(opts) {
    var o = opts || {};
    function textOf(value, fallback) {
      if (value === undefined || value === null) return fallback;
      var s = String(value).trim();
      return s || fallback;
    }
    return {
      idField: textOf(o.idField, 'id'),
      parentField: textOf(o.parentField, 'parentId'),
      childrenField: textOf(o.childrenField, 'children'),
      autoDetect: o.autoDetect === undefined || o.autoDetect === null ? true : !!o.autoDetect,
      removeParent: !!o.removeParent,
      keepOther: o.keepOther === undefined || o.keepOther === null ? true : !!o.keepOther,
      dupMode: o.dupMode === 'last' ? 'last' : 'first'
    };
  }

  var SPACE_CACHE = [];
  function spaces(count) {
    if (!SPACE_CACHE[count]) SPACE_CACHE[count] = new Array(count + 1).join(' ');
    return SPACE_CACHE[count];
  }

  /**
   * 迭代式 JSON 序列化：与 JSON.stringify(value, null, indent) 输出一致，
   * 但不使用递归，因此 5000 层深链也不会触发调用栈溢出。
   * @param {*} value 任意可序列化值
   * @param {number} indent 缩进空格数，0 表示紧凑输出
   * @returns {string}
   */
  function stringifyJson(value, indent) {
    var useIndent = indent > 0;
    var parts = [];
    var stack = [{ v: value, d: 0 }];
    while (stack.length) {
      var item = stack.pop();
      if (item.text !== undefined) {
        parts.push(item.text);
        continue;
      }
      var current = item.v;
      var depth = item.d;
      if (current === null) {
        parts.push('null');
        continue;
      }
      if (typeof current !== 'object') {
        var primitive = JSON.stringify(current);
        parts.push(primitive === undefined ? 'null' : primitive);
        continue;
      }
      var isArray = Array.isArray(current);
      var entries = isArray ? current : Object.keys(current);
      if (entries.length === 0) {
        parts.push(isArray ? '[]' : '{}');
        continue;
      }
      parts.push(isArray ? '[' : '{');
      stack.push({
        text: (useIndent ? '\n' + spaces(depth * indent) : '') + (isArray ? ']' : '}')
      });
      for (var i = entries.length - 1; i >= 0; i--) {
        if (i !== entries.length - 1) stack.push({ text: ',' });
        if (isArray) {
          stack.push({ v: entries[i], d: depth + 1 });
        } else {
          var key = entries[i];
          var child = current[key];
          stack.push({ v: child === undefined ? null : child, d: depth + 1 });
          stack.push({ text: JSON.stringify(key) + ':' + (useIndent ? ' ' : '') });
        }
        if (useIndent) stack.push({ text: '\n' + spaces((depth + 1) * indent) });
      }
    }
    return parts.join('');
  }

  /** 为单个内部节点生成浅层输出对象（子节点稍后按迭代方式挂载）。 */
  function shallowOutput(node, fields, opts) {
    var out = {};
    var row = node.row;
    if (opts.keepOther) {
      for (var key in row) {
        if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
        if (key === fields.childrenField) continue;
        if (key === fields.parentField && opts.removeParent) continue;
        out[key] = row[key];
      }
    } else {
      out[fields.idField] = row[fields.idField];
    }
    if (node.circular) out.__circularRef = true;
    return out;
  }

  /**
   * 构建父子树。
   * @param {Array<Object>} rows 输入数组
   * @param {Object} opts { idField, parentField, childrenField, autoDetect,
   *                        removeParent, keepOther, dupMode }；dupMode = 'first' | 'last'
   * @returns {{roots: Array<Object>, issues: Array<Object>, stats: Object, meta: Object}}
   */
  function buildTree(rows, opts) {
    var invalid = validateOptions(opts);
    if (invalid) throw new Error(invalid);
    if (!Array.isArray(rows)) throw new Error('输入应为 JSON 数组。');
    if (rows.length === 0) throw new Error('输入数组为空：至少需要 1 个节点。');

    var options = normalizeOptions(opts);
    var issues = [];
    var stats = {
      total: rows.length, valid: 0, roots: 0, maxDepth: 0,
      orphans: 0, cycles: 0, duplicates: 0, selfRefs: 0, skipped: 0
    };
    var fields = resolveFields(rows, options, issues);
    var idField = fields.idField;
    var parentField = fields.parentField;
    var childrenField = fields.childrenField;

    var byKey = new Map();
    var byUid = new Map();
    var order = [];

    /* --- 步骤 1：规范化、去重、建立字符串键索引（O(n)） --- */
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        stats.skipped++;
        issues.push(makeIssue('warn', '跳过', '第 ' + (i + 1) + ' 项不是对象（' + typeName(row) + '），已跳过。'));
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(row, idField) ||
          row[idField] === null || row[idField] === undefined || row[idField] === '') {
        stats.skipped++;
        issues.push(makeIssue('warn', '跳过', '第 ' + (i + 1) + ' 项缺少有效「' + idField + '」，已跳过。'));
        continue;
      }

      var key = String(row[idField]);
      var parentValue = row[parentField];
      if (byKey.has(key)) {
        stats.duplicates++;
        var previous = byKey.get(key);
        if (options.dupMode === 'last') {
          issues.push(makeIssue('warn', '重复', 'ID「' + key + '」在第 ' + (previous.index + 1) + '、' + (i + 1) + ' 项重复，已保留最后一项（后者覆盖）。'));
          previous.row = row;
          previous.index = i;
          previous.rawParent = parentValue;
        } else {
          stats.skipped++;
          issues.push(makeIssue('warn', '重复', 'ID「' + key + '」在第 ' + (previous.index + 1) + '、' + (i + 1) + ' 项重复，已保留首个并跳过后者。'));
        }
        continue;
      }

      var node = {
        uid: 'n' + i,
        key: key,
        row: row,
        index: i,
        rawParent: parentValue,
        parentKey: null,
        isRoot: false,
        orphan: false,
        selfRef: false,
        circular: false,
        children: [],
        depth: 0,
        path: '',
        out: null
      };
      byKey.set(key, node);
      byUid.set(node.uid, node);
      order.push(node);
    }

    if (byKey.size === 0) {
      throw new Error('没有可用于构建的有效节点：请检查 ID 字段与重复 ID 处理方式。');
    }
    stats.valid = byKey.size;

    /* --- 步骤 2：分类父引用（根 / 孤儿 / 自引用 / 正常） --- */
    for (var j = 0; j < order.length; j++) {
      var current = order[j];
      var parent = current.row[parentField];
      if (isRootMarker(parent)) {
        current.isRoot = true;
        continue;
      }
      if (typeof parent === 'object') {
        current.isRoot = true;
        current.orphan = true;
        stats.orphans++;
        issues.push(makeIssue('warn', '孤儿', '节点「' + current.key + '」的父字段是无效类型（对象 / 数组），已提升为根。'));
        continue;
      }
      var parentKey = String(parent);
      if (parentKey === current.key) {
        current.isRoot = true;
        current.selfRef = true;
        stats.selfRefs++;
        issues.push(makeIssue('warn', '自引用', '节点「' + current.key + '」的父字段指向自身，已提升为根。'));
        continue;
      }
      if (!byKey.has(parentKey)) {
        current.isRoot = true;
        current.orphan = true;
        stats.orphans++;
        issues.push(makeIssue('warn', '孤儿', '节点「' + current.key + '」的父 ID「' + parentKey + '」不存在，已提升为根。'));
        continue;
      }
      current.parentKey = parentKey;
    }

    /* --- 步骤 3：沿父链迭代检测环，断开回边并提升断环节点为根（O(n)） --- */
    var color = new Map(); // 1 = 当前路径；2 = 已完成
    for (var a = 0; a < order.length; a++) {
      var startKey = order[a].key;
      if (color.get(startKey) === 2) continue;
      var path = [];
      var position = new Map();
      var cursor = startKey;
      while (cursor !== null && color.get(cursor) !== 2) {
        if (color.get(cursor) === 1) {
          var loopStart = position.get(cursor);
          var loopKeys = path.slice(loopStart);
          var breakerKey = path[path.length - 1];
          var breaker = byKey.get(breakerKey);
          breaker.parentKey = null;
          breaker.isRoot = true;
          breaker.circular = true;
          stats.cycles++;
          var chain = loopKeys.concat([cursor]).join(' → ');
          issues.push(makeIssue('warn', '循环', '检测到循环引用：' + chain + '；已断开 ' + breakerKey + ' → ' + cursor + '，将 ' + breakerKey + ' 提升为根并标记 __circularRef。'));
          break;
        }
        color.set(cursor, 1);
        position.set(cursor, path.length);
        path.push(cursor);
        var nextKey = byKey.get(cursor).parentKey;
        if (nextKey === null || !byKey.has(nextKey)) break;
        cursor = nextKey;
      }
      for (var p = 0; p < path.length; p++) color.set(path[p], 2);
    }

    /* --- 步骤 4：挂载子节点 --- */
    for (var c = 0; c < order.length; c++) {
      var child = order[c];
      if (child.parentKey !== null && byKey.has(child.parentKey)) {
        byKey.get(child.parentKey).children.push(child);
      } else {
        child.isRoot = true;
      }
    }

    var roots = [];
    for (var r = 0; r < order.length; r++) {
      if (order[r].isRoot) roots.push(order[r]);
    }
    if (roots.length === 0) {
      // 理论不可达（环已在步骤 3 打断），此处为防御性兜底。
      var forcedRoot = order[0];
      forcedRoot.parentKey = null;
      forcedRoot.isRoot = true;
      roots.push(forcedRoot);
      issues.push(makeIssue('warn', '结构', '未能找到自然根节点，已将首节点提升为根。'));
    }

    /* --- 步骤 5：BFS 计算深度与路径（迭代，避免深链爆栈） --- */
    var queue = [];
    var visited = new Set();
    var head = 0;
    for (var q = 0; q < roots.length; q++) {
      roots[q].depth = 1;
      roots[q].path = String(roots[q].row[idField]);
      queue.push(roots[q]);
    }
    while (head < queue.length) {
      var node = queue[head++];
      if (visited.has(node.key)) continue;
      visited.add(node.key);
      if (node.depth > stats.maxDepth) stats.maxDepth = node.depth;
      for (var k = 0; k < node.children.length; k++) {
        var kid = node.children[k];
        if (visited.has(kid.key)) continue;
        kid.depth = node.depth + 1;
        kid.path = node.path + ' / ' + String(kid.row[idField]);
        queue.push(kid);
      }
    }
    stats.roots = roots.length;

    /* --- 步骤 6：迭代后序生成输出对象（避免递归爆栈） --- */
    var stack = [];
    for (var s = roots.length - 1; s >= 0; s--) stack.push({ node: roots[s], phase: 0 });
    while (stack.length) {
      var top = stack[stack.length - 1];
      if (top.phase === 0) {
        top.node.out = shallowOutput(top.node, fields, options);
        top.phase = 1;
        for (var ci = top.node.children.length - 1; ci >= 0; ci--) {
          stack.push({ node: top.node.children[ci], phase: 0 });
        }
      } else {
        var built = [];
        for (var cj = 0; cj < top.node.children.length; cj++) {
          built.push(top.node.children[cj].out);
        }
        top.node.out[childrenField] = built;
        stack.pop();
      }
    }

    var rootsOut = [];
    for (var ro = 0; ro < roots.length; ro++) rootsOut.push(roots[ro].out);
    var outputValue = rootsOut.length === 1 ? rootsOut[0] : rootsOut;
    // 极深树的缩进会产生数十 MB 文本：超过 1000 层自动切换紧凑输出。
    var compactOutput = stats.maxDepth > 1000;
    if (compactOutput) {
      issues.push(makeIssue('info', '输出', '树深度 ' + stats.maxDepth + ' 超过 1000 层，JSON 已改用紧凑格式，避免超大缩进影响性能。'));
    }
    var outputText = stringifyJson(outputValue, compactOutput ? 0 : 2);

    return {
      roots: rootsOut,
      issues: issues,
      stats: stats,
      meta: {
        byKey: byKey,
        byUid: byUid,
        order: order,
        roots: roots,
        fields: fields,
        outputValue: outputValue,
        outputText: outputText
      }
    };
  }

  /* ============================ 导出 ============================ */

  NS.treebuild = {
    buildTree: buildTree,
    resolveFields: resolveFields,
    isRootMarker: isRootMarker,
    stringifyJson: stringifyJson,
    shallowOutput: shallowOutput,
    makeIssue: makeIssue,
    collectKeys: collectKeys,
    validateOptions: validateOptions,
    typeName: typeName,
    ID_CANDIDATES: ID_CANDIDATES.slice(),
    PARENT_CANDIDATES: PARENT_CANDIDATES.slice()
  };
})(typeof window !== 'undefined' ? window : globalThis);
