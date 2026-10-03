// 构建脚本：把 src/ 模块内联成单文件 index.html（file:// 无法用 ES module，须整体内联）。
// 样式：瑞士风格暗色变体（Swiss Dark）——网格细线、两字重、单强调红、方角平涂；
// 字体 SourceHanSansLite（本地 resources/，离线可用）。
// 运行：node tools/build-ui.mjs；产物 index.html 零依赖，双击即用。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = s => s
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export\s+(const|function|class)/gm, '$1');

const parts = [
  'src/vendor/lzmaD.js',
  'src/osr.js',
  'src/osu.js',
  'src/engines.js',
  'src/ui.js',
].map(f => `// ==== ${f} ====\n` + strip(readFileSync(join(root, f), 'utf8')));

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>course-accuracy-calculator</title>
<style>
  @font-face {
    font-family: 'SourceHanSansLite';
    src: url('resources/SourceHanSansLite.ttf');
    font-weight: 100 1000;
  }
  :root {
    color-scheme: dark;
    --bg: #101113;
    --ink: #e8e8e4;
    --dim: #8a8d92;
    --hair: #26292d;
    --hair-strong: #3a3e44;
    --accent: #da291c;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'SourceHanSansLite', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    font-weight: 400;
    background: var(--bg); color: var(--ink);
    margin: 0; padding: 48px 32px; max-width: 1080px; margin-inline: auto;
    font-size: 16px; line-height: 1.65;
  }
  h1 { font-size: 40px; font-weight: 700; letter-spacing: -0.01em; margin: 0; line-height: 1.2; }
  h1 .sub { font-size: 15px; font-weight: 400; color: var(--dim); margin-left: 14px; letter-spacing: 0.08em; }
  .sec { font-size: 14px; font-weight: 400; color: var(--dim); letter-spacing: 0.18em;
    border-bottom: 1px solid var(--hair-strong); padding-bottom: 7px; margin: 48px 0 16px; }
  .sec b { color: var(--ink); font-weight: 400; margin-right: 10px; }

  #dropzone { border: 1px dashed var(--hair-strong); padding: 28px; text-align: center; margin-top: 20px; }
  #dropzone.over { border-color: var(--accent); }
  #dropzone p { margin: 4px 0; color: var(--dim); }
  /* 竖排：导入长文件名只影响自己的行，不推挤另一项 */
  label.file { display: flex; align-items: baseline; width: fit-content; max-width: 100%;
    margin: 10px auto; padding: 8px 18px; border: 1px solid var(--hair-strong); cursor: pointer; }
  label.file:hover { border-color: var(--ink); }
  label.file input { display: none; }
  label.file span.name { color: var(--dim); margin-left: 10px; font-size: 14px;
    max-width: 34em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  #results { display: none; }
  .meta-line { margin: 3px 0; }
  #md5.ok { color: var(--dim); } #md5.bad { color: var(--accent); font-weight: 700; }

  table { border-collapse: collapse; margin: 12px 0; width: 100%; }
  th { font-weight: 400; font-size: 13px; color: var(--dim); letter-spacing: 0.12em;
    text-align: left; border-bottom: 1px solid var(--hair-strong); padding: 0 14px 7px 0; }
  td { border-bottom: 1px solid var(--hair); padding: 10px 14px 10px 0; vertical-align: top; }
  td.num { font-variant-numeric: tabular-nums; }
  .sub { color: var(--dim); font-size: 14px; }
  .hint { color: var(--dim); font-size: 14px; }

  .mod-chip { display: inline-block; padding: 4px 12px; border: 1px solid var(--hair-strong);
    font-size: 14px; margin: 2px 8px 2px 0; letter-spacing: 0.04em; }
  .mod-chip.ease, .mod-chip.uncontrollable, .mod-chip.auto { border-color: var(--accent); color: #ff6f63; }
  .mod-chip.rate { border-color: var(--hair-strong); color: var(--dim); }

  .detail-card { border: 1px solid var(--hair); padding: 16px 20px; margin: 12px 0; }
  .detail-title { font-weight: 700; margin-bottom: 8px; }

  .verdict { padding: 10px 14px; border: 1px solid var(--hair-strong); margin: 6px 0; }
  .verdict.pass { border-left: 3px solid var(--ink); }
  .verdict.fail { border-left: 3px solid var(--accent); color: var(--ink); }
  .verdict.fail b { color: var(--accent); }
  #pack-name { font-weight: 700; }

  button { background: none; color: var(--ink); border: 1px solid var(--hair-strong);
    padding: 9px 22px; cursor: pointer; margin-right: 10px; font-family: inherit; font-size: 15px; }
  button:hover { background: var(--ink); color: var(--bg); border-color: var(--ink); }
</style>
</head>
<body>
<h1>course-accuracy-calculator<span class="sub">stb / stb-SV2 / lzr / Malody C判 / B判</span></h1>

<div id="dropzone">
  <p>把 <b>.osu 谱面</b> 和 <b>.osr 回放</b> 两个文件拖到这里（或分别选择）</p>
  <label class="file">选择谱面 .osu<span class="name" id="osu-name"></span><input type="file" id="osu-input" accept=".osu"></label>
  <label class="file">选择回放 .osr<span class="name" id="osr-name"></span><input type="file" id="osr-input" accept=".osr"></label>
</div>

<div id="results">
  <div class="sec"><b>01</b>文件</div>
  <p class="meta-line" id="map-info"></p>
  <p class="meta-line" id="map-meta"></p>
  <p class="meta-line" id="replay-info"></p>
  <p class="meta-line" id="mods-line"></p>
  <p class="meta-line" id="md5"></p>

  <div class="sec"><b>02</b>准确率（整谱）</div>
  <table><thead><tr><th>判定体系</th><th>acc</th><th>判定数</th></tr></thead><tbody id="acc-body"></tbody></table>

  <div class="sec"><b>03</b>细值（判定区间与计数）<span class="hint" style="margin-left:12px">段位包按其门槛体系；未分类谱显示全部体系</span></div>
  <div id="details"></div>

  <div class="sec"><b>04</b>lzr 对账（重判 vs 回放内嵌计数）</div>
  <div id="reconcile"></div>

  <div class="sec"><b>05</b>段位判定</div>
  <div id="pack-box">
    <p>段位包：<span id="pack-name"></span></p>
    <p class="meta-line">难度：<span id="pack-diff"></span></p>
    <div id="verdicts"></div>
    <div class="sec"><b>06</b>分段（单曲 / 累计 sumup）</div>
    <div id="sections"></div>
  </div>

  <div class="sec"><b>07</b>导出</div>
  <button id="copy-text">复制文本报告</button>
  <button id="copy-json">复制 JSON</button>
</div>

<script>
${parts.join('\n\n')}
</script>
</body>
</html>
`;

writeFileSync(join(root, 'index.html'), html);
console.log('index.html written:', html.length, 'bytes');
