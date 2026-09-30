// Przetwarzanie danych z drona zwiadowczego (faza 1) w "stacji naziemnej":
// trajektoria + GPS → georeferencja, lidar → mapa 3D i mapa wysokości, termowizja → tekstura cieplna i klastry,
// mikrofon → zdarzenia akustyczne, fuzja → hot spoty, lidar → miejsca lądowania dronów fazy 2.
import { decode } from 'fast-png';
import { analyzeAudio } from './acoustic';
import { fuseHotspots } from './fusion';
import { fitGpsAnchor, pointInPolygon } from './geo';
import { buildHeightMap, VoxelGrid, type HeightMap } from './grid';
import { findLandingSites } from './landing';
import { parseFrameIndex, parseGps, parsePly, parseSoundSourcesYaml, parseTrajectory, parseWav } from './parse';
import { ThermalMapper, thermalToRgba, ironbow, DEFAULT_THERMAL_PARAMS } from './thermal';
import { RgbdAccumulator, DEFAULT_RGBD_PARAMS, classifyLidar, fallbackRamp, type DecodedImage } from './rgbd';
import type { AcousticEvent, AcousticSource, Bounds2D, Bounds3D, CameraIntrinsics, FramePose, Hotspot, LandingSite, SoundSourceGT } from './types';

export interface DataSource {
  text(path: string): Promise<string>;
  binary(path: string): Promise<ArrayBuffer>;
  /** dekodowanie JPEG/PNG do RGBA (w przeglądarce natywnie; bez niego chmura RGB-D jest szara) */
  decodeImage?(data: ArrayBuffer): Promise<DecodedImage>;
  exists?(path: string): Promise<boolean>;
}

export interface ScoutInput {
  /** wielokąt obszaru w układzie lokalnym (opcjonalnie) — przycina wyświetlaną chmurę i filtruje hotspoty */
  areaLocal?: [number, number][];
  /** margines wokół obszaru dla wyświetlanej chmury [m] */
  margin?: number;
  thermalPixelStep?: number;
}

/** Chmura do wyświetlenia, ułożona blokami: [0, nLidar) — lidar, [nLidar, count) — kamera RGB-D. */
export interface DisplayCloud {
  positions: Float32Array;
  colors: Uint8Array;
  count: number;
  nLidar: number;
}

export interface RasterImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface ScoutResult {
  session: string;
  anchorGps: { lat0: number; lon0: number; residualM: number };
  crop: Bounds3D;
  trajectory: { t: Float64Array; pos: Float32Array };
  tStart: number;
  tEnd: number;
  /** chmura obszaru: [0, nLidar) lidar, dalej kamera RGB-D */
  cloud: { positions: Float32Array; colors: Uint8Array; temps: Float32Array; count: number; nLidar: number };
  heightmap: HeightMap;
  hotspots: Hotspot[];
  landingSites: LandingSite[];
  acousticSources: AcousticSource[];
  acousticZones: AcousticSource[];
  acousticEvents: AcousticEvent[];
  groundTruth: SoundSourceGT[];
  ortho: { bounds: Bounds2D; rgb: RasterImage; thermal: RasterImage };
  thumbnails: Record<string, RasterImage>;
  rgbFrames: { stamp: number; file: string }[];
  stats: {
    points: number;
    lidarPoints: number;
    rgbdPoints: number;
    rgbdFrames: number;
    thermalFrames: number;
    thermalFramesUsed: number;
    raysCast: number;
    audioSeconds: number;
    gpsResidualM: number;
    timingsMs: Record<string, number>;
  };
}

export type ProgressFn = (stage: string, pct: number, message: string) => void;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export async function runScoutPipeline(src: DataSource, input: ScoutInput = {}, progress: ProgressFn = () => {}, onCloud?: (c: DisplayCloud) => void): Promise<ScoutResult> {
  const timings: Record<string, number> = {};
  let t0 = now();
  const lap = (name: string) => { const t = now(); timings[name] = Math.round(t - t0); t0 = t; };
  const margin = input.margin ?? 4;

  progress('telemetria', 2, 'Trajektoria, GPS i manifest sesji');
  const manifest = JSON.parse(await src.text('manifest.json'));
  const tr = parseTrajectory(await src.text(manifest.trajectory ?? 'trajectory.csv'));
  const gps = parseGps(await src.text('gps/gps.csv'));
  const anchorGps = fitGpsAnchor(gps, tr);
  lap('telemetria');

  // obszar przetwarzania: trajektoria + wybrany obszar, z marginesem
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let i = 0; i < tr.t.length; i++) {
    bx0 = Math.min(bx0, tr.pos[3 * i]); bx1 = Math.max(bx1, tr.pos[3 * i]);
    by0 = Math.min(by0, tr.pos[3 * i + 1]); by1 = Math.max(by1, tr.pos[3 * i + 1]);
  }
  const pad = 30;
  if (input.areaLocal) {
    for (const [x, y] of input.areaLocal) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  }
  // ograniczenie rozmiaru (dane z symulacji mają zasięg lidaru ~100 m)
  const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
  const half = 90;
  const crop2: Bounds2D = {
    minX: Math.max(cx - half, bx0 - pad), maxX: Math.min(cx + half, bx1 + pad),
    minY: Math.max(cy - half, by0 - pad), maxY: Math.min(cy + half, by1 + pad),
  };

  progress('lidar', 8, 'Pobieranie chmury punktów (lidar + kamera głębi)');
  const plyName = (manifest.point_cloud_map?.files as string[] | undefined)?.find(f => f.endsWith('.ply')) ?? 'point_cloud_map.ply';
  const pc = parsePly(await src.binary(plyName));
  progress('lidar', 20, `Mapa 3D: ${pc.count.toLocaleString('pl-PL')} punktów`);
  // przycięcie
  let n = 0;
  let zMin = Infinity, zMax = -Infinity;
  const keep = new Uint8Array(pc.count);
  for (let i = 0; i < pc.count; i++) {
    const x = pc.positions[3 * i], y = pc.positions[3 * i + 1], z = pc.positions[3 * i + 2];
    if (x < crop2.minX || x > crop2.maxX || y < crop2.minY || y > crop2.maxY || z > 40 || z < -10) continue;
    keep[i] = 1; n++;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }
  const positions = new Float32Array(3 * n);
  const colors = new Uint8Array(3 * n);
  for (let i = 0, j = 0; i < pc.count; i++) {
    if (!keep[i]) continue;
    positions.set(pc.positions.subarray(3 * i, 3 * i + 3), 3 * j);
    colors.set(pc.colors.subarray(3 * i, 3 * i + 3), 3 * j);
    j++;
  }
  const crop: Bounds3D = { ...crop2, minZ: Math.floor(zMin) - 0.5, maxZ: Math.ceil(zMax) + 0.5 };
  const grid = VoxelGrid.fromPoints(positions, n, crop, 0.25);
  const heightmap = buildHeightMap(positions, n, crop2, 0.25);
  // chmura do wyświetlenia: tylko wybrany obszar (+ margines)
  const area = input.areaLocal;
  const inDisplay = area ? (x: number, y: number) => pointInPolygon(x, y, area) || distToPolygon(x, y, area) <= margin : () => true;
  const dispIdx: number[] = [];
  for (let i = 0; i < n; i++) if (inDisplay(positions[3 * i], positions[3 * i + 1])) dispIdx.push(i);
  lap('lidar');

  // --- kamera głębi RGB-D: własna chmura z map głębi + klatek RGB, rozdzielenie czujników
  progress('rgbd', 22, 'Kamera RGB-D: rekonstrukcja chmury z map głębi');
  const rinfo = JSON.parse(await src.text('rgbd_camera_info/rgbd_camera_info.json'));
  const rIntr: CameraIntrinsics = { width: rinfo.width, height: rinfo.height, fx: rinfo.K[0], fy: rinfo.K[4], cx: rinfo.K[2], cy: rinfo.K[5] };
  const dFrames = parseFrameIndex(await src.text('rgbd_camera_depth/index.csv'));
  // klatki RGB i głębi nie mają identycznych stempli — bierzemy najbliższą klatkę RGB (≤ 0,3 s)
  const rgbIndex = parseFrameIndex(await src.text('rgbd_camera_rgb/index.csv')).sort((a, b) => a.stamp - b.stamp);
  const nearestRgb = (t: number): FramePose[] => {
    let lo = 0, hi = rgbIndex.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rgbIndex[m].stamp <= t) lo = m; else hi = m; }
    return [rgbIndex[lo], rgbIndex[hi]].filter((f, k, a) => f && Math.abs(f.stamp - t) <= 1.2 && a.indexOf(f) === k).sort((a, b) => Math.abs(a.stamp - t) - Math.abs(b.stamp - t));
  };
  const rgbCache = new Map<string, Promise<DecodedImage | null>>();
  const loadRgb = (file: string) => {
    if (!src.decodeImage) return Promise.resolve(null);
    if (!rgbCache.has(file)) rgbCache.set(file, src.binary('rgbd_camera_rgb/' + file).then(b => src.decodeImage!(b)).catch(() => null));
    return rgbCache.get(file)!;
  };
  const depthScale = parseDepthScale(manifest?.conventions?.depth_png) ?? 0.001;
  const acc = new RgbdAccumulator(rIntr, inDisplay, { ...DEFAULT_RGBD_PARAMS, depthScale });
  const rb = 16;
  for (let i = 0; i < dFrames.length; i += rb) {
    const chunk = dFrames.slice(i, i + rb);
    const loaded = await Promise.all(chunk.map(async f => {
      const depth = decode(new Uint8Array(await src.binary('rgbd_camera_depth/' + f.file)));
      const cands = nearestRgb(f.stamp);
      const rgbs = (await Promise.all(cands.map(async c => ({ img: await loadRgb(c.file), pose: c as FramePose | null })))).filter((v): v is { img: DecodedImage; pose: FramePose | null } => v.img !== null);
      return { f, depth, rgbs };
    }));
    for (const { f, depth, rgbs } of loaded) acc.addFrame(f, depth.data as Uint16Array, depth.width, depth.height, rgbs);
    // zdekodowane klatki RGB starsze niż bieżąca paczka nie będą już potrzebne
    for (const k of [...rgbCache.keys()].slice(0, Math.max(0, rgbCache.size - 2 * rb))) rgbCache.delete(k);
    progress('rgbd', 22 + (13 * Math.min(dFrames.length, i + rb)) / dFrames.length, `Kamera RGB-D → mapa 3D: ${Math.min(dFrames.length, i + rb)}/${dFrames.length} klatek`);
  }
  const rg = acc.result();
  const lut = fallbackRamp(pc.positions, pc.colors, pc.count);
  const isLidar = classifyLidar(positions, colors, dispIdx, lut, acc.occupancy());
  let nLidar = 0;
  for (let j = 0; j < dispIdx.length; j++) nLidar += isLidar[j];
  const total = nLidar + rg.count;
  const dPosAll = new Float32Array(3 * total);
  const dColAll = new Uint8Array(3 * total);
  let w = 0;
  dispIdx.forEach((i, j) => {
    if (!isLidar[j]) return;
    dPosAll.set(positions.subarray(3 * i, 3 * i + 3), 3 * w);
    dColAll.set(colors.subarray(3 * i, 3 * i + 3), 3 * w);
    w++;
  });
  dPosAll.set(rg.positions, 3 * nLidar);
  dColAll.set(rg.colors, 3 * nLidar);
  onCloud?.({ positions: dPosAll.slice(), colors: dColAll.slice(), count: total, nLidar });
  lap('rgbd');

  progress('termowizja', 36, 'Pobieranie klatek termowizji');
  const info = JSON.parse(await src.text('thermal_camera_info/thermal_camera_info.json'));
  const intr: CameraIntrinsics = { width: info.width, height: info.height, fx: info.K[0], fy: info.K[4], cx: info.K[2], cy: info.K[5] };
  const frames = parseFrameIndex(await src.text('thermal_camera/index.csv'));
  const scale = parseScale(manifest?.conventions?.thermal_png) ?? 0.01;
  const mapper = new ThermalMapper(grid, intr, { ...DEFAULT_THERMAL_PARAMS, scale, pixelStep: input.thermalPixelStep ?? DEFAULT_THERMAL_PARAMS.pixelStep });
  const pngCache = new Map<string, ArrayBuffer>();
  const batch = 24;
  for (let i = 0; i < frames.length; i += batch) {
    const chunk = frames.slice(i, i + batch);
    const bufs = await Promise.all(chunk.map(f => src.binary('thermal_camera/' + f.file)));
    chunk.forEach((f: FramePose, k) => {
      pngCache.set(f.file, bufs[k]);
      const png = decode(new Uint8Array(bufs[k]));
      mapper.addFrame(f, png.data as Uint16Array);
    });
    progress('termowizja', 36 + (34 * Math.min(frames.length, i + batch)) / frames.length, `Termowizja → mapa 3D: ${Math.min(frames.length, i + batch)}/${frames.length} klatek`);
  }
  const clusters = mapper.clusters();
  const temps = mapper.pointTemperatures(dPosAll, total);
  lap('termowizja');

  progress('akustyka', 72, 'Analiza mikrofonu (STFT, odfiltrowanie wirników)');
  const micIndex = await src.text('microphone/index.csv');
  const micRow = micIndex.split(/\r?\n/)[1]?.split(',') ?? [];
  const wav = parseWav(await src.binary('microphone/' + (micRow[0] || 'microphone.wav')));
  const audio = analyzeAudio(wav, parseFloat(micRow[1] ?? '0') || 0, tr, crop2);
  lap('akustyka');

  progress('fuzja', 86, 'Fuzja termowizji i mikrofonu → potencjalne miejsca osób');
  const inArea = area ? (x: number, y: number) => pointInPolygon(x, y, area) || distToPolygon(x, y, area) < 2 : () => true;
  const fused = fuseHotspots(clusters, { frames: audio.frames, trajectory: tr, sources: audio.sources }, heightmap, inArea, [tr.pos[0], tr.pos[1]], undefined, (x, y, z) => grid.topBelow(x, y, z));
  const landingSites: LandingSite[] = [];
  for (const h of fused.hotspots) if (h.radarCandidate) landingSites.push(...findLandingSites(heightmap, h));
  lap('fuzja');

  progress('podgląd', 93, 'Ortofoto z lidaru i miniatury klatek');
  let groundTruth: SoundSourceGT[] = [];
  try {
    groundTruth = parseSoundSourcesYaml(await src.text('ground_truth/sound_sources.yaml'));
  } catch {
    groundTruth = [];
  }
  let ob = crop2;
  if (area) {
    const xs = area.map(p => p[0]), ys = area.map(p => p[1]);
    ob = { minX: Math.min(...xs) - margin, maxX: Math.max(...xs) + margin, minY: Math.min(...ys) - margin, maxY: Math.max(...ys) + margin };
  }
  const ortho = buildOrtho(dPosAll, dColAll, temps, total, ob, 0.2);
  const thumbnails: Record<string, RasterImage> = {};
  for (const h of fused.hotspots) {
    if (!h.bestFrame || thumbnails[h.bestFrame]) continue;
    const buf = pngCache.get(h.bestFrame);
    if (!buf) continue;
    const png = decode(new Uint8Array(buf));
    thumbnails[h.bestFrame] = downscale(thermalToRgba(png.data as Uint16Array, png.width, png.height, scale), png.width, png.height, 2);
  }
  let rgbFrames: { stamp: number; file: string }[] = [];
  try {
    rgbFrames = parseFrameIndex(await src.text('rgbd_camera_rgb/index.csv')).map(f => ({ stamp: f.stamp, file: f.file }));
  } catch {
    rgbFrames = [];
  }
  lap('podgląd');
  progress('gotowe', 100, `Gotowe: ${fused.hotspots.length} hot spotów, ${landingSites.length} miejsc lądowania`);

  // zdarzenia akustyczne: przerzedzone do mapy słyszalności
  const events = audio.events.filter((_, i) => i % 2 === 0);
  return {
    session: manifest.session ?? 'sesja',
    anchorGps,
    crop,
    trajectory: { t: tr.t, pos: tr.pos },
    tStart: tr.t[0],
    tEnd: tr.t[tr.t.length - 1],
    cloud: { positions: dPosAll, colors: dColAll, temps, count: total, nLidar },
    heightmap,
    hotspots: fused.hotspots,
    landingSites,
    acousticSources: audio.sources,
    acousticZones: fused.acousticZones,
    acousticEvents: events,
    groundTruth,
    ortho,
    thumbnails,
    rgbFrames,
    stats: {
      points: total,
      lidarPoints: nLidar,
      rgbdPoints: rg.count,
      rgbdFrames: acc.frames,
      thermalFrames: frames.length,
      thermalFramesUsed: mapper.framesUsed,
      raysCast: mapper.raysCast,
      audioSeconds: audio.durationS,
      gpsResidualM: anchorGps.residualM,
      timingsMs: timings,
    },
  };
}

function parseDepthScale(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /([0-9.]+)\s*counts per metre/.exec(s);
  return m ? 1 / parseFloat(m[1]) : null;
}

function parseScale(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /([0-9.]+)\s*K per count/.exec(s);
  return m ? parseFloat(m[1]) : null;
}

export function distToPolygon(x: number, y: number, poly: [number, number][]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j], [x2, y2] = poly[i];
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return best;
}

function buildOrtho(pos: Float32Array, col: Uint8Array, temps: Float32Array, n: number, b: Bounds2D, px: number): ScoutResult['ortho'] {
  const w = Math.ceil((b.maxX - b.minX) / px), h = Math.ceil((b.maxY - b.minY) / px);
  const topZ = new Float32Array(w * h).fill(-Infinity);
  const rgb = new Uint8ClampedArray(w * h * 4);
  const th = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < n; i++) {
    const ix = Math.floor((pos[3 * i] - b.minX) / px);
    const iy = h - 1 - Math.floor((pos[3 * i + 1] - b.minY) / px);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
    const k = iy * w + ix;
    const z = pos[3 * i + 2];
    if (z <= topZ[k]) continue;
    topZ[k] = z;
    rgb[4 * k] = col[3 * i]; rgb[4 * k + 1] = col[3 * i + 1]; rgb[4 * k + 2] = col[3 * i + 2]; rgb[4 * k + 3] = 235;
    const T = temps[i];
    if (Number.isNaN(T)) { th[4 * k + 3] = 0; continue; }
    const [r, g, bb] = T >= 330 ? [255, 255, 255] : ironbow((T - 285) / 35);
    th[4 * k] = r; th[4 * k + 1] = g; th[4 * k + 2] = bb; th[4 * k + 3] = 220;
  }
  fillHoles(rgb, w, h);
  fillHoles(th, w, h);
  return { bounds: b, rgb: { width: w, height: h, rgba: rgb }, thermal: { width: w, height: h, rgba: th } };
}

/** Jedno przejście wypełniania pustych pikseli średnią z sąsiadów (rzadkie pierścienie lidaru). */
function fillHoles(img: Uint8ClampedArray, w: number, h: number) {
  const src = img.slice();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = 4 * (y * w + x);
    if (src[k + 3]) continue;
    let n = 0, r = 0, g = 0, b = 0, a = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const q = 4 * ((y + dy) * w + x + dx);
      if (!src[q + 3]) continue;
      n++; r += src[q]; g += src[q + 1]; b += src[q + 2]; a += src[q + 3];
    }
    if (n >= 3) { img[k] = r / n; img[k + 1] = g / n; img[k + 2] = b / n; img[k + 3] = a / n; }
  }
}

function downscale(rgba: Uint8ClampedArray, w: number, h: number, f: number): RasterImage {
  const W = Math.floor(w / f), H = Math.floor(h / f);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = 4 * (y * f * w + x * f), d = 4 * (y * W + x);
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = 255;
  }
  return { width: W, height: H, rgba: out };
}
