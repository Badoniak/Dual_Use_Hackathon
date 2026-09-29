// Rozdzielenie czujników mapy 3D: lidar vs kamera głębi RGB-D.
//
// Scalona mapa z sesji (point_cloud_map.ply) nie ma znacznika źródła punktu, ale manifest opisuje kolory:
//  • chmury z kamery RGB-D mają własny kolor,
//  • punkty lidaru widoczne w kamerze kolorowej dostają kolor z rzutu,
//  • pozostałe punkty lidaru — kolor zapasowy: rampa wysokości 0–12 m.
// Warstwę RGB-D odtwarzamy więc bezpośrednio z surowych map głębi i klatek RGB (z pozami kamery),
// a do warstwy lidaru trafiają punkty z rampą oraz punkty z kolorem kamery, których nie tłumaczy rekonstrukcja RGB-D.
import type { CameraIntrinsics, FramePose } from './types';
import { quatToMatrix } from './thermal';

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA */
  data: Uint8Array | Uint8ClampedArray;
}

export interface RgbdParams {
  /** co ile pikseli mapy głębi */
  step: number;
  /** rozmiar woksela chmury RGB-D [m] */
  voxel: number;
  minDepth: number;
  maxDepth: number;
  /** skala PNG głębi → metry (manifest: 1000 jednostek na metr) */
  depthScale: number;
}

export const DEFAULT_RGBD_PARAMS: RgbdParams = { step: 3, voxel: 0.05, minDepth: 0.2, maxDepth: 12, depthScale: 0.001 };

const OFF = 32768;
const vkey = (x: number, y: number, z: number, s: number) =>
  ((Math.floor(x / s) + OFF) * 65536 + (Math.floor(y / s) + OFF)) * 4096 + (Math.floor(z / s) + 2048);

/** Akumulacja chmury RGB-D z kolejnych klatek (głębia wzdłuż osi optycznej, rama linku: x przód, y lewo, z góra). */
export class RgbdAccumulator {
  private seen = new Map<number, number>();
  private pos: Float32Array = new Float32Array(3 * 65536);
  private col: Uint8Array = new Uint8Array(3 * 65536);
  count = 0;
  frames = 0;
  rawPoints = 0;
  private intr: CameraIntrinsics;
  private inside: (x: number, y: number) => boolean;
  private p: RgbdParams;

  constructor(intr: CameraIntrinsics, inside: (x: number, y: number) => boolean, p: RgbdParams = DEFAULT_RGBD_PARAMS) {
    this.intr = intr;
    this.inside = inside;
    this.p = p;
  }

  private push(x: number, y: number, z: number, r: number, g: number, b: number) {
    if (this.count * 3 + 3 > this.pos.length) {
      const np = new Float32Array(this.pos.length * 2); np.set(this.pos); this.pos = np;
      const nc = new Uint8Array(this.col.length * 2); nc.set(this.col); this.col = nc;
    }
    const i = 3 * this.count++;
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
    this.col[i] = r; this.col[i + 1] = g; this.col[i + 2] = b;
  }

  /**
   * `rgbPose` — poza kamery w chwili klatki RGB (strumienie głębi i koloru mają różne stemple;
   * punkt 3D jest rzutowany do klatki koloru z jej własną pozą).
   */
  addFrame(pose: FramePose, depth: Uint16Array | Uint8Array, dw: number, dh: number, rgbs: { img: DecodedImage; pose: FramePose | null }[] = []): void {
    const { fx, fy, cx, cy } = this.intr;
    const R = quatToMatrix(pose.quat);
    const [px, py, pz] = pose.pos;
    const { step, voxel, minDepth, maxDepth, depthScale } = this.p;
    const views = rgbs.map(v => ({ img: v.img, R: v.pose ? quatToMatrix(v.pose.quat) : null, t: v.pose ? v.pose.pos : [0, 0, 0], sx: v.img.width / dw, sy: v.img.height / dh }));
    this.frames++;
    for (let v = 0; v < dh; v += step) {
      for (let u = 0; u < dw; u += step) {
        const d = depth[v * dw + u] * depthScale;
        if (d < minDepth || d > maxDepth) continue;
        this.rawPoints++;
        const lx = d, ly = -((u - cx) / fx) * d, lz = -((v - cy) / fy) * d;
        const x = R[0] * lx + R[1] * ly + R[2] * lz + px;
        const y = R[3] * lx + R[4] * ly + R[5] * lz + py;
        const z = R[6] * lx + R[7] * ly + R[8] * lz + pz;
        if (!this.inside(x, y)) continue;
        const k = vkey(x, y, z, voxel);
        if (this.seen.has(k)) continue;
        this.seen.set(k, this.count);
        let r = 170, g = 170, b = 170;
        // kolejne klatki RGB (najbliższa w czasie pierwsza); punkt rzutowany z pozą danej klatki
        for (const w of views) {
          let cu = u * w.sx, cv = v * w.sy;
          if (w.R) {
            const Rc = w.R;
            const ex = x - w.t[0], ey = y - w.t[1], ez = z - w.t[2];
            const cxl = Rc[0] * ex + Rc[3] * ey + Rc[6] * ez;
            const cyl = Rc[1] * ex + Rc[4] * ey + Rc[7] * ez;
            const czl = Rc[2] * ex + Rc[5] * ey + Rc[8] * ez;
            cu = cxl > 0.05 ? (cx - (fx * cyl) / cxl) * w.sx : -1;
            cv = cxl > 0.05 ? (cy - (fy * czl) / cxl) * w.sy : -1;
          }
          if (cu >= 0 && cv >= 0 && cu < w.img.width && cv < w.img.height) {
            const q = 4 * (Math.floor(cv) * w.img.width + Math.floor(cu));
            r = w.img.data[q]; g = w.img.data[q + 1]; b = w.img.data[q + 2];
            break;
          }
        }
        this.push(x, y, z, r, g, b);
      }
    }
  }

  result(): { positions: Float32Array; colors: Uint8Array; count: number } {
    return { positions: this.pos.slice(0, 3 * this.count), colors: this.col.slice(0, 3 * this.count), count: this.count };
  }

  /** Zbiór wokseli 0,1 m zajętych przez RGB-D (do klasyfikacji punktów scalonej mapy). */
  occupancy(size = 0.1): Set<number> {
    const s = new Set<number>();
    for (let i = 0; i < this.count; i++) s.add(vkey(this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2], size));
    return s;
  }
}

/**
 * Rampa kolorów zapasowych (kolor w funkcji wysokości 0–12 m, co 1 cm) odtworzona z danych:
 * dla każdego przedziału wysokości dominujący kolor.
 */
export function fallbackRamp(positions: Float32Array, colors: Uint8Array, count: number, zMax = 12): Uint8Array {
  const nb = Math.round(zMax * 100) + 1;
  const counts: Map<number, number>[] = Array.from({ length: nb }, () => new Map());
  for (let i = 0; i < count; i++) {
    const b = Math.round(Math.min(zMax, Math.max(0, positions[3 * i + 2])) * 100);
    const key = (colors[3 * i] << 16) | (colors[3 * i + 1] << 8) | colors[3 * i + 2];
    const m = counts[b];
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  const lut = new Uint8Array(nb * 3);
  const have: boolean[] = new Array(nb).fill(false);
  for (let b = 0; b < nb; b++) {
    let best = -1, bk = 0;
    for (const [k, n] of counts[b]) if (n > best) { best = n; bk = k; }
    if (best >= 3) { lut[3 * b] = bk >> 16; lut[3 * b + 1] = (bk >> 8) & 255; lut[3 * b + 2] = bk & 255; have[b] = true; }
  }
  // uzupełnienie brakujących przedziałów interpolacją
  let prev = -1;
  for (let b = 0; b < nb; b++) {
    if (!have[b]) continue;
    if (prev >= 0 && b - prev > 1) for (let q = prev + 1; q < b; q++) for (let c = 0; c < 3; c++) lut[3 * q + c] = Math.round(lut[3 * prev + c] + ((lut[3 * b + c] - lut[3 * prev + c]) * (q - prev)) / (b - prev));
    prev = b;
  }
  return lut;
}

/** 1 = punkt lidaru, 0 = punkt z kamery RGB-D (odtworzony osobno z map głębi). */
export function classifyLidar(positions: Float32Array, colors: Uint8Array, idx: ArrayLike<number>, lut: Uint8Array, rgbdOcc: Set<number>, zMax = 12, size = 0.1): Uint8Array {
  const nb = lut.length / 3;
  const out = new Uint8Array(idx.length);
  for (let j = 0; j < idx.length; j++) {
    const i = idx[j];
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    const b = Math.round(Math.min(zMax, Math.max(0, z)) * 100);
    let ramp = false;
    for (let db = -2; db <= 2 && !ramp; db++) {
      const q = 3 * Math.min(nb - 1, Math.max(0, b + db));
      ramp = Math.abs(colors[3 * i] - lut[q]) + Math.abs(colors[3 * i + 1] - lut[q + 1]) + Math.abs(colors[3 * i + 2] - lut[q + 2]) <= 6;
    }
    if (ramp) { out[j] = 1; continue; }
    // kolor z kamery: punkt RGB-D, jeśli rekonstrukcja z map głębi ma punkt w sąsiedztwie (≤ ~0,1 m)
    let near = false;
    for (let dz = -1; dz <= 1 && !near; dz++) for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) {
      near = rgbdOcc.has(vkey(x + dx * size, y + dy * size, z + dz * size, size));
    }
    out[j] = near ? 0 : 1;
  }
  return out;
}
