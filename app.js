/* 小宝帮你做表格 —— 本地解析引擎 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const inputText = $('inputText');
  const parseMode = $('parseMode');
  const firstRowHeader = $('firstRowHeader');
  const btnParse = $('btnParse');
  const btnSample = $('btnSample');
  const resultCard = $('resultCard');
  const stats = $('stats');
  const table = $('resultTable');
  const toastEl = $('toast');

  let headers = [];
  let rows = [];
  // 表格上方的跨行标题（图片识别时保留，如"XX项目加班明细""三、岗位加班费："）
  let titles = [];

  const SAMPLE =
    '姓名：张三，年龄：28，城市：北京，电话：13800001111\n' +
    '姓名：李四，年龄：35，城市：上海，电话：13900002222\n' +
    '姓名：王五，年龄：24，城市：广州，电话：13700003333';

  /* ---------------- 键值对解析 ---------------- */
  // 字段名必须以中文 / 字母 / 下划线开头，避免把 "12:30" 误判成字段
  const KV_SOURCE = '([\\u4e00-\\u9fa5A-Za-z_][^\\s,，;；、|:：]{0,15})\\s*[:：]\\s*';

  function countKvPairs(text) {
    const re = new RegExp(KV_SOURCE, 'g');
    const m = text.match(re);
    return m ? m.length : 0;
  }

  function parseKeyValue(text) {
    const re = new RegExp(KV_SOURCE, 'g');
    const matches = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ key: m[1], valueStart: re.lastIndex, keyStart: m.index });
    }
    if (!matches.length) return { headers: [], rows: [], usedHeader: false };

    const headersAll = [];
    const records = [];
    let current = {};
    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i];
      const next = matches[i + 1];
      const raw = text.slice(cur.valueStart, next ? next.keyStart : text.length);
      const value = raw.replace(/^[\s,，;；、|]+/, '').replace(/[\s,，;；、|]+$/, '');
      if (Object.prototype.hasOwnProperty.call(current, cur.key)) {
        records.push(current);
        current = {};
      }
      current[cur.key] = value;
      if (headersAll.indexOf(cur.key) === -1) headersAll.push(cur.key);
    }
    if (Object.keys(current).length) records.push(current);

    // 过滤掉只出现一次且值为空的"字段"（通常是开头的引导语，如"名单如下："）
    const keyCount = {};
    matches.forEach((x) => { keyCount[x.key] = (keyCount[x.key] || 0) + 1; });
    const kept = headersAll.filter(
      (h) => !(keyCount[h] === 1 && records.every((r) => !r[h]))
    );

    return {
      headers: kept,
      rows: records.map((r) => kept.map((h) => (h in r ? r[h] : ''))),
      usedHeader: true,
    };
  }

  /* ---------------- 分隔符 / 空白解析 ---------------- */
  const DELIMS = ['\t', ',', '，', '|', '；', ';', '、'];

  function mostCommon(arr) {
    const freq = {};
    let max = 0;
    let val = 0;
    arr.forEach((n) => {
      freq[n] = (freq[n] || 0) + 1;
      if (freq[n] > max) { max = freq[n]; val = n; }
    });
    return val;
  }

  function detectDelimiter(lines) {
    let best = null;
    for (const d of DELIMS) {
      const counts = lines.map((l) => l.split(d).length);
      const withDelim = counts.filter((c) => c > 1);
      if (withDelim.length < Math.max(1, lines.length * 0.6)) continue;
      const mode = mostCommon(withDelim);
      if (mode < 2) continue;
      const consistency = withDelim.filter((c) => c === mode).length / withDelim.length;
      if (consistency < 0.7) continue;
      if (!best || mode > best.cols) best = { delim: d, cols: mode };
    }
    return best;
  }

  function detectHeader(matrix) {
    if (matrix.length < 2) return false;
    // 第一行所有单元格都不含数字，大概率是表头
    return matrix[0].every((c) => c && !/\d/.test(c));
  }

  function guessColumnName(values) {
    const v = values.filter(Boolean);
    if (!v.length) return null;
    const all = (fn) => v.every(fn);
    if (all((x) => /^1[3-9]\d{9}$/.test(x))) return '电话';
    if (all((x) => /^\d{1,3}岁$/.test(x))) return '年龄';
    if (all((x) => /^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?$/.test(x))) return '日期';
    if (all((x) => /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(x))) return '邮箱';
    if (all((x) => /^[¥￥]?\d+(\.\d+)?元?$/.test(x))) return '金额';
    if (all((x) => /^-?\d+(\.\d+)?$/.test(x))) return '数量';
    if (all((x) => /^(男|女)$/.test(x))) return '性别';
    return null;
  }

  function autoHeaders(matrix) {
    const cols = Math.max.apply(null, matrix.map((r) => r.length));
    const names = [];
    for (let c = 0; c < cols; c++) {
      const values = matrix.map((r) => r[c]).filter(Boolean);
      names.push(guessColumnName(values) || ('列' + (c + 1)));
    }
    const seen = {};
    return names.map((h) => {
      seen[h] = (seen[h] || 0) + 1;
      return seen[h] > 1 ? h + seen[h] : h;
    });
  }

  function buildTable(matrix, headerRowFlag, titleRows) {
    const titlesOut = titleRows || [];
    if (!matrix.length) return { headers: [], rows: [], usedHeader: false, titles: titlesOut };
    const cols = Math.max.apply(null, matrix.map((r) => r.length));
    matrix.forEach((r) => { while (r.length < cols) r.push(''); });
    const usedHeader = headerRowFlag !== undefined ? headerRowFlag : detectHeader(matrix);
    let hs;
    let dataRows;
    if (usedHeader) {
      hs = matrix[0].map((h, i) => h || ('列' + (i + 1)));
      dataRows = matrix.slice(1);
    } else {
      hs = autoHeaders(matrix);
      dataRows = matrix;
    }
    return { headers: hs, rows: dataRows, usedHeader, titles: titlesOut };
  }

  function parseDelimited(lines, delim, flag) {
    const matrix = lines.map((l) => l.split(delim).map((c) => c.trim()));
    return buildTable(matrix, flag);
  }

  function parseWhitespaceLines(lines, flag) {
    const multiCount = lines.filter((l) => /\s{2,}|\t/.test(l)).length;
    const re = multiCount >= Math.max(1, lines.length * 0.6) ? /\s{2,}|\t/ : /\s+/;
    const matrix = lines.map((l) =>
      l.split(re).map((c) => c.trim()).filter((c) => c !== '')
    );
    return buildTable(matrix, flag);
  }

  /* ---------------- 智能入口 ---------------- */
  function smartParse(text, modeOverride) {
    const cleaned = text.replace(/\r\n?/g, '\n').trim();
    if (!cleaned) return { headers: [], rows: [], usedHeader: false };
    const lines = cleaned.split('\n').map((l) => l.trim()).filter((l) => l.length);
    const mode = modeOverride || parseMode.value;

    if (mode === 'kv') return parseKeyValue(cleaned);
    if (mode === 'delim') {
      const d0 = detectDelimiter(lines);
      if (d0) return parseDelimited(lines, d0.delim, firstRowHeader.checked);
      return buildTable(lines.map((l) => [l]), false);
    }
    if (mode === 'lines') return parseWhitespaceLines(lines, firstRowHeader.checked);

    // auto：键值对优先，其次分隔符，最后按行拆分
    const kvCount = countKvPairs(cleaned);
    if (kvCount >= 2 && kvCount >= lines.length * 0.6) return parseKeyValue(cleaned);
    const d = detectDelimiter(lines);
    if (d) return parseDelimited(lines, d.delim, undefined);
    return parseWhitespaceLines(lines, undefined);
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    table.innerHTML = '';

    const thead = document.createElement('thead');
    // 表格上方的跨行标题（图片识别时保留），横跨整张表
    titles.forEach((t, ti) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.className = 'title-row';
      th.colSpan = Math.max(1, headers.length);
      const span = document.createElement('span');
      span.className = 'th-text';
      span.textContent = t;
      span.contentEditable = 'true';
      span.spellcheck = false;
      span.addEventListener('input', () => {
        titles[ti] = span.textContent.trim();
      });
      th.appendChild(span);
      tr.appendChild(th);
      thead.appendChild(tr);
    });
    const htr = document.createElement('tr');
    headers.forEach((h, i) => {
      const th = document.createElement('th');
      const span = document.createElement('span');
      span.className = 'th-text';
      span.textContent = h;
      span.contentEditable = 'true';
      span.spellcheck = false;
      span.addEventListener('input', () => {
        headers[i] = span.textContent.trim() || ('列' + (i + 1));
      });
      const del = document.createElement('button');
      del.className = 'del-col';
      del.title = '删除此列';
      del.textContent = '×';
      del.addEventListener('click', () => {
        headers.splice(i, 1);
        rows.forEach((r) => r.splice(i, 1));
        render();
      });
      th.append(span, del);
      htr.appendChild(th);
    });
    const corner = document.createElement('th');
    corner.className = 'op-col';
    htr.appendChild(corner);
    thead.appendChild(htr);

    const tbody = document.createElement('tbody');
    rows.forEach((row, ri) => {
      const tr = document.createElement('tr');
      row.forEach((cell, ci) => {
        const td = document.createElement('td');
        td.contentEditable = 'true';
        td.spellcheck = false;
        td.textContent = cell;
        td.addEventListener('input', () => { rows[ri][ci] = td.textContent; });
        tr.appendChild(td);
      });
      const opTd = document.createElement('td');
      opTd.className = 'op-col';
      const delRow = document.createElement('button');
      delRow.className = 'del-row';
      delRow.title = '删除此行';
      delRow.textContent = '×';
      delRow.addEventListener('click', () => { rows.splice(ri, 1); render(); });
      opTd.appendChild(delRow);
      tr.appendChild(opTd);
      tbody.appendChild(tr);
    });

    table.append(thead, tbody);
    stats.textContent = '共 ' + rows.length + ' 条记录 · ' + headers.length + ' 个字段';
  }

  /* ---------------- 导出 / 复制 ---------------- */
  function cleanCell(c) {
    return String(c).replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
  }

  function allRows() {
    return titles.map((t) => [t]).concat([headers], rows);
  }

  function toTSV() {
    return allRows().map((r) => r.map(cleanCell).join('\t')).join('\n');
  }

  function toCSV() {
    const esc = (c) => {
      c = String(c);
      return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
    };
    // 加 BOM，保证 Excel 打开中文不乱码
    return '﻿' + allRows().map((r) => r.map(esc).join(',')).join('\r\n');
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('已复制，可直接粘贴到 Excel / 飞书表格');
    } catch (e) {
      toast('复制失败，请手动全选表格复制');
    }
    ta.remove();
  }

  function copyTable() {
    const tsv = toTSV();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv)
        .then(() => toast('已复制，可直接粘贴到 Excel / 飞书表格'))
        .catch(() => fallbackCopy(tsv));
    } else {
      fallbackCopy(tsv);
    }
  }

  function downloadCSV() {
    const blob = new Blob([toCSV()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    a.href = URL.createObjectURL(blob);
    a.download = '小宝表格_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
      '_' + pad(d.getHours()) + pad(d.getMinutes()) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    toast('CSV 已导出');
  }

  /* ---------------- 工具 ---------------- */
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function doParse() {
    const text = inputText.value;
    if (!text.trim()) {
      toast('先把文字粘贴进来，再点开始整理');
      inputText.focus();
      return;
    }
    const result = smartParse(text);
    if (!result.headers.length && !result.rows.length) {
      toast('没有识别到有效内容，换个格式试试');
      return;
    }
    headers = result.headers;
    rows = result.rows;
    titles = result.titles || [];
    firstRowHeader.checked = result.usedHeader;
    resultCard.hidden = false;
    render();
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- 文件上传：Word / 文本 / 图片 OCR ---------------- */
  const dropzone = $('dropzone');
  const fileInput = $('fileInput');
  const folderInput = $('folderInput');
  const fileListEl = $('fileList');
  const btnParseFiles = $('btnParseFiles');
  const withSource = $('withSource');

  const IMAGE_RE = /\.(png|jpe?g|webp|bmp)$/i;
  const TEXT_RE = /\.(txt|csv|md)$/i;
  const DOCX_RE = /\.docx$/i;

  let pendingFiles = [];
  let fileStatus = [];
  let ocrWorker = null;
  let ocrLoading = null;
  let ocrProgressCb = null;

  function formatSize(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  function addFiles(list) {
    const files = Array.from(list || []);
    let added = 0;
    const rejected = {};
    files.forEach((f) => {
      const name = f.name;
      if (IMAGE_RE.test(name) || TEXT_RE.test(name) || DOCX_RE.test(name)) {
        if (!pendingFiles.some((p) => p.name === name && p.size === f.size)) {
          pendingFiles.push(f);
          fileStatus.push({ text: '待处理', cls: '' });
          added++;
        }
      } else if (/\.doc$/i.test(name)) {
        rejected.doc = (rejected.doc || 0) + 1;
      } else if (/\.xlsx?$/i.test(name)) {
        rejected.xls = (rejected.xls || 0) + 1;
      } else {
        rejected.other = (rejected.other || 0) + 1;
      }
    });
    const msgs = [];
    if (added) msgs.push('已添加 ' + added + ' 个文件');
    if (rejected.doc) msgs.push(rejected.doc + ' 个旧版 .doc 不支持（请在 Word 里另存为 .docx）');
    if (rejected.xls) msgs.push(rejected.xls + ' 个 Excel 不支持（请另存为 CSV 再上传）');
    if (rejected.other) msgs.push(rejected.other + ' 个格式不支持已跳过');
    if (msgs.length) toast(msgs.join('；'));
    renderFileList();
  }

  function renderFileList() {
    fileListEl.innerHTML = '';
    fileListEl.hidden = !pendingFiles.length;
    pendingFiles.forEach((f, i) => {
      const li = document.createElement('li');
      const nm = document.createElement('span');
      nm.className = 'f-name';
      nm.textContent = f.webkitRelativePath || f.name;
      nm.title = nm.textContent;
      const sz = document.createElement('span');
      sz.className = 'f-size';
      sz.textContent = formatSize(f.size);
      const st = document.createElement('span');
      st.className = 'f-status' + (fileStatus[i].cls ? ' ' + fileStatus[i].cls : '');
      st.textContent = fileStatus[i].text;
      const rm = document.createElement('button');
      rm.className = 'f-remove';
      rm.textContent = '×';
      rm.title = '移除';
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingFiles.splice(i, 1);
        fileStatus.splice(i, 1);
        renderFileList();
      });
      li.append(nm, sz, st, rm);
      fileListEl.appendChild(li);
    });
  }

  function setFileStatus(i, text, cls) {
    fileStatus[i] = { text, cls };
    const li = fileListEl.children[i];
    if (li) {
      const st = li.querySelector('.f-status');
      st.textContent = text;
      st.className = 'f-status' + (cls ? ' ' + cls : '');
    }
  }

  /* ---- docx 解包（docx = zip + xml，用原生 DecompressionStream，零依赖） ---- */
  async function unzip(buf) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('浏览器版本太旧，请用新版 Edge 或 Chrome');
    }
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = dv.byteLength - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('文件损坏或不是有效的 .docx');
    const count = dv.getUint16(eocd + 10, true);
    let offset = dv.getUint32(eocd + 16, true);
    const out = {};
    for (let i = 0; i < count; i++) {
      const method = dv.getUint16(offset + 10, true);
      const compSize = dv.getUint32(offset + 20, true);
      const nameLen = dv.getUint16(offset + 28, true);
      const extraLen = dv.getUint16(offset + 30, true);
      const commentLen = dv.getUint16(offset + 32, true);
      const localOffset = dv.getUint32(offset + 42, true);
      const name = new TextDecoder().decode(new Uint8Array(buf, offset + 46, nameLen));
      const lNameLen = dv.getUint16(localOffset + 26, true);
      const lExtraLen = dv.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const data = new Uint8Array(buf, dataStart, compSize);
      if (method === 0) {
        out[name] = data;
      } else if (method === 8) {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        out[name] = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      offset += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  async function extractDocxText(buf) {
    const files = await unzip(buf);
    const entry = files['word/document.xml'];
    if (!entry) throw new Error('不是标准的 Word 文档');
    const xmlText = new TextDecoder('utf-8').decode(entry);
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('文档 XML 解析失败');
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const textOf = (node) =>
      Array.from(node.getElementsByTagNameNS(ns, 't')).map((t) => t.textContent).join('');
    const lines = [];
    const body = xml.getElementsByTagNameNS(ns, 'body')[0];
    if (!body) throw new Error('文档内容为空');
    Array.from(body.childNodes).forEach((node) => {
      if (node.localName === 'p') {
        const t = textOf(node).trim();
        if (t) lines.push(t);
      } else if (node.localName === 'tbl') {
        Array.from(node.childNodes).forEach((tr) => {
          if (tr.localName !== 'tr') return;
          const cells = Array.from(tr.childNodes)
            .filter((tc) => tc.localName === 'tc')
            .map((tc) => textOf(tc).trim());
          if (cells.some((c) => c)) lines.push(cells.join('\t'));
        });
      }
    });
    if (!lines.length) throw new Error('文档里没有可读文字');
    return lines.join('\n');
  }

  /* ---- 图片 OCR（本地 Tesseract 引擎，不联网） ---- */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('识别引擎文件缺失：' + src));
      document.head.appendChild(s);
    });
  }

  async function getOcrWorker() {
    if (ocrWorker) return ocrWorker;
    if (!ocrLoading) {
      ocrLoading = (async () => {
        if (typeof Tesseract === 'undefined') await loadScript('lib/tesseract.min.js');
        // tesseract.js v5 用 Blob URL 起 worker，相对路径会失效，必须转绝对 URL
        const abs = (p) => new URL(p, location.href).href;
        const worker = await Tesseract.createWorker(['chi_sim', 'eng'], 1, {
          workerPath: abs('lib/worker.min.js'),
          corePath: abs('lib/tesseract-core.wasm.js'),
          langPath: abs('lib/tessdata'),
          gzip: false,
          cacheMethod: 'none',
          logger: (m) => {
            if (!ocrProgressCb) return;
            if (m.status === 'recognizing text') {
              ocrProgressCb('OCR 识别中 ' + Math.round(m.progress * 100) + '%');
            } else {
              ocrProgressCb('加载识别引擎…');
            }
          },
        });
        ocrWorker = worker;
        // 表格图用 PSM 4（单列、可变行高）比默认的自动分区更稳，实测行还原率高
        await worker.setParameters({ tessedit_pageseg_mode: '4' });
        return worker;
      })();
    }
    try {
      await ocrLoading;
    } catch (e) {
      ocrLoading = null;
      throw e;
    }
    return ocrWorker;
  }

  /* 图片预处理：放大 → 灰度 → 擦掉表格线，并返回表格线的坐标。
     表格的黑色边框会被 Tesseract 当成笔画，是这类表格图识别乱码的主因；
     擦掉之后文字行干净，同时留下的线坐标可以精确切分行列。 */
  async function prepareForOcr(file) {
    if (typeof createImageBitmap !== 'function') return { canvas: file, vlines: [], hlines: [] };
    try {
      const bmp = await createImageBitmap(file);
      const MIN_W = 2400;
      const MAX_SCALE = 3.2;
      const scale = bmp.width >= MIN_W ? 1 : Math.min(MAX_SCALE, MIN_W / bmp.width);
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * scale);
      cv.height = Math.round(bmp.height * scale);
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
      if (bmp.close) bmp.close();

      const W = cv.width;
      const H = cv.height;
      const im = ctx.getImageData(0, 0, W, H);
      const d = im.data;
      const gray = new Uint8Array(W * H);
      const rowDark = new Int32Array(H);
      const colDark = new Int32Array(W);
      let minX = W;
      let maxX = -1;
      let minY = H;
      let maxY = -1;
      for (let y = 0, p = 0, q = 0; y < H; y++) {
        for (let x = 0; x < W; x++, p += 4, q++) {
          const g = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0;
          gray[q] = g;
          if (g < 110) {
            rowDark[y]++;
            colDark[x]++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return { canvas: cv, vlines: [], hlines: [] };

      // 整行 / 整列几乎全是黑的，判定为表格线
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const hRaw = [];
      for (let y = 0; y < H; y++) if (rowDark[y] >= bw * 0.55) hRaw.push(y);
      const vRaw = [];
      for (let x = 0; x < W; x++) if (colDark[x] >= bh * 0.55) vRaw.push(x);
      const mergeRuns = (arr) => {
        const out = [];
        let i = 0;
        while (i < arr.length) {
          let j = i;
          while (j + 1 < arr.length && arr[j + 1] - arr[j] <= 3) j++;
          out.push((arr[i] + arr[j]) / 2);
          i = j + 1;
        }
        return out;
      };
      const hlines = mergeRuns(hRaw);
      const vlines = mergeRuns(vRaw);

      // 擦线：只擦线所在的那几行 / 列，文字只损失一条细缝
      hRaw.forEach((y) => { for (let x = 0; x < W; x++) gray[y * W + x] = 255; });
      vRaw.forEach((x) => { for (let y = 0; y < H; y++) gray[y * W + x] = 255; });

      for (let p = 0, q = 0; q < gray.length; p += 4, q++) {
        // 二值化：低分辨率截图的字笔画很淡，二值化后识别率明显提升
        const g = gray[q] < 170 ? 0 : 255;
        d[p] = g;
        d[p + 1] = g;
        d[p + 2] = g;
      }
      ctx.putImageData(im, 0, 0);
      return { canvas: cv, vlines, hlines };
    } catch (e) {
      return { canvas: file, vlines: [], hlines: [] };
    }
  }

  async function ocrImage(file, onProgress) {
    const worker = await getOcrWorker();
    ocrProgressCb = onProgress;
    try {
      const prep = await prepareForOcr(file);
      const result = await worker.recognize(prep.canvas);
      return { data: result.data, grid: prep };
    } finally {
      ocrProgressCb = null;
    }
  }

  /* 用 OCR 结果的坐标把文字块还原成表格行列。
     思路：
     1) 词先按 OCR 文本行分组，再按纵坐标排序；
     2) 列边界取"所有行都没有文字"的纵向空白带 —— 比按空白中点聚类稳得多，
        不会因为某一行日期写得很长就判断不出列；
     3) 跨列的长文本（表标题、"三、岗位加班费："这类分组标题）单独拎出来，不参与列边界计算；
     4) 单元格内折行（OCR 把同一格文字拆成两行）合并回上一行。 */
  function tsvToMatrix(tsv, grid) {
    if (!tsv) return { matrix: [], titles: [], hasHeader: false };

    // ---- 1. 取词（Tesseract TSV：6=left 7=top 8=width 9=height 11=text）----
    const lineMap = {};
    tsv.split('\n').forEach((row) => {
      const c = row.split('\t');
      if (c.length < 12 || c[0] !== '5') return;
      const text = c[11].trim();
      if (!text) return;
      // 表格边框的竖线常被 OCR 当成文字，丢弃纯符号词，否则会阻断列切分
      if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(text)) return;
      const key = c[2] + '-' + c[3] + '-' + c[4];
      (lineMap[key] = lineMap[key] || []).push({
        left: +c[6],
        top: +c[7],
        width: +c[8],
        h: +c[9] || 0,
        text,
      });
    });

    const lines = Object.keys(lineMap)
      .map((k) => {
        const ws = lineMap[k].slice().sort((a, b) => a.left - b.left);
        return { ws, top: Math.min.apply(null, ws.map((w) => w.top)) };
      })
      .filter((l) => l.ws.length)
      .sort((a, b) => a.top - b.top);
    if (!lines.length) return { matrix: [], titles: [], hasHeader: false };

    // ---- 2. 尺度基准：中位字高。保证放大 / 缩小的图判断阈值一致 ----
    const hs = [];
    lines.forEach((l) => l.ws.forEach((w) => { if (w.h > 0) hs.push(w.h); }));
    hs.sort((a, b) => a - b);
    const charH = hs.length ? hs[Math.floor(hs.length / 2)] : 12;

    let X0 = Infinity;
    let X1 = -Infinity;
    let Y0 = Infinity;
    let Y1 = -Infinity;
    lines.forEach((l) => l.ws.forEach((w) => {
      X0 = Math.min(X0, w.left);
      X1 = Math.max(X1, w.left + w.width);
      Y0 = Math.min(Y0, w.top);
      Y1 = Math.max(Y1, w.top + w.h);
    }));
    const tableW = Math.max(1, X1 - X0);

    // 中文之间不留空格，中英文之间留一个空格
    const joinText = (a, b) => {
      if (!a) return b;
      if (!b) return a;
      const cjk = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;
      return cjk.test(a.slice(-1)) || cjk.test(b.charAt(0)) ? a + b : a + ' ' + b;
    };

    // ---- 3. 图上检测到表格线时：直接按线切分行列，最忠实于原图 ----
    if (grid && grid.vlines && grid.hlines &&
        grid.vlines.filter((v) => v > X0 && v < X1).length &&
        grid.hlines.filter((y) => y > Y0 - charH * 2 && y < Y1 + charH * 2).length >= 2) {
      const colEdges = [X0 - charH].concat(
        grid.vlines.filter((v) => v > X0 && v < X1).sort((a, b) => a - b),
        [X1 + charH]
      );
      const hedges = grid.hlines.filter((y) => y > Y0 - charH * 2 && y < Y1 + charH * 2)
        .sort((a, b) => a - b);
      const bands = [];
      for (let i = 0; i < hedges.length - 1; i++) {
        if (hedges[i + 1] - hedges[i] > charH * 0.8) bands.push([hedges[i], hedges[i + 1]]);
      }
      if (bands.length) {
        const cells = bands.map(() => Array(colEdges.length - 1).fill(''));
        const titleWords = [];
        lines.forEach((l) => l.ws.forEach((w) => {
          const cy = w.top + w.h / 2;
          if (cy < hedges[0]) { titleWords.push(w); return; }
          let b = -1;
          for (let i = 0; i < bands.length; i++) {
            if (cy >= bands[i][0] && cy < bands[i][1]) { b = i; break; }
          }
          if (b < 0) return;
          const cx = w.left + w.width / 2;
          let c = 0;
          while (c < colEdges.length - 2 && cx > colEdges[c + 1]) c++;
          cells[b][c] = joinText(cells[b][c], w.text);
        }));

        // 全空列（多半是把某段长文字误当成线）直接去掉
        const useCols = [];
        for (let c = 0; c < colEdges.length - 1; c++) {
          if (cells.some((r) => r[c])) useCols.push(c);
        }
        const rowsOut = cells
          .map((r) => useCols.map((c) => r[c]))
          .filter((r) => r.some((x) => x));
        if (rowsOut.length && useCols.length > 1) {
          let hi = rowsOut.findIndex((r) => r.filter(Boolean).length >= 3);
          if (hi < 0) hi = 0;
          const titlesOut = [];
          if (titleWords.length) {
            // 先按纵坐标聚成行，再按横坐标排词序，避免标题里的词被 OCR 报的 y 抖动打乱
            const tws = titleWords.slice().sort((a, b) => a.top - b.top);
            const tls = [];
            tws.forEach((w) => {
              const last = tls[tls.length - 1];
              if (last && Math.abs(w.top - last.top) < charH * 0.8) last.ws.push(w);
              else tls.push({ top: w.top, ws: [w] });
            });
            const t = tls.map((l) => l.ws.slice().sort((a, b) => a.left - b.left)
              .reduce((s, w) => joinText(s, w.text), '')).join(' ')
              .replace(/["'“”‘’]/g, '').trim();
            if (t) titlesOut.push(t);
          }
          rowsOut.slice(0, hi).forEach((r) => {
            const t = r.reduce((s, c) => joinText(s, c), '').trim();
            if (t) titlesOut.push(t);
          });
          return {
            matrix: rowsOut.slice(hi),
            titles: titlesOut,
            hasHeader: hi >= 0 && useCols.length > 1,
          };
        }
      }
    }

    // ---- 4. 没有表格线（拍照 / 无边框表格）：按文字空白带推断列边界 ----
    const spanOf = (l) => {
      const last = l.ws[l.ws.length - 1];
      return last.left + last.width - l.ws[0].left;
    };
    const maxGapOf = (l) => {
      let g = 0;
      for (let i = 0; i < l.ws.length - 1; i++) {
        g = Math.max(g, l.ws[i + 1].left - (l.ws[i].left + l.ws[i].width));
      }
      return g;
    };
    // 跨列合并行：整行是一段连续文字（表标题），而不是被列间隔切开的多个单元格
    const isMergedLine = (l) => spanOf(l) >= tableW * 0.35 && maxGapOf(l) < charH * 2.5;
    const GAP_MIN = Math.max(4, charH * 0.4);
    const BIN = Math.max(1, Math.round(charH / 3));
    const nB = Math.floor(tableW / BIN);
    const occ = new Int32Array(nB + 2);
    let norm = lines.filter((l) => !isMergedLine(l));
    if (norm.length < 2) norm = lines;
    norm.forEach((l) => {
      l.ws.forEach((w) => {
        const a = Math.max(0, Math.floor((w.left - X0) / BIN));
        const b = Math.min(nB, Math.floor((w.left + w.width - X0) / BIN));
        for (let i = a; i <= b; i++) occ[i]++;
      });
    });

    const cuts = [];
    const minGapW = Math.max(BIN * 2, charH * 0.5);
    let bi = 0;
    while (bi <= nB) {
      if (occ[bi] !== 0) { bi++; continue; }
      let bj = bi;
      while (bj <= nB && occ[bj] === 0) bj++;
      if (bi > 0 && bj <= nB && (bj - bi) * BIN >= minGapW) {
        cuts.push(X0 + ((bi + bj) / 2) * BIN);
      }
      bi = bj;
    }

    const cols = cuts.length + 1;
    const rowObjs = lines.map((l) => {
      if (isMergedLine(l)) {
        return { merged: true, text: l.ws.reduce((s, w) => joinText(s, w.text), '') };
      }
      const cells = Array(cols).fill('');
      l.ws.forEach((w) => {
        const wc = w.left + w.width / 2;
        let col = 0;
        while (col < cuts.length && wc > cuts[col]) col++;
        cells[col] = joinText(cells[col], w.text);
      });
      return { cells, filled: cells.filter((c) => c).length };
    });

    // ---- 5. 单元格内折行：只占 1~2 格、且都在上一行已有内容的列上 → 并回上一行 ----
    const mergedRows = [];
    rowObjs.forEach((r) => {
      if (r.merged) { mergedRows.push(r); return; }
      const prev = mergedRows[mergedRows.length - 1];
      if (prev && !prev.merged && r.filled <= 2 && prev.filled >= 3) {
        const mine = [];
        r.cells.forEach((c, i) => { if (c) mine.push(i); });
        if (mine.length && mine.every((i) => prev.cells[i])) {
          mine.forEach((i) => { prev.cells[i] = joinText(prev.cells[i], r.cells[i]); });
          return;
        }
      }
      mergedRows.push(r);
    });

    // ---- 5. 表头 = 第一个有 3 个以上非空单元格的行；它上面的行都是标题 ----
    const need = Math.min(3, cols);
    let hi = -1;
    for (let i = 0; i < mergedRows.length; i++) {
      if (!mergedRows[i].merged && mergedRows[i].filled >= need) { hi = i; break; }
    }
    const hr = hi >= 0 ? hi : 0;
    const titlesOut = mergedRows.slice(0, hr).map((r) => {
      const t = r.merged ? r.text : r.cells.filter(Boolean).join(' ');
      return t.replace(/["'“”‘’]/g, '').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);

    const matrix = mergedRows.slice(hr).map((r) => {
      if (!r.merged) return r.cells.slice();
      return [r.text].concat(Array(cols - 1).fill(''));
    });

    return { matrix, titles: titlesOut, hasHeader: hi >= 0 && cols > 1 };
  }

  /* ---- 单文件 → 表格，多表合并 ---- */
  async function fileToTable(file, onProgress) {
    const name = file.name;
    if (TEXT_RE.test(name)) {
      const text = await file.text();
      return smartParse(text, 'auto');
    }
    if (DOCX_RE.test(name)) {
      const buf = await file.arrayBuffer();
      const text = await extractDocxText(buf);
      return smartParse(text, 'auto');
    }
    if (IMAGE_RE.test(name)) {
      const ocr = await ocrImage(file, onProgress);
      const m = tsvToMatrix(ocr.data.tsv, ocr.grid);
      const clean = (s) => s.replace(/[|｜]/g, '').trim();
      const matrix = m.matrix
        .map((row) => row.map(clean))
        .filter((row) => row.some((c) => c));
      const titleRows = m.titles.map(clean).filter(Boolean);
      if (matrix.length) return buildTable(matrix, m.hasHeader, titleRows);
      return smartParse(ocr.data.text || '', 'auto');
    }
    throw new Error('不支持的文件格式');
  }

  // OCR 出来的表头常带引号、空格等噪声，归一化后再判断可信度
  function tidyText(s) {
    return String(s)
      .replace(/[|｜]/g, '')
      .replace(/["'“”‘’]/g, '')
      .replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 表头像正常人话（纯中英文 2-10 字）才认为可靠；OCR 噪声表头不可信
  function headerTrusted(headers) {
    return headers.every((h) => /^[\u4e00-\u9fa5A-Za-z]{2,10}$/.test(tidyText(h)));
  }

  function mergeTables(tables, addSource) {
    let headers;
    const rows = [];
    const allTrusted = tables.every((t) => headerTrusted(t.headers));

    if (!allTrusted) {
      // 表头不可信（多来自 OCR）：按列位置对齐，取列数最多的那张做表头基准
      const maxCols = Math.max.apply(null, tables.map((t) => t.headers.length));
      const base = tables.reduce((a, b) => (b.headers.length > a.headers.length ? b : a), tables[0]);
      headers = Array.from({ length: maxCols }, (_, i) => {
        const h = base.headers[i] ? tidyText(base.headers[i]) : '';
        return h || '列' + (i + 1);
      });
      tables.forEach((t) => {
        t.rows.forEach((r) => {
          const row = headers.map((_, i) => (i < r.length ? tidyText(r[i]) : ''));
          if (addSource) row.push(t.source);
          rows.push(row);
        });
      });
      if (addSource) headers.push('来源文件');
      return { headers, rows, titles: tableTitles(tables) };
    }

    // 表头可靠（多为 docx / 文本）：按字段名并集合并
    headers = [];
    tables.forEach((t) =>
      t.headers.forEach((h) => {
        if (!headers.includes(h)) headers.push(h);
      })
    );
    if (addSource) headers.push('来源文件');
    tables.forEach((t) => {
      t.rows.forEach((r) => {
        const row = headers.map((h) => {
          const i = t.headers.indexOf(h);
          return i >= 0 && i < r.length ? r[i] : '';
        });
        if (addSource) row[headers.length - 1] = t.source;
        rows.push(row);
      });
    });
    return { headers, rows, titles: tableTitles(tables) };
  }

  // 只有单张表时保留它的跨行标题，多表合并后标题没有意义
  function tableTitles(tables) {
    return tables.length === 1 ? (tables[0].titles || []) : [];
  }

  async function parseFiles() {
    if (!pendingFiles.length) {
      toast('先把文件拖进来或点「选择文件」');
      return;
    }
    const hasImage = pendingFiles.some((f) => IMAGE_RE.test(f.name));
    if (hasImage && location.protocol === 'file:') {
      toast('图片识别需要本地服务：请双击网站文件夹里的「启动小宝.bat」，在打开的页面里使用');
      return;
    }
    btnParseFiles.disabled = true;
    const tables = [];
    let failed = 0;
    for (let i = 0; i < pendingFiles.length; i++) {
      const f = pendingFiles[i];
      setFileStatus(i, '解析中…', 'working');
      try {
        const t = await fileToTable(f, (msg) => setFileStatus(i, msg, 'working'));
        if (t && t.rows.length && t.headers.length) {
          t.source = f.name;
          tables.push(t);
          setFileStatus(i, '完成 · ' + t.rows.length + ' 条记录', 'done');
        } else {
          failed++;
          setFileStatus(i, '未识别到有效内容', 'fail');
        }
      } catch (e) {
        failed++;
        setFileStatus(i, '失败：' + (e.message || e), 'fail');
      }
    }
    btnParseFiles.disabled = false;
    if (!tables.length) {
      toast('所有文件都没有识别到有效内容');
      return;
    }
    const merged = mergeTables(tables, withSource.checked);
    headers = merged.headers;
    rows = merged.rows;
    titles = merged.titles || [];
    firstRowHeader.checked = true;
    resultCard.hidden = false;
    render();
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (failed) toast(failed + ' 个文件解析失败，可在列表里查看原因');
  }

  /* ---------------- 事件绑定 ---------------- */
  btnParse.addEventListener('click', doParse);
  inputText.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doParse();
  });
  btnSample.addEventListener('click', () => {
    inputText.value = SAMPLE;
    inputText.focus();
  });
  $('btnAddRow').addEventListener('click', () => {
    rows.push(headers.map(() => ''));
    render();
  });
  $('btnAddCol').addEventListener('click', () => {
    headers.push('列' + (headers.length + 1));
    rows.forEach((r) => r.push(''));
    render();
  });
  $('btnCopy').addEventListener('click', copyTable);
  $('btnCsv').addEventListener('click', downloadCSV);
  $('btnClear').addEventListener('click', () => {
    inputText.value = '';
    headers = [];
    rows = [];
    titles = [];
    resultCard.hidden = true;
    inputText.focus();
  });

  /* ---- 文件上传事件 ---- */
  dropzone.addEventListener('click', () => fileInput.click());
  $('btnPickFolder').addEventListener('click', (e) => {
    e.stopPropagation();
    folderInput.click();
  });
  $('btnPickFiles').addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });
  folderInput.addEventListener('change', () => {
    addFiles(folderInput.files);
    folderInput.value = '';
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    addFiles(e.dataTransfer.files);
  });
  btnParseFiles.addEventListener('click', parseFiles);
  $('btnClearFiles').addEventListener('click', () => {
    pendingFiles = [];
    fileStatus = [];
    renderFileList();
  });
})();
