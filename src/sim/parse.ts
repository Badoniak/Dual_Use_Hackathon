// Parsery formatów zapisywanych przez rejestrator symulacji (manifest.json opisuje konwencje).
import type { FramePose, GpsFix, PointCloud, SoundSourceGT, SoundSourceType, Trajectory, WavData } from './types';

export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const header = lines[0].split(',').map(s => s.trim());
  const rows = lines.slice(1).map(l => l.split(','));
  return { header, rows };
}

function col(header: string[], name: string): number {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`Brak kolumny "${name}" w CSV`);
  return i;
}

export function parseTrajectory(text: string): Trajectory {
  const { header, rows } = parseCsv(text);
  const c = ['stamp', 'pos_x', 'pos_y', 'pos_z', 'quat_x', 'quat_y', 'quat_z', 'quat_w'].map(n => col(header, n));
  const n = rows.length;
  const t = new Float64Array(n);
  const pos = new Float32Array(3 * n);
  const quat = new Float32Array(4 * n);
  rows.forEach((r, i) => {
    t[i] = parseFloat(r[c[0]]);
    for (let k = 0; k < 3; k++) pos[3 * i + k] = parseFloat(r[c[1 + k]]);
    for (let k = 0; k < 4; k++) quat[4 * i + k] = parseFloat(r[c[4 + k]]);
  });
  return { t, pos, quat };
}

/** index.csv strumienia: nazwa pliku, stempel i poza ramki w `earth`. */
export function parseFrameIndex(text: string): FramePose[] {
  const { header, rows } = parseCsv(text);
  const [cf, cs, cx, cy, cz, qx, qy, qz, qw] = ['filename', 'stamp', 'pos_x', 'pos_y', 'pos_z', 'quat_x', 'quat_y', 'quat_z', 'quat_w'].map(n => col(header, n));
  return rows
    .filter(r => r[cx] !== '' && r[cx] !== undefined)
    .map(r => ({
      file: r[cf],
      stamp: parseFloat(r[cs]),
      pos: [parseFloat(r[cx]), parseFloat(r[cy]), parseFloat(r[cz])],
      quat: [parseFloat(r[qx]), parseFloat(r[qy]), parseFloat(r[qz]), parseFloat(r[qw])],
    }));
}

export function parseGps(text: string): GpsFix[] {
  const { header, rows } = parseCsv(text);
  const [ct, cla, clo, cal] = ['stamp', 'latitude_deg', 'longitude_deg', 'altitude_m'].map(n => col(header, n));
  return rows.map(r => ({ t: parseFloat(r[ct]), lat: parseFloat(r[cla]), lon: parseFloat(r[clo]), alt: parseFloat(r[cal]) }));
}

/** Binarny PLY (little endian) z polami x y z [red green blue]. */
export function parsePly(buffer: ArrayBuffer): PointCloud {
  const bytes = new Uint8Array(buffer);
  const marker = 'end_header\n';
  let headerEnd = -1;
  const limit = Math.min(bytes.length, 4096);
  let headerText = '';
  for (let i = 0; i < limit; i++) headerText += String.fromCharCode(bytes[i]);
  const idx = headerText.indexOf(marker);
  if (idx < 0) throw new Error('PLY: brak end_header');
  headerEnd = idx + marker.length;
  const lines = headerText.slice(0, idx).split('\n');
  if (!lines.some(l => l.startsWith('format binary_little_endian'))) throw new Error('PLY: obsługiwany jest tylko binary_little_endian');
  let count = 0;
  const props: { name: string; type: string }[] = [];
  let inVertex = false;
  for (const l of lines) {
    const p = l.trim().split(/\s+/);
    if (p[0] === 'element') {
      inVertex = p[1] === 'vertex';
      if (inVertex) count = parseInt(p[2], 10);
    } else if (p[0] === 'property' && inVertex) {
      props.push({ type: p[1], name: p[2] });
    }
  }
  const size: Record<string, number> = { float: 4, float32: 4, double: 8, float64: 8, uchar: 1, uint8: 1, char: 1, int8: 1, short: 2, ushort: 2, int: 4, uint: 4, int32: 4, uint32: 4 };
  const offsets: Record<string, { off: number; type: string }> = {};
  let stride = 0;
  for (const p of props) {
    offsets[p.name] = { off: stride, type: p.type };
    stride += size[p.type] ?? 4;
  }
  const dv = new DataView(buffer, headerEnd);
  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 3);
  const read = (base: number, o: { off: number; type: string }) => {
    switch (o.type) {
      case 'float': case 'float32': return dv.getFloat32(base + o.off, true);
      case 'double': case 'float64': return dv.getFloat64(base + o.off, true);
      case 'uchar': case 'uint8': return dv.getUint8(base + o.off);
      default: return dv.getFloat32(base + o.off, true);
    }
  };
  const ox = offsets.x, oy = offsets.y, oz = offsets.z;
  const or = offsets.red, og = offsets.green, ob = offsets.blue;
  for (let i = 0; i < count; i++) {
    const base = i * stride;
    positions[3 * i] = read(base, ox);
    positions[3 * i + 1] = read(base, oy);
    positions[3 * i + 2] = read(base, oz);
    if (or && og && ob) {
      colors[3 * i] = read(base, or);
      colors[3 * i + 1] = read(base, og);
      colors[3 * i + 2] = read(base, ob);
    } else {
      colors[3 * i] = colors[3 * i + 1] = colors[3 * i + 2] = 200;
    }
  }
  return { positions, colors, count };
}

/** WAV PCM 16 bit. */
export function parseWav(buffer: ArrayBuffer): WavData {
  const dv = new DataView(buffer);
  const tag = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('WAV: zły nagłówek');
  let off = 12;
  let sampleRate = 0, channels = 0, bits = 0;
  let dataOff = -1, dataLen = 0;
  while (off + 8 <= dv.byteLength) {
    const id = tag(off);
    const len = dv.getUint32(off + 4, true);
    if (id === 'fmt ') {
      channels = dv.getUint16(off + 10, true);
      sampleRate = dv.getUint32(off + 12, true);
      bits = dv.getUint16(off + 22, true);
    } else if (id === 'data') {
      dataOff = off + 8;
      dataLen = Math.min(len, dv.byteLength - dataOff);
      break;
    }
    off += 8 + len + (len % 2);
  }
  if (bits !== 16 || dataOff < 0) throw new Error('WAV: obsługiwany jest tylko PCM 16 bit');
  const n = Math.floor(dataLen / 2);
  // dataOff może być nieparzysty — kopiujemy, żeby uzyskać wyrównanie
  const samples = dataOff % 2 === 0 ? new Int16Array(buffer, dataOff, n) : new Int16Array(buffer.slice(dataOff, dataOff + n * 2));
  return { sampleRate, channels, samples, frames: Math.floor(n / channels) };
}

/** Minimalny parser `ground_truth/sound_sources.yaml` (lista `sources:` z polami skalarnymi i xyz). */
export function parseSoundSourcesYaml(text: string): SoundSourceGT[] {
  const out: SoundSourceGT[] = [];
  let cur: Record<string, string> | null = null;
  const flush = () => {
    if (!cur) return;
    const xyz = (cur.xyz ?? '[0,0,0]').replace(/[[\]]/g, '').split(',').map(s => parseFloat(s));
    const num = (k: string) => (cur![k] !== undefined ? parseFloat(cur![k]) : undefined);
    out.push({
      name: cur.name ?? `source_${out.length + 1}`,
      type: (cur.type ?? 'voice') as SoundSourceType,
      xyz: [xyz[0] ?? 0, xyz[1] ?? 0, xyz[2] ?? 0],
      amplitude: num('amplitude') ?? 1,
      f0: num('f0'),
      period: num('period'),
      duration: num('duration'),
    });
    cur = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const m = /^\s*(-\s+)?([A-Za-z_0-9]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[1]) {
      flush();
      cur = {};
    }
    if (cur && m[3] !== '') cur[m[2]] = m[3].trim();
  }
  flush();
  return out;
}
