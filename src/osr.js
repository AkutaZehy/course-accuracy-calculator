// .osr 回放解析：头部字段 + LZMA 解压 + 帧序列 → 每轨按下/松键事件。
import { LZMA_DECOMP } from './vendor/lzmaD.js';

function lzmaDecompress(bytes) {
  const r = LZMA_DECOMP.decompress(bytes); // 同步模式（无回调）
  if (r instanceof Uint8Array) return r;
  if (typeof r === 'string') {
    const u = new Uint8Array(r.length);
    for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i) & 0xFF;
    return u;
  }
  return Uint8Array.from(r);
}

export function parseOsr(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 0;
  const u8r = () => u8[p++];
  const i16r = () => { const v = dv.getInt16(p, true); p += 2; return v; };
  const i32r = () => { const v = dv.getInt32(p, true); p += 4; return v; };
  const u32r = () => { const v = dv.getUint32(p, true); p += 4; return v; };
  const i64r = () => { const lo = dv.getUint32(p, true), hi = dv.getInt32(p + 4, true); p += 8; return (BigInt(hi) << 32n) | BigInt(lo >>> 0); };
  const td = new TextDecoder();
  function str() {
    const flag = u8r();
    if (flag === 0) return '';
    if (flag !== 0x0b) throw new Error(`bad string flag 0x${flag.toString(16)} @${p - 1}`);
    let len = 0, shift = 0;
    for (;;) { const b = u8r(); len |= (b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7; }
    const s = td.decode(u8.subarray(p, p + len)); p += len; return s;
  }

  const mode = u8r();
  const version = i32r();
  const beatmapMd5 = str();
  const player = str();
  const replayMd5 = str();
  const c300 = i16r(), c100 = i16r(), c50 = i16r(), geki = i16r(), katu = i16r(), miss = i16r();
  const score = i32r();
  const maxCombo = i16r();
  const perfect = u8r();
  const mods = u32r();
  const lifebar = str();
  const timestamp = i64r();
  const lzmaLen = i32r();
  const lzmaBytes = u8.subarray(p, p + lzmaLen); p += lzmaLen;
  const onlineId = i64r();

  // lazer 追加块（version ≥ 30000001）：4 字节长度前缀 + LZMA(LegacyReplaySoloScoreInfo JSON)
  // —— 官方回放设计：游戏本体从这里恢复 mod 设置（含变速 mod 的自定义倍率）、
  //    判定统计、暂停时间戳、rank 等经典字段装不下的信息。见 ppy/osu LegacyScoreDecoder。
  let scoreInfo = null;
  if (p + 4 <= u8.length) {
    const infoLen = dv.getUint32(p, true); p += 4;
    if (infoLen > 0 && p + infoLen <= u8.length) {
      try {
        scoreInfo = JSON.parse(new TextDecoder().decode(lzmaDecompress(u8.subarray(p, p + infoLen))));
      } catch { /* 非 lazer 尾块或损坏：忽略 */ }
    }
  }
  // 变速倍率：尾块 mods 优先（settings.speed_change；无 settings = 该 mod 默认倍率——
  // DC 默认 0.75）；位掩码不可靠（DC 等 lazer 独有 mod 不映射 legacy 位，Reg-10 实证）
  const RATE_MOD_DEFAULT = { DT: 1.5, NC: 1.5, HT: 0.75, DC: 0.75 };
  let scoreInfoRate = null;
  if (scoreInfo && Array.isArray(scoreInfo.mods)) {
    for (const m of scoreInfo.mods) {
      if (RATE_MOD_DEFAULT[m.acronym] === undefined) continue;
      const s = m.settings || {};
      const key = Object.keys(s).find(k => /speed/i.test(k));
      scoreInfoRate = (key && typeof s[key] === 'number' && s[key] > 0) ? s[key] : RATE_MOD_DEFAULT[m.acronym];
      break;
    }
  }
  // 尾块中位掩码未覆盖的 mod（lazer 独有，legacy 位装不下）
  const TAIL_MOD_INFO = {
    DC: { zh: 'Daycore 减速', kind: 'ease' },
    DA: { zh: 'DifficultyAdjust 调整 HP/OD', kind: 'adjust' },
  };
  const bitHas = code => {
    const map = { DT: 1 << 6, HT: 1 << 8, NC: 1 << 9, MIRROR: 1 << 30 };
    return map[code] !== undefined && (mods & map[code]) !== 0;
  };
  const tailModsExtra = [];
  if (scoreInfo && Array.isArray(scoreInfo.mods)) {
    for (const m of scoreInfo.mods) {
      const code = m.acronym;
      if (bitHas(code) || (code === 'MR' && (mods & (1 << 30)))) continue;
      const info = TAIL_MOD_INFO[code] || { zh: code, kind: null };
      tailModsExtra.push({ code, zh: info.zh, kind: info.kind, settings: m.settings || null });
    }
  }

  const raw = lzmaDecompress(lzmaBytes);
  // 解压后为逗号分隔文本帧："w|x|y|z,…"；mania 的按键位掩码在 x 字段（z 恒 0）
  const text = new TextDecoder().decode(raw);
  let t = 0, prevKeys = 0;
  const frames = [];
  const presses = [];
  const releases = [];
  const MAX_COLS = 10;
  for (const fs of text.split(',')) {
    const parts = fs.split('|');
    if (parts.length < 4) continue;
    const w = Number(parts[0]);
    if (!Number.isFinite(w)) continue;
    if (w === -12345) break;
    t += w;
    const keys = Number(parts[1]) | 0;
    frames.push({ t, keys });
    for (let c = 0; c < MAX_COLS; c++) {
      const now = (keys >> c) & 1, was = (prevKeys >> c) & 1;
      if (now && !was) presses.push({ t, col: c });
      else if (!now && was) releases.push({ t, col: c });
    }
    prevKeys = keys;
  }
  return {
    mode, version, beatmapMd5, player, replayMd5,
    counts: { c300, c100, c50, geki, katu, miss },
    score, maxCombo, perfect, mods, lifebar, timestamp, onlineId,
    scoreInfo, scoreInfoRate, tailModsExtra,
    frames, presses, releases,
  };
}

// mod 释义表（仅收录 osu!mania 中实际存在的 mod；TD/Relax/SpunOut/Autopilot 等
// 非 mania mod 不在表内，位掩码命中也不会显示）。
// kind：ease=降低难度、uncontrollable=不可控、auto=自动演奏、rate=变速（非降难）
const MOD_INFO = {
  NF: { bit: 1 << 0, zh: 'NoFail 免死', kind: 'ease' },
  EZ: { bit: 1 << 1, zh: 'Easy 降低 HP/OD', kind: 'ease' },
  HD: { bit: 1 << 3, zh: 'Hidden' },
  HR: { bit: 1 << 4, zh: 'HardRock' },
  SD: { bit: 1 << 5, zh: 'SuddenDeath' },
  DT: { bit: 1 << 6, zh: 'DoubleTime 1.5×加速', kind: 'rate' },
  HT: { bit: 1 << 8, zh: 'HalfTime/Daycore 0.75×减速', kind: 'ease' },
  NC: { bit: 1 << 9, zh: 'NightCore 1.5×加速', kind: 'rate' },
  FL: { bit: 1 << 10, zh: 'Flashlight' },
  AT: { bit: 1 << 11, zh: 'Auto 自动演奏', kind: 'auto' },
  PF: { bit: 1 << 14, zh: 'Perfect' },
  K4: { bit: 1 << 15, zh: 'Key4' },
  K5: { bit: 1 << 16, zh: 'Key5' },
  K6: { bit: 1 << 17, zh: 'Key6' },
  K7: { bit: 1 << 18, zh: 'Key7' },
  K8: { bit: 1 << 19, zh: 'Key8' },
  FI: { bit: 1 << 20, zh: 'FadeIn' },
  RAND: { bit: 1 << 21, zh: 'Random 随机化排列', kind: 'uncontrollable' },
  MIRROR: { bit: 1 << 30, zh: 'Mirror 镜像' },
};

export function osrModsInfo(mods) {
  const active = Object.entries(MOD_INFO)
    .filter(([, m]) => (mods & m.bit) === m.bit)
    .map(([code, m]) => ({ code, zh: m.zh, kind: m.kind || null }))
    .filter(m => !(m.code === 'DT' && (mods & MOD_INFO.NC.bit))); // NC 位蕴含 DT 位
  const rate = (mods & (MOD_INFO.DT.bit | MOD_INFO.NC.bit)) ? 1.5 : (mods & MOD_INFO.HT.bit) ? 0.75 : 1;
  const mirror = !!(mods & MOD_INFO.MIRROR.bit);
  const blocking = active
    .filter(m => m.kind === 'ease' || m.kind === 'uncontrollable' || m.kind === 'auto')
    .map(m => m.code);
  return { list: active.map(m => m.code), active, rate, mirror, blocking };
}
