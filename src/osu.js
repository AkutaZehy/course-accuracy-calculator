// .osu 谱面解析：元数据 + mania 物件（列号、LN 起止）。
export function parseOsu(text) {
  const meta = {};
  const notes = [];
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('//')) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) { section = m[1]; continue; }
    if (section === 'HitObjects') {
      const parts = line.split(',');
      if (parts.length < 4) continue;
      const x = +parts[0], t = Math.round(+parts[2]), type = +parts[3];
      if (!Number.isFinite(t) || !Number.isFinite(type)) continue;
      if (type & 128) {
        const end = Math.round(+parts[5].split(':')[0]);
        notes.push({ x, t, end, ln: true });
      } else {
        notes.push({ x, t, ln: false });
      }
    } else if (section === 'Metadata' || section === 'Difficulty') {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  const keys = Math.round(+meta.CircleSize || 4);
  for (const n of notes) n.col = Math.min(keys - 1, Math.max(0, Math.floor(n.x * keys / 512)));
  notes.sort((a, b) => a.t - b.t);
  return {
    title: meta.Title || '',
    titleUnicode: meta.TitleUnicode || '',
    artist: meta.Artist || '',
    creator: meta.Creator || '',
    version: meta.Version || '',
    tags: (meta.Tags || '').toLowerCase(),
    mode: +(meta.Mode || 0),
    keys,
    od: +meta.OverallDifficulty || 0,
    beatmapId: +(meta.BeatmapID || 0),
    setId: +(meta.BeatmapSetID || 0),
    notes,
  };
}
