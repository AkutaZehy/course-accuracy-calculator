// 五体系重判引擎：对齐（含 Mirror/变速）→ 判定 → acc/分段/过段。
// 判定语义来源见 TASK.md §2：osu wiki + ppy/osu ManiaHitWindows.cs + 用户定版。

function perfectWindow(od) { return od <= 5 ? 22.4 - 0.6 * od : 24.9 - 1.1 * od; }

// 回放帧时间 = 谱面(track)时间（与倍率无关，实证：对齐恒为恒等映射最优）。
// 倍率来源（优先级）：.osr 尾块 LegacyReplaySoloScoreInfo 的 mods.settings.speed_change
// （官方回放设计，Celestial 实测 0.7 且位掩码为 0）＞ 位掩码默认（DT/NC=1.5、HT=0.75，
// 适用无尾块的 stable 回放）＞ 1。
// 窗口（track 时间）：三套 osu 引擎 ×rate（lazer 源码 speedMultiplier；stable 墙钟固定窗
// 折算到 track 亦为 ×rate）；Malody 用基础值（文章"1.5×速→窗×2/3"为墙钟口径，track 下抵消）。
export function osuWindows(engine, od, rate) {
  const base = {
    p: engine === 'stb' ? 16 : perfectWindow(od),
    g: 64 - 3 * od, gd: 97 - 3 * od, ok: 127 - 3 * od, meh: 151 - 3 * od, miss: 188 - 3 * od,
  };
  const f = x => Math.floor(x * rate) + 0.5;
  return { p: f(base.p), g: f(base.g), gd: f(base.gd), ok: f(base.ok), meh: f(base.meh), miss: f(base.miss) };
}

// Malody V 判定表·Standard 组（2026-10-05 用户提供实测表，萌百 A-E 表整表弃用——其 B/C/D 列实为本表 C/D/E 列错标）：
// 五列 A-EASY 64/104/149/191+ · B-EASY+ 54/94/139/181+ · C-NORMAL 44/84/129/171+ · D-NORMAL+ 36/76/121/163+ · E-HARD 28/68/113/155+
// C判（电脑默认）= C-NORMAL 列，B判（手机默认）= B-EASY+ 列；MISS 带 + 表示至少该宽
export const MALODY_TABLE = {
  C: { best: 44, cool: 84, good: 129, miss: 171 },
  B: { best: 54, cool: 94, good: 139, miss: 181 },
};
export function malodyWindows(level, rate) {
  // Malody 判定窗为墙钟口径（文章：1.5×速→×2/3）；回放是 track 时间，折算后用基础值
  void rate;
  const w = MALODY_TABLE[level];
  return { best: w.best, cool: w.cool, good: w.good, miss: w.miss };
}

function judgeOsuOffset(offset, w) {
  const a = Math.abs(offset);
  if (a <= w.p) return 'p';
  if (a <= w.g) return 'g';
  if (a <= w.gd) return 'gd';
  if (a <= w.ok) return 'ok';
  if (a <= w.meh) return 'meh';
  return 'miss';
}

// lazer 尾判（DrawableHoldNoteTail 语义）：首次落在 ±1.5×miss 内的释放，
// 偏移 /1.5 后按普通窗判定；此前出现过释放（远早于尾）= hold 断裂 → 封顶 MEH；
// 无合格释放 → miss（含持穿后超窗晚释放）。
function tailJudgement(n, w) {
  if (n.press === null || n.relIdx < 0 || !n.rels) return 'miss';
  const tailMiss = 1.5 * w.miss;
  let broken = false;
  for (let i = n.relIdx; i < n.rels.length; i++) {
    const off = n.rels[i] - n.end;
    if (off < -tailMiss) { broken = true; continue; }
    if (off > tailMiss) break;
    let j = judgeOsuOffset(off / 1.5, w);
    if (broken && j !== 'meh' && j !== 'miss') j = 'meh';
    return j;
  }
  return 'miss';
}

// 变速与镜像折算后的 play time 谱面物件（idx = 排序后原谱物件序号）
function prepChart(beatmap, rate, mirror) {
  // 回放 = track 时间，note 不折算；rate 仅影响判定窗口（见 osuWindows）；Mirror 翻转轨道
  void rate;
  return beatmap.notes.map((n, idx) => ({
    idx,
    chartT: n.t,
    col: mirror ? beatmap.keys - 1 - n.col : n.col,
    t: n.t,
    end: n.ln ? n.end : undefined,
    ln: n.ln,
  }));
}

// 每轨对齐，按 lazer OrderedHitPolicy（notelock）语义：
//   note i 的可击范围 = [t_i − miss, min(t_i + miss, t_{i+1}))（下一 note 的开始时间截断；
//   轨内最后一个 note 上界为 t+miss）；press 依序给范围内最早的未判 note；
//   已判 note 的 press 顺延给下一 note（若落其窗内）；无人可击的 press 忽略；
//   未击 note 在 t+miss 自动 miss。LN 头另受"尾部晚窗后不可再起手"守卫。
// LN 尾判按 lazer 源码语义（DrawableHoldNote/OnReleased + DrawableHoldNoteTail）：
//   尾 = 首次"落在 ±1.5×miss 内的释放"的偏移 /1.5 后按普通窗判定；
//   头未中或 body 断裂（释放远早于尾）→ 封顶 MEH；无合格释放 → miss；
//   持穿后晚释放按偏移正常判（不自动 PERFECT）。
function align(alignedNotes, presses, releases, missWin) {
  const cols = new Map();
  for (const n of alignedNotes) {
    if (!cols.has(n.col)) cols.set(n.col, { notes: [], press: [], rel: [] });
    cols.get(n.col).notes.push(n);
  }
  for (const e of presses) { const c = cols.get(e.col); if (c) c.press.push(e.t); }
  for (const e of releases) { const c = cols.get(e.col); if (c) c.rel.push(e.t); }

  for (const { notes, press, rel } of cols.values()) {
    const judged = new Array(notes.length).fill(false);
    const nextStart = notes.map((n, i) => (i + 1 < notes.length ? notes[i + 1].t : Infinity));
    let cursor = 0;
    for (const pt of press) {
      // 推进：已判的、或可击范围已结束的（min(t+miss, next) ≤ pt）不再接收
      while (cursor < notes.length && (judged[cursor] || Math.min(notes[cursor].t + missWin, nextStart[cursor]) <= pt)) cursor++;
      if (cursor >= notes.length) continue;
      // 从 cursor 起找首个未判且 pt ∈ [t−miss, min(t+miss, next)) 的 note
      let j = -1;
      for (let k = cursor; k < notes.length; k++) {
        if (judged[k]) continue;
        if (pt < notes[k].t - missWin) break; // 再往后更晚，窗不可能覆盖
        if (pt >= Math.min(notes[k].t + missWin, nextStart[k])) continue; // 该 note 范围已过但未自动 miss（截断情形），看下一個
        if (notes[k].ln && pt > notes[k].end + 1.5 * missWin) continue; // LN 尾部晚窗守卫
        j = k; break;
      }
      if (j === -1) continue;
      judged[j] = true;
      const n = notes[j];
      n.press = pt;
      if (n.ln) {
        let lo = 0, hi = rel.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (rel[mid] < pt) lo = mid + 1; else hi = mid; }
        n.relIdx = lo;
        n.rels = rel;
        n.release = lo < rel.length ? rel[lo] : null;
      }
    }
  }
  for (const n of alignedNotes) if (n.press === undefined) { n.press = null; n.relIdx = -1; }
}

// —— 判定：每个物件产出 0~2 条判定记录 {idx, slot, j} ——

function judgeOsuSystem(notes, w, engine) {
  const recs = [];
  const push = (idx, slot, j) => recs.push({ idx, slot, j });
  for (const n of notes) {
    if (!n.ln) {
      push(n.idx, 's', n.press === null ? 'miss' : judgeOsuOffset(n.press - n.t, w));
    } else if (engine === 'stb') {
      if (n.press === null) { push(n.idx, 's', 'miss'); continue; }
      const headErr = n.press - n.t;
      const tailErr = n.release - n.end; // 尾偏移锚定 LN 结束时间（曾误锚头时间致全体 MEH，2026-10-05 修复）
      const sumErr = headErr + tailErr; // 头+尾偏移之和（用户定版：合并单判，梯级 ×2.x 即均值口径）
      if (n.release > n.end + w.meh) { push(n.idx, 's', 'miss'); continue; }
      const ladder = [['p', 1.2, 2.4], ['g', 1.1, 2.2], ['gd', 1.0, 2.0], ['ok', 1.0, 2.0]];
      let j = 'meh';
      for (const [name, f1, f2] of ladder) {
        if (Math.abs(headErr) <= f1 * w[name] && Math.abs(sumErr) <= f2 * w[name]) { j = name; break; }
      }
      // 中途弃条封顶 MEH：提前量超过 MEH 窗才算断条（对称于晚松 >end+MEH=miss）；
      // 曾误用 release<end 全判 MEH——把提前 2~139ms 的正常尾判全打成断条（2026-10-05 修复）
      if (n.release < n.end - w.meh) j = 'meh';
      push(n.idx, 's', j);
    } else {
      // sv2 / lzr：头尾独立双判（lazer 源码语义）
      push(n.idx, 'h', n.press === null ? 'miss' : judgeOsuOffset(n.press - n.t, w));
      push(n.idx, 't', tailJudgement(n, w));
    }
  }
  return recs;
}

function judgeMalodySystem(notes, w) {
  const recs = [];
  const judge = off => {
    const a = Math.abs(off);
    if (a <= w.best) return 'best';
    if (a <= w.cool) return 'cool';
    if (a <= w.good) return 'good';
    return 'miss';
  };
  for (const n of notes) {
    if (!n.ln) {
      recs.push({ idx: n.idx, slot: 's', j: n.press === null ? 'miss' : judge(n.press - n.t) });
    } else {
      recs.push({ idx: n.idx, slot: 'h', j: n.press === null ? 'miss' : judge(n.press - n.t) });
      const tj = n.press === null || n.release === null
        ? 'miss'
        : n.release >= n.end ? 'best' : judge(n.release - n.end);
      recs.push({ idx: n.idx, slot: 't', j: tj });
    }
  }
  return recs;
}

export function countOsu(recs) {
  const c = { p: 0, g: 0, gd: 0, ok: 0, meh: 0, miss: 0 };
  for (const r of recs) c[r.j]++;
  return c;
}
export function countMalody(recs) {
  const c = { best: 0, cool: 0, good: 0, miss: 0 };
  for (const r of recs) c[r.j]++;
  return c;
}

export function osuAcc(engine, c) {
  const n = c.p + c.g + c.gd + c.ok + c.meh + c.miss;
  // 权重：stb=ScoreV1（MAX 300）；sv2 与 lzr 同为 ScoreV2 计分（MAX 305——wiki Accuracy 页
  // "ScoreV2 increases the weighting of rainbow 300s to 305"；lazer 源码 ManiaScoreProcessor
  // GetBaseScoreForResult(Perfect)=305，2026-10-05 修正，此前 320 系讹传并无出处）
  const num = engine === 'stb'
    ? 300 * (c.p + c.g) + 200 * c.gd + 100 * c.ok + 50 * c.meh
    : 305 * c.p + 300 * c.g + 200 * c.gd + 100 * c.ok + 50 * c.meh;
  const den = engine === 'stb' ? 300 * n : 305 * n;
  return { n, acc: den ? num / den : 0 };
}

export function malodyAcc(c) {
  const n = c.best + c.cool + c.good + c.miss;
  return { n, acc: n ? (c.best + 0.75 * c.cool + 0.4 * c.good) / n : 0 };
}

// —— 分段（chart time）——
// 已知包固定四曲三空隙：空隙多于 3 处时取**彼此时长最接近**的 3 处（簇选择，并列取四段方差最小）。
// 依据 748 张 course 语料实测（2026-10-03）：同一张图内曲间空隙彼此接近、曲内长 break 偏离该簇
// （FINAL-ETA 曲间 6.2~7.0s vs 曲内 11.0s；REFORM 4th 曲间 4.6~5.3s vs 曲内 10.7~11.6s）；
// 而曲间标称随时包/图在 4.4~19.9s 漂移（LN v2 4.4s、Signicial Theta 18~20s），固定锚点不可行。
// 未知 Course/Unknown Course 曲目数不固定（3/5 首皆可）：全量空隙各切一段。

const GAP_MS = 4000;

function buildSeg(starts, gapIdx) {
  const b = [0, ...gapIdx, starts.length];
  return {
    split: true,
    sections: b.slice(0, -1).map((_, i) => ({ from: b[i], to: b[i + 1] - 1 })),
    gaps: gapIdx.map(g => starts[g] - starts[g - 1]),
  };
}

function findGaps(starts, thresholdMs) {
  const gapIdx = [];
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] - starts[i - 1] > thresholdMs) gapIdx.push(i);
  }
  return gapIdx;
}

function pickCluster3(starts, gapIdx) {
  if (gapIdx.length <= 3) return gapIdx;
  const len = g => starts[g] - starts[g - 1];
  let best = null;
  const rec = (from, chosen) => {
    if (chosen.length === 3) {
      const lens = chosen.map(len);
      const spread = Math.max(...lens) - Math.min(...lens);
      const b = [0, ...chosen, starts.length];
      const spans = [0, 1, 2, 3].map(s => starts[b[s + 1] - 1] - starts[b[s]]);
      const mean = (spans[0] + spans[1] + spans[2] + spans[3]) / 4;
      const varr = spans.reduce((a, x) => a + (x - mean) ** 2, 0);
      if (!best || spread < best.spread || (spread === best.spread && varr < best.varr)) {
        best = { spread, varr, chosen };
      }
      return;
    }
    for (let i = from; i <= gapIdx.length - (3 - chosen.length); i++) rec(i + 1, [...chosen, gapIdx[i]]);
  };
  rec(0, []);
  return best.chosen;
}

export function segment(beatmap, thresholdMs = GAP_MS) {
  const starts = beatmap.notes.map(n => n.t);
  const gapIdx = findGaps(starts, thresholdMs);
  if (!gapIdx.length) return { split: false, sections: [{ from: 0, to: starts.length - 1 }], gaps: [] };
  return buildSeg(starts, gapIdx);
}

// —— 段位包 ——
// name 为展示名；match 收小写化的 title/creator。
// REFORM FINAL 两变体同标题族，按标题 "(ext" 或 mapper CloverWisp 区分（Ext. 须先于 FINAL 判）。

export const PACKS = [
  {
    id: 'malody3', name: 'Malody 4K Dan v3',
    match: t => t.includes('malody 4k regular dan'),
    thresholds: [{ sys: 'mc', min: 0.95, note: 'C判（电脑判）≥95%' }, { sys: 'mb', min: 0.95, note: 'B判（手机判）≥95%' }],
  },
  {
    id: 'reform-ext', name: 'osu!mania 4K Dan ~ REFORM ~ FINAL (Ext.) (CloverWisp)',
    match: (t, c) => t.includes('dan ~ reform') && t.includes('final') && (t.includes('(ext') || c.includes('cloverwisp')),
    thresholds: [{ sys: 'stb', min: 0.96, note: 'REFORM 96%（intro 95%，FINAL 沿用）' }],
  },
  {
    id: 'reform-final', name: 'osu!mania 4K Dan ~ REFORM ~ FINAL (Thaumiel)',
    match: t => t.includes('dan ~ reform') && t.includes('final'),
    thresholds: [{ sys: 'stb', min: 0.96, note: 'REFORM 96%（intro 95%，FINAL 沿用）' }],
  },
  {
    id: 'reform', name: 'osu!mania 4K Dan ~ REFORM (DDMythical)',
    // 含 Thaumiel 等托管的 DDMythical 谱（如 "1st Pack (Thaumiel)"）——发布者≠作者，仍归 DDMythical
    match: t => t.includes('dan ~ reform'),
    thresholds: [{ sys: 'stb', min: 0.96, note: 'REFORM 96%（intro 95%）' }],
  },
  {
    id: 'signicial', name: "osu!mania 4K Dan: Signicial's Courses",
    match: t => t.includes('dan: signicial'),
    thresholds: [{ sys: 'stb', min: 0.96, note: 'Signicial 合格 96%（进阶/精通分档待细化）' }],
  },
  {
    id: 'ln2', name: 'osu!mania 4K LN Dan Courses v2',
    // 弱化：不带 v2 的 "4K LN Dan Courses - EXTRA -" 同门四曲谱（2026-10-03 用户定版）；
    // xfpsb "4K LN Advanced Dan Course Maps" 不含此子串，不受影响
    match: t => t.includes('4k ln dan courses'),
    thresholds: [{ sys: 'sv2', min: 0.97, note: 'LN v2 97%（ScoreV2 口径，2023-01-26 起）' }],
  },
  {
    id: 'celestial', name: 'Dan: Celestial',
    match: t => t.includes('dan: celestial'),
    thresholds: [{ sys: 'stb', min: 0.97, note: 'Celestial stable ≥97%' }, { sys: 'lzr', min: 0.96, note: 'Celestial lazer ≥96%' }],
    diffFromTitle: /dan:\s*celestial\s+-(.+?)-/i, // 全单曲包：难度取自标题（-Ascension I- → Ascension I）
  },
];

export function matchPack(title, creator = '') {
  return PACKS.find(pk => pk.match(title.toLowerCase(), creator.toLowerCase())) || null;
}

// Course 分类（2026-10-03 口径）：
// 已知包 → pack；未知但带 Course 标识（词边界 Course/Dans 且含英文冒号或 ~，Dance 不误中）→ course；
// 无标识但有 >4s 空隙 → unknown-course；两者皆无 → unknown-regular（不分段）。
const COURSE_MARK = /\b(courses?|dans?)\b/i;

export function categorize(title, creator, hasGaps) {
  const pack = matchPack(title, creator);
  if (pack) return { category: 'pack', pack, name: pack.name };
  if (COURSE_MARK.test(title) && /[:~]/.test(title)) {
    return { category: 'course', pack: null, name: 'Course · ' + title.trim() };
  }
  if (hasGaps) return { category: 'unknown-course', pack: null, name: 'Unknown Course' };
  return { category: 'unknown-regular', pack: null, name: 'Unknown Regular' };
}

// 难度名：默认取谱面 [Version]；Celestial 特例从标题取
export function difficultyOf(cat, beatmap) {
  if (cat.pack && cat.pack.diffFromTitle) {
    const m = cat.pack.diffFromTitle.exec(beatmap.title);
    if (m) return m[1].trim();
  }
  return beatmap.version;
}

// 谱面级分类+分段（无需回放）：已知包取彼此最接近的 3 处空隙切四段，未知类按全量空隙，无空隙即单曲
export function classify(beatmap) {
  const starts = beatmap.notes.map(n => n.t);
  const gapIdx = findGaps(starts, GAP_MS);
  const cat = categorize(beatmap.title, beatmap.creator, gapIdx.length > 0);
  const difficulty = difficultyOf(cat, beatmap);
  const seg = !gapIdx.length
    ? { split: false, sections: [{ from: 0, to: starts.length - 1 }], gaps: [] }
    : buildSeg(starts, cat.category === 'pack' ? pickCluster3(starts, gapIdx) : gapIdx);
  return { category: cat.category, pack: cat.pack, courseName: cat.name, difficulty, seg };
}

// —— 主入口 ——

export function judge(beatmap, replay, modsInfo) {
  const mirror = modsInfo.mirror;
  // 倍率：osr 尾块 mods.settings.speed_change（lazer 官方回放设计）优先；
  // 无尾块（stable 回放）按位掩码默认——stable 的 DT/HT 本就是固定 1.5/0.75
  const rate = replay.scoreInfoRate != null ? replay.scoreInfoRate
    : modsInfo.list.includes('NC') || modsInfo.list.includes('DT') ? 1.5
      : modsInfo.list.includes('HT') ? 0.75 : 1;
  const notes = prepChart(beatmap, rate, mirror);
  const wAlign = osuWindows('lzr', beatmap.od, rate); // 最宽 miss 窗做对齐
  align(notes, replay.presses, replay.releases, wAlign.miss);

  const systems = {};
  for (const engine of ['stb', 'sv2', 'lzr']) {
    const w = osuWindows(engine, beatmap.od, rate);
    systems[engine] = { windows: w, recs: judgeOsuSystem(notes, w, engine) };
  }
  for (const lv of ['c', 'b']) {
    const w = malodyWindows(lv.toUpperCase(), rate);
    systems['m' + lv] = { windows: w, recs: judgeMalodySystem(notes, w) };
  }

  const acc = {};
  for (const engine of ['stb', 'sv2', 'lzr']) {
    const c = countOsu(systems[engine].recs);
    systems[engine].counts = c;
    acc[engine] = osuAcc(engine, c);
  }
  for (const lv of ['c', 'b']) {
    const c = countMalody(systems['m' + lv].recs);
    systems['m' + lv].counts = c;
    acc['m' + lv] = malodyAcc(c);
  }

  // 分类与分段：已知包固定四曲（空隙取彼此最接近的 3 处）；未知 Course/Unknown Course 全量空隙切段；
  // 无空隙 = 单曲；Unknown Regular 天然无空隙。
  const { pack, category, courseName, difficulty, seg } = classify(beatmap);
  const sectionStats = [];
  if (seg.split) {
    for (const s of seg.sections) {
      const set = new Set();
      for (let i = s.from; i <= s.to; i++) set.add(i);
      const row = { range: [s.from, s.to] };
      for (const k of Object.keys(systems)) {
        const recs = systems[k].recs.filter(r => set.has(r.idx));
        const c = k.startsWith('m') ? countMalody(recs) : countOsu(recs);
        row[k] = { counts: c, ...(k.startsWith('m') ? malodyAcc(c) : osuAcc(k, c)) };
      }
      sectionStats.push(row);
    }
  }

  return { pack, category, courseName, difficulty, systems, acc, seg, sectionStats, notes, effectiveRate: rate, rateFromScoreInfo: replay.scoreInfoRate != null };
}
