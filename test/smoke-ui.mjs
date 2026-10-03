// UI 冒烟测试：
// 1. index.html 内嵌脚本可在无 DOM 环境执行（eval 不抛错）；
// 2. bundle 里的 compute() 对夹具输出与 src 模块直算一致，并抽查已知对账数值；
// 3. ui.js 引用的 DOM id 在 index.html 中都存在。
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

// 1+2. 提取 <script> 并在无 document 的沙箱执行
const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
if (!m) throw new Error('index.html 中未找到内嵌脚本');
const ctx = { console, TextEncoder, TextDecoder, navigator: {}, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, clearImmediate };
vm.createContext(ctx);
vm.runInContext(m[1], ctx, { timeout: 30000 });

const dir = join(root, 'references');
const osrFiles = readdirSync(dir).filter(f => f.endsWith('.osr'));

const { parseOsu } = await import('../src/osu.js');
const { parseOsr, osrModsInfo } = await import('../src/osr.js');
const { judge } = await import('../src/engines.js');
const { createHash } = await import('node:crypto');

let cases = 0, fails = 0;
for (const osrName of osrFiles) {
  const mm = osrName.match(/ playing (.+) \((\d{4}-\d{2}-\d{2}_\d{2}-\d{2})\)\.osr$/);
  const osuName = mm[1] + '.osu';
  const osuText = readFileSync(join(dir, osuName), 'utf8');
  const osrBytes = readFileSync(join(dir, osrName));

  // bundle 路径
  const c = vm.runInContext(`compute(${JSON.stringify(osuText)}, new Uint8Array(replayBytes))`,
    Object.assign(ctx, { replayBytes: [...osrBytes] }), { timeout: 60000 });

  // 模块直算路径
  const b = parseOsu(osuText);
  const r = parseOsr(osrBytes);
  const mods = osrModsInfo(r.mods);
  const ref = judge(b, r, mods);

  cases++;
  const same = ['stb', 'sv2', 'lzr', 'mc', 'mb'].every(k =>
    Math.abs(c.acc[k].acc - ref.acc[k].acc) < 1e-12);
  const md5Ok = createHash('md5').update(osuText, 'utf8').digest('hex') === r.beatmapMd5;
  if (!same || c.md5Ok !== md5Ok) { fails++; console.log('不一致:', osuName, 'same=', same); }
  console.log(`${osuName.slice(0, 46)} | md5=${c.md5Ok ? 'OK' : 'BAD'} lzr=${(c.acc.lzr.acc * 100).toFixed(3)}% C判=${(c.acc.mc.acc * 100).toFixed(3)}% B判=${(c.acc.mb.acc * 100).toFixed(3)}% course=${c.courseName}${c.seg.split ? `(${c.sectionStats.length}段)` : '(单曲)'}`);
}

// 抽查已知对账数值（REFORM 夹具，2026-10-03 harness 基线）
{
  const osuText = readFileSync(join(dir, 'Various Artists - Dan ~ REFORM ~ TechMap Pack (yzuio) [Brainfog ~ 5th ~ (Marathon)].osu'), 'utf8');
  const osrPath = readdirSync(dir).find(f => f.endsWith('.osr') && f.includes('REFORM'));
  const c = vm.runInContext(`compute(${JSON.stringify(osuText)}, new Uint8Array(replayBytes))`,
    Object.assign(ctx, { replayBytes: [...readFileSync(join(dir, osrPath))] }), { timeout: 60000 });
  const lz = c.systems.lzr.counts;
  const want = { p: 1056, g: 578, gd: 116, ok: 14, meh: 5, miss: 7 };
  const ok = Object.entries(want).every(([k, v]) => lz[k] === v);
  cases++;
  if (!ok) { fails++; console.log('REFORM 抽查失败:', JSON.stringify(lz), '期望', JSON.stringify(want)); }
  else console.log('REFFORM→REFORM lzr 计数抽查通过');
}

// 3.5 mod 阻断闸断言（纯函数路径：EZ/HT/RAND 阻断，DT/MIRROR 不阻断）
{
  const t = JSON.parse(vm.runInContext(`JSON.stringify({
    ez: osrModsInfo(${1 << 1}).blocking,
    ht: osrModsInfo(${1 << 8}).blocking,
    rand: osrModsInfo(${1 << 21}).blocking,
    nf: osrModsInfo(${1 << 0}).blocking,
    dt: osrModsInfo(${1 << 6}).blocking,
    mirror: osrModsInfo(${1 << 30}).blocking,
    notice: verdictNotice(osrModsInfo(${1 << 1} | ${1 << 6})),
    noNotice: verdictNotice(osrModsInfo(${1 << 6})),
  })`, ctx));
  const ok = t.ez.join() === 'EZ' && t.ht.join() === 'HT' && t.rand.join() === 'RAND' && t.nf.join() === 'NF'
    && t.dt.length === 0 && t.mirror.length === 0 && typeof t.notice === 'string' && t.notice.includes('EZ')
    && t.noNotice === null;
  cases++;
  if (!ok) { fails++; console.log('mod 阻断闸断言失败:', JSON.stringify(t)); }
  else console.log('mod 阻断闸断言通过（EZ/HT/RAND/NF 阻断，DT/MIRROR 放行）');
}

// 3.6 段位包分类断言：FINAL 实谱（Thaumiel，5 段）、JsHs 夹具（未知 Course，3 段）、合成标题匹配
{
  const finalText = readFileSync(join(dir, 'Various Artists - Dan ~ REFORM ~ FINAL ([GB]Thaumiel) [~ FINAL - ETA ~ ( Marathon )].osu'), 'utf8');
  const r = JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const bm = parseOsu(${JSON.stringify(finalText)});
    const cl = classify(bm);
    return {
      final: { id: cl.pack && cl.pack.id, sections: cl.seg.split ? cl.seg.sections.length : 0, gaps: cl.seg.gaps, diff: cl.difficulty },
      synth: {
        extTitle: matchPack('Dan ~ REFORM ~ FINAL (Ext.)', 'CloverWisp').id,
        extCreator: matchPack('Dan ~ REFORM ~ FINAL', 'CloverWisp').id,
        finalOnly: matchPack('Dan ~ REFORM ~ FINAL', 'Thaumiel').id,
        ddmythical: matchPack('Dan ~ REFORM ~ TechMap Pack', 'yzuio').id,
        reform1st: matchPack('Dan ~ REFORM ~ 1st Pack', 'Thaumiel').id,
        dance: matchPack('Dance Dance Revolution', 'x') ? 'hit' : null,
        lnExtra: matchPack('4K LN Dan Courses - EXTRA -', 'x').id,
        xfpsb: matchPack('xfpsb 4K LN Advanced Dan Course Maps: Hybrid', 'x') ? 'hit' : null,
        unknownCourse: categorize('Some Song', '', true).name,
        unknownRegular: categorize('Some Song', '', false).name,
        courseSingle: categorize('Js/Hs Dan ~ Basic Level Pack', 'Glorionoly', false).name,
      },
    };
  })())`, ctx));
  const ok = r.final.id === 'reform-final' && r.final.sections === 4 && r.final.diff === '~ FINAL - ETA ~ ( Marathon )'
    && r.final.gaps.length === 3 && Math.max(...r.final.gaps) < 10000
    && r.synth.extTitle === 'reform-ext' && r.synth.extCreator === 'reform-ext' && r.synth.finalOnly === 'reform-final'
    && r.synth.ddmythical === 'reform' && r.synth.reform1st === 'reform' && r.synth.dance === null
    && r.synth.lnExtra === 'ln2' && r.synth.xfpsb === null
    && r.synth.unknownCourse === 'Unknown Course' && r.synth.unknownRegular === 'Unknown Regular'
    && r.synth.courseSingle === 'Course · Js/Hs Dan ~ Basic Level Pack';
  cases++;
  if (!ok) { fails++; console.log('段位包分类断言失败:', JSON.stringify(r)); }
  else console.log('段位包分类断言通过（FINAL→Thaumiel 簇取3空隙切4段 / 1st Pack 归 DDMythical / EXTRA 入 LN / xfpsb·Dance 不误中）');

  const jOsu = readFileSync(join(dir, 'V.A. - JsHs Dan ~ Basic Level Pack (Glorionoly) [Level 2].osu'), 'utf8');
  const jOsr = readFileSync(join(dir, 'Akuta Zehy playing V.A. - JsHs Dan ~ Basic Level Pack (Glorionoly) [Level 2] (2026-09-26_19-26).osr'));
  const jc = vm.runInContext(`compute(${JSON.stringify(jOsu)}, new Uint8Array(replayBytes))`,
    Object.assign(ctx, { replayBytes: [...jOsr] }), { timeout: 60000 });
  const jok = jc.category === 'course' && jc.courseName === 'Course · Js/Hs Dan ~ Basic Level Pack'
    && jc.difficulty === 'Level 2' && jc.seg.split && jc.sectionStats.length === 3 && !jc.pack;
  cases++;
  if (!jok) { fails++; console.log('JsHs 断言失败:', JSON.stringify({ category: jc.category, courseName: jc.courseName, difficulty: jc.difficulty, sections: jc.sectionStats.length })); }
  else console.log('JsHs 断言通过（未知 Course · 提取名 · Level 2 · 3 段）');
}

// 3.9 DOM id 一致性
{
  const uiSrc = readFileSync(join(root, 'src/ui.js'), 'utf8');
  const ids = new Set([...uiSrc.matchAll(/getElementById\('([^']+)'\)|\$\('([^']+)'\)/g)].map(x => x[1] || x[2]));
  const missing = [...ids].filter(id => !html.includes(`id="${id}"`));
  cases++;
  if (missing.length) { fails++; console.log('缺失 DOM id:', missing); }
  else console.log('DOM id 一致性通过 (' + ids.size + ' 个)');
}

console.log(fails === 0 ? `== UI 冒烟全绿 (${cases} 项) ==` : `== 失败 ${fails}/${cases} ==`);
process.exit(fails === 0 ? 0 : 1);
