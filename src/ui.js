// UI 逻辑：文件读入 → MD5 校验 → 引擎计算 → 渲染。
// 本文件由 tools/build-ui.mjs 内联进 index.html（file:// 无法用 ES module）；
// 顶层 DOM 绑定带环境守卫，使整包可在 Node 冒烟测试中执行。
'use strict';

function md5(bytes) {
  // 公有领域算法的紧凑实现（Ronald Rivest MD5, RFC 1321）
  function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
  function add(a, b) { return (a + b) | 0; }
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
             5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
             6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;
  const padLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const m = new Uint8Array(padLen);
  m.set(bytes);
  m[bytes.length] = 0x80;
  const bitLen = bytes.length * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(padLen - 8, bitLen >>> 0, true);
  dv.setUint32(padLen - 4, Math.floor(bitLen / 4294967296), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < padLen; off += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = add(add(add(F, A), K[i]), M[g]);
      A = D; D = C; C = B;
      B = add(B, rl(F, S[i]));
    }
    a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
  }
  const out = new DataView(new ArrayBuffer(16));
  out.setInt32(0, a0, true); out.setInt32(4, b0, true); out.setInt32(8, c0, true); out.setInt32(12, d0, true);
  let hex = '';
  for (let i = 0; i < 16; i++) hex += (out.getUint8(i) >> 4).toString(16) + (out.getUint8(i) & 15).toString(16);
  return hex;
}

const SYS_LABELS = [
  ['stb', 'stb（stable / ScoreV1）'],
  ['sv2', 'stb + ScoreV2（MAX=305）'],
  ['lzr', 'lzr（lazer）'],
  ['mc', 'Malody C判（电脑判）'],
  ['mb', 'Malody B判（手机判）'],
];

function fmtAcc(x) { return (x * 100).toFixed(3) + '%'; }

// 核心计算入口（Node 冒烟测试亦调用此函数）
function compute(osuText, osrBytes) {
  const beatmap = parseOsu(osuText);
  const replay = parseOsr(new Uint8Array(osrBytes));
  const base = osrModsInfo(replay.mods);
  // 合并尾块独有 mod（位掩码装不下的 lazer mod，如 DC/DA）
  const active = [...base.active, ...replay.tailModsExtra];
  const mods = {
    ...base,
    active,
    list: active.map(m => m.code),
    blocking: active.filter(m => m.kind === 'ease' || m.kind === 'uncontrollable' || m.kind === 'auto').map(m => m.code),
  };
  const mapMd5 = md5(new TextEncoder().encode(osuText));
  const md5Ok = mapMd5 === replay.beatmapMd5;
  const res = judge(beatmap, replay, mods);
  return { beatmap, replay, mods, mapMd5, md5Ok, ...res };
}

function buildReport(c) {
  const { beatmap, replay, mods, md5Ok, acc, pack, category, courseName, difficulty, seg, sectionStats } = c;
  const lines = [];
  const titleLine = `${beatmap.artist} - ${beatmap.title} [${beatmap.version}]`;
  lines.push(`谱面: ${titleLine}`);
  lines.push(`回放: ${replay.player} @ ${new Date(Number(replay.timestamp / 10000n) - 62135596800000n).toISOString().slice(0, 19).replace('T', ' ')} | mods=[${mods.list.join(',') || '-'}] ${replay.version >= 30000000 ? '(lazer 回放)' : '(stable 回放)'}`);
  lines.push(`MD5 配对: ${md5Ok ? '一致' : '不一致！'} | ${beatmap.keys}K OD${beatmap.od} 物量${beatmap.notes.length}（LN ${beatmap.notes.filter(n => n.ln).length}）`);
  lines.push(`mods: ${mods.active.map(m => `${m.code}·${m.zh}`).join('，') || '无'}`);
  lines.push('');
  lines.push('== 准确率（整体）==');
  for (const [k, label] of SYS_LABELS) lines.push(`  ${label}: ${fmtAcc(acc[k].acc)}`);
  lines.push('');
  lines.push('== 细值（判定区间 ±ms 与计数）==');
  for (const k of detailSystems(pack)) {
    const label = (SYS_LABELS.find(x => x[0] === k) || [k, k])[1];
    const s = c.systems[k];
    const tiers = k.startsWith('m') ? MAL_TIERS : OSU_TIERS;
    lines.push(`  ${label}: ` + tiers.map(([tk, tn]) => `${tn} ±${(+s.windows[tk]).toFixed(1)}ms×${s.counts[tk]}`).join('，'));
  }
  lines.push('');
  lines.push(`== 段位包: ${courseName} | 难度: ${difficulty || '-'} ==`);
  if (pack) {
    const notice = verdictNotice(mods);
    if (notice) {
      lines.push(`  ${notice}`);
    } else {
      for (const t of pack.thresholds) {
        const got = acc[t.sys].acc;
        lines.push(`  ${t.note}: ${fmtAcc(got)} → ${got >= t.min ? 'PASS' : 'FAIL'}`);
      }
    }
  } else {
    lines.push('  非已知段位包：仅输出各判定体系计算值');
  }
  if (seg.split) {
    lines.push('');
    lines.push(`== 分段（空隙 ${seg.gaps.map(g => (g / 1000).toFixed(1) + 's').join(', ')} → ${sectionStats.length} 段）==`);
    for (const [k, label] of SYS_LABELS) {
      const row = sectionStats.map((s, i) => `${fmtAcc(s[k].acc)}(累计${fmtAcc(cumAcc(sectionStats, k, i))})`);
      lines.push(`  ${label}: ${row.join(' | ')}`);
    }
  }
  return lines.join('\n');
}

// 分段累计 acc（sumup）：把截至该段的判定计数合并后按体系公式整体计算
function cumAcc(sectionStats, key, upto) {
  if (key.startsWith('m')) {
    const t = { best: 0, cool: 0, good: 0, miss: 0 };
    for (let i = 0; i <= upto; i++) { const c = sectionStats[i][key].counts; t.best += c.best; t.cool += c.cool; t.good += c.good; t.miss += c.miss; }
    return malodyAcc(t).acc;
  }
  const t = { p: 0, g: 0, gd: 0, ok: 0, meh: 0, miss: 0 };
  for (let i = 0; i <= upto; i++) { const c = sectionStats[i][key].counts; for (const k in t) t[k] += c[k]; }
  return osuAcc(key, t).acc;
}

const OSU_TIERS = [
  ['p', 'MAX / PERFECT'], ['g', '300 / GREAT'], ['gd', '200 / GOOD'],
  ['ok', '100 / OK'], ['meh', '50 / MEH'], ['miss', 'MISS'],
];
const MAL_TIERS = [['best', 'BEST'], ['cool', 'COOL'], ['good', 'GOOD'], ['miss', 'MISS']];

// 细值：段位包 → 门槛相关体系；未分类 → 全部五体系。
// 每个体系给出判定窗口（±ms，随 OD 算出的实际值）与各档计数。
function detailSystems(pack) {
  return pack ? [...new Set(pack.thresholds.map(t => t.sys))] : ['stb', 'sv2', 'lzr', 'mc', 'mb'];
}

function detailCard(c, k) {
  const label = (SYS_LABELS.find(x => x[0] === k) || [k, k])[1];
  const s = c.systems[k];
  const isM = k.startsWith('m');
  const tiers = isM ? MAL_TIERS : OSU_TIERS;
  const rows = tiers.map(([tk, tn]) =>
    `<tr><td>${tn}</td><td class="num">±${(+s.windows[tk]).toFixed(1)} ms</td><td class="num">${s.counts[tk]}</td></tr>`).join('');
  return `<div class="detail-card"><div class="detail-title">${label} <span class="sub">acc ${fmtAcc(c.acc[k].acc)} · ${c.acc[k].n} 判定</span></div>` +
    `<table><tr><th>判定</th><th>窗口</th><th>计数</th></tr>${rows}</table></div>`;
}

// 过段禁用闸：命中降低难度/不可控/自动类 mod 时不提供通过判断（各体系计算值照常输出）
function verdictNotice(mods) {
  if (!mods.blocking.length) return null;
  const parts = mods.blocking.map(code => {
    const m = mods.active.find(x => x.code === code);
    return `${code}（${m ? m.zh.split(' ')[0] : ''}）`;
  });
  return `已使用 ${parts.join('、')}——属降低难度或不可控/自动类 mod，不提供过段判定；各体系计算值不受影响。`;
}

function render(c) {
  const $ = id => document.getElementById(id);
  $('map-info').textContent = `${c.beatmap.artist} - ${c.beatmap.title} [${c.beatmap.version}]`;
  $('map-meta').textContent = `${c.beatmap.keys}K · OD ${c.beatmap.od} · 物量 ${c.beatmap.notes.length}（LN ${c.beatmap.notes.filter(n => n.ln).length}）`;
  $('replay-info').textContent = `${c.replay.player} · mods [${c.mods.list.join(',') || '-'}] · ${c.replay.version >= 30000000 ? 'lazer' : 'stable'} 回放` +
    (c.replay.scoreInfo ? ` · ${c.replay.scoreInfo.client_version}` : '') +
    (c.replay.scoreInfo && Array.isArray(c.replay.scoreInfo.pauses) && c.replay.scoreInfo.pauses.length ? ` · 暂停 ${c.replay.scoreInfo.pauses.length} 次` : '');
  const rateChips = [];
  const rateModUsed = c.mods.active.some(m => ['DT', 'HT', 'NC'].includes(m.code));
  if (c.replay.scoreInfoRate != null && !rateModUsed) {
    rateChips.push(`<span class="mod-chip rate" title="倍率仅记录于 osr 尾块（LegacyReplaySoloScoreInfo），位掩码未含">变速 · 尾块倍率 ${c.replay.scoreInfoRate.toFixed(2)}×</span>`);
  }
  $('mods-line').innerHTML = [
    ...c.mods.active.map(m => {
      let zh = m.zh;
      if (['DT', 'HT', 'NC'].includes(m.code) && c.effectiveRate !== undefined) {
        zh = `${m.zh.split(' ')[0]} · 实测倍率 ${c.effectiveRate.toFixed(2)}×`;
      }
      return `<span class="mod-chip ${m.kind || ''}" title="${zh}">${m.code} · ${zh}</span>`;
    }),
    ...rateChips,
  ].join(' ') || '<span class="mod-chip">无 mod</span>';
  $('md5').textContent = c.md5Ok ? 'MD5 配对一致 ✓' : 'MD5 不一致 ✗（回放与谱面不是同一版本！）';
  $('md5').className = c.md5Ok ? 'ok' : 'bad';

  const accRows = SYS_LABELS.map(([k, label]) =>
    `<tr><td>${label}</td><td class="num">${fmtAcc(c.acc[k].acc)}</td><td class="num">${c.acc[k].n}</td></tr>`).join('');
  $('acc-body').innerHTML = accRows;

  const detailKeys = detailSystems(c.pack);
  $('details').innerHTML = detailKeys.map(k => detailCard(c, k)).join('');

  const emb = c.replay.counts;
  const lz = c.systems.lzr.counts;
  const delta = [lz.p - emb.geki, lz.g - emb.c300, lz.gd - emb.katu, lz.ok - emb.c100, lz.meh - emb.c50, lz.miss - emb.miss];
  $('reconcile').innerHTML =
    `<table><tr><th></th><th>P/MAX</th><th>300</th><th>200</th><th>100</th><th>50</th><th>miss</th></tr>` +
    `<tr><td>lzr 重判</td><td>${lz.p}</td><td>${lz.g}</td><td>${lz.gd}</td><td>${lz.ok}</td><td>${lz.meh}</td><td>${lz.miss}</td></tr>` +
    `<tr><td>osr 内嵌</td><td>${emb.geki}</td><td>${emb.c300}</td><td>${emb.katu}</td><td>${emb.c100}</td><td>${emb.c50}</td><td>${emb.miss}</td></tr>` +
    `<tr><td>Δ</td><td>${delta[0]}</td><td>${delta[1]}</td><td>${delta[2]}</td><td>${delta[3]}</td><td>${delta[4]}</td><td>${delta[5]}</td></tr></table>` +
    `<p class="hint">密集谱存在 ±10ms 级判定时钟/回放时钟量化差，Δ 有小残差属已知局限（见 TASK.md §10）。</p>`;

  $('pack-box').style.display = '';
  $('pack-name').textContent = c.courseName;
  $('pack-diff').textContent = c.difficulty || '-';
  const notice = verdictNotice(c.mods);
  if (!c.pack) {
    $('verdicts').innerHTML = '<p class="hint">非已知段位包：仅输出五体系计算值，无过段判定。</p>';
  } else if (notice) {
    $('verdicts').innerHTML = `<div class="verdict fail">${notice}</div>`;
  } else {
    $('verdicts').innerHTML = c.pack.thresholds.map(t => {
      const got = c.acc[t.sys].acc;
      return `<div class="verdict ${got >= t.min ? 'pass' : 'fail'}">${t.note}：<b>${fmtAcc(got)}</b> → ${got >= t.min ? '通过' : '未通过'}</div>`;
    }).join('');
  }
  $('sections').innerHTML = c.seg.split ? renderSections(c)
    : c.category === 'unknown-regular'
      ? '<p class="hint">无 Course 标识且无显著空隙，不分段。</p>'
      : '<p class="hint">未检测到显著空隙，按该 Course 的单曲处理（不分段）。</p>';
  $('results').style.display = 'block';
  state.lastCompute = c;
}

function sectionHeader(sectionStats) {
  return sectionStats.map((s, i) => `<th>段${i + 1}</th>`).join('');
}

function renderSections(c) {
  const rows = SYS_LABELS.map(([k, label]) =>
    `<tr><td>${label}</td>${c.sectionStats.map((s, i) => {
      const cum = cumAcc(c.sectionStats, k, i);
      return `<td class="num">${fmtAcc(s[k].acc)}<br><span class="sub">累计 ${fmtAcc(cum)}</span></td>`;
    }).join('')}</tr>`).join('');
  return `<table><tr><th>体系</th>${sectionHeader(c.sectionStats)}</tr>${rows}</table>`;
}

const state = { lastCompute: null };

if (typeof document !== 'undefined') {
  let osuFile = null, osrFile = null;

  function tryCompute() {
    if (osuFile && osrFile) {
      Promise.all([osuFile.text(), osrFile.arrayBuffer()]).then(([t, buf]) => {
        render(compute(t, buf));
      }).catch(e => {
        document.getElementById('md5').textContent = '解析失败：' + e.message;
        document.getElementById('md5').className = 'bad';
        document.getElementById('results').style.display = 'block';
      });
    }
  }

  function showFileName(key, file) {
    const el = document.getElementById(key + '-name');
    el.textContent = file ? file.name : '';
    el.title = file ? file.name : '';
  }

  document.getElementById('osu-input').addEventListener('change', e => {
    osuFile = e.target.files[0] || null;
    showFileName('osu', osuFile);
    tryCompute();
  });
  document.getElementById('osr-input').addEventListener('change', e => {
    osrFile = e.target.files[0] || null;
    showFileName('osr', osrFile);
    tryCompute();
  });

  const drop = document.getElementById('dropzone');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    for (const f of e.dataTransfer.files) {
      if (f.name.toLowerCase().endsWith('.osu')) { osuFile = f; showFileName('osu', f); }
      if (f.name.toLowerCase().endsWith('.osr')) { osrFile = f; showFileName('osr', f); }
    }
    tryCompute();
  });

  document.getElementById('copy-text').addEventListener('click', () => {
    if (state.lastCompute) navigator.clipboard.writeText(buildReport(state.lastCompute)).then(
      () => { document.getElementById('copy-text').textContent = '已复制'; },
      () => {});
  });
  document.getElementById('copy-json').addEventListener('click', () => {
    if (!state.lastCompute) return;
    const c = state.lastCompute;
    const out = {
      beatmap: { title: c.beatmap.title, version: c.beatmap.version, keys: c.beatmap.keys, od: c.beatmap.od },
      replay: { player: c.replay.player, mods: c.mods.list },
      md5Ok: c.md5Ok,
      acc: Object.fromEntries(Object.entries(c.acc).map(([k, v]) => [k, +(v.acc * 100).toFixed(4)])),
      course: { category: c.category, name: c.courseName, difficulty: c.difficulty },
      pack: c.pack ? { id: c.pack.id, name: c.pack.name, verdicts: c.pack.thresholds.map(t => ({ note: t.note, acc: +(c.acc[t.sys].acc * 100).toFixed(4), pass: c.acc[t.sys].acc >= t.min })) } : null,
    };
    navigator.clipboard.writeText(JSON.stringify(out, null, 2)).then(
      () => { document.getElementById('copy-json').textContent = '已复制'; },
      () => {});
  });
}
