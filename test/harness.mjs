// 对账 harness：references 七对夹具，lzr 引擎重判计数 vs .osr 内嵌计数。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseOsu } from '../src/osu.js';
import { parseOsr, osrModsInfo } from '../src/osr.js';
import { judge } from '../src/engines.js';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'references');
const files = readdirSync(dir);
const osrFiles = files.filter(f => f.endsWith('.osr'));

let allPass = true;
for (const osrName of osrFiles) {
  const m = osrName.match(/ playing (.+) \(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\)\.osr$/);
  const osuName = m ? m[1] + '.osu' : null;
  const replay = parseOsr(readFileSync(join(dir, osrName)));
  const osuBytes = readFileSync(join(dir, osuName));
  const md5ok = createHash('md5').update(osuBytes).digest('hex') === replay.beatmapMd5;
  const beatmap = parseOsu(osuBytes.toString('utf-8'));
  const mods = osrModsInfo(replay.mods);

  const { systems, acc, seg, effectiveRate, rateFromScoreInfo } = judge(beatmap, replay, mods);
  const lzr = systems.lzr.counts;
  const emb = replay.counts;
  const got = [lzr.p, lzr.g, lzr.gd, lzr.ok, lzr.meh, lzr.miss];
  const want = [emb.geki, emb.c300, emb.katu, emb.c100, emb.c50, emb.miss];
  const pass = got.every((v, i) => v === want[i]);

  console.log(`\n=== ${osuName.slice(0, 60)}`);
  console.log(`  md5=${md5ok ? 'OK' : 'FAIL'} ver=${replay.version}${replay.scoreInfo ? '/' + replay.scoreInfo.client_version : ''} mods=[${mods.list}] rate=${effectiveRate}${rateFromScoreInfo ? '(尾块)' : ''} mirror=${mods.mirror}`);
  console.log(`  lzr  P/G/Gd/Ok/Meh/Miss = ${got.join('/')}  ${pass ? '== 内嵌 PASS' : '!= 内嵌 FAIL'}`);
  if (!pass) console.log(`  内嵌 Geki/300/Katu/100/50/Miss = ${want.join('/')}  Δ=${got.map((v, i) => v - want[i]).join('/')}`);
  console.log(`  acc: stb=${(acc.stb.acc * 100).toFixed(3)}% sv2=${(acc.sv2.acc * 100).toFixed(3)}% lzr=${(acc.lzr.acc * 100).toFixed(3)}% C判=${(acc.mc.acc * 100).toFixed(3)}% B判=${(acc.mb.acc * 100).toFixed(3)}%`);
  console.log(`  分段: ${seg.split ? `${seg.gaps.length + 1}段(${seg.gaps.map(g => (g / 1000).toFixed(1) + 's').join(',')})` : '整谱'}`);
  if (!pass) allPass = false;
}
console.log(`\n${allPass ? '== 全部夹具对账通过 ==' : '== 存在对账失败 =='}`);
