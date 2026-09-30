// Termowizja → mapa 3D: każdy piksel klatki jest rzutowany promieniem z kamery na pierwszą
// zajętą komórkę mapy lidarowej. Woksel dostaje statystykę: ile razy był widziany, średnią
// temperaturę, ile razy był "ciepły" (zakres ciała człowieka) i ile razy "gorący" (silna anomalia).
import type { VoxelGrid } from './grid';
import type { CameraIntrinsics, FramePose, Vec3 } from './types';

export interface ThermalParams {
  /** co ile pikseli prowadzić promień */
  pixelStep: number;
  /** klatki z niższego pułapu są pomijane (promienie ślizgają się po gruncie) */
  minAltitude: number;
  minRange: number;
  maxRange: number;
  personMinK: number;
  personMaxK: number;
  fireMinK: number;
  /** skala wartości PNG → kelwiny (manifest: 0.01 K/count) */
  scale: number;
  minWarmHits: number;
  minWarmRatio: number;
}

export const DEFAULT_THERMAL_PARAMS: ThermalParams = {
  pixelStep: 5,
  minAltitude: 1.0,
  minRange: 0.8,
  maxRange: 45,
  personMinK: 305,
  personMaxK: 320,
  fireMinK: 330,
  scale: 0.01,
  minWarmHits: 3,
  minWarmRatio: 0.4,
};

interface VoxelStat {
  visit: number;
  warm: number;
  fire: number;
  sumT: number;
  maxT: number;
}

export interface ThermalCluster {
  /** 'body' — temperatura zbliżona do ciała, 'hot' — silna anomalia cieplna */
  kind: 'body' | 'hot';
  centroid: Vec3;
  min: Vec3;
  max: Vec3;
  voxels: number;
  hits: number;
  frames: number;
  firstSeen: number;
  lastSeen: number;
  maxTempK: number;
  bestFrame: string;
  /** średni udział "ciepłych" obserwacji w wokselach klastra */
  ratio: number;
}

export function quatToMatrix(q: [number, number, number, number]): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

export class ThermalMapper {
  readonly stats = new Map<number, VoxelStat>();
  /** zdarzenia (woksel, klatka) dla ciepłych/gorących trafień */
  private warmEvents: number[] = [];
  private fireEvents: number[] = [];
  readonly frames: FramePose[] = [];
  framesUsed = 0;
  raysCast = 0;
  private dirs: Float32Array;
  private pix: Int32Array;
  readonly grid: VoxelGrid;
  readonly intr: CameraIntrinsics;
  readonly params: ThermalParams;

  constructor(grid: VoxelGrid, intr: CameraIntrinsics, params: ThermalParams = DEFAULT_THERMAL_PARAMS) {
    this.grid = grid;
    this.intr = intr;
    this.params = params;
    // Kierunki promieni w układzie linku kamery (x do przodu, y w lewo, z w górę) — liczone raz.
    const s = params.pixelStep;
    const us: number[] = [];
    const vs: number[] = [];
    for (let v = Math.floor(s / 2); v < intr.height; v += s) for (let u = Math.floor(s / 2); u < intr.width; u += s) { us.push(u); vs.push(v); }
    this.dirs = new Float32Array(us.length * 3);
    this.pix = new Int32Array(us.length);
    for (let i = 0; i < us.length; i++) {
      const a = 1, b = -(us[i] - intr.cx) / intr.fx, c = -(vs[i] - intr.cy) / intr.fy;
      const n = Math.hypot(a, b, c);
      this.dirs[3 * i] = a / n; this.dirs[3 * i + 1] = b / n; this.dirs[3 * i + 2] = c / n;
      this.pix[i] = vs[i] * intr.width + us[i];
    }
  }

  /** Dodaje klatkę. `img` — surowe wartości uint16 (kelwiny / scale). Zwraca liczbę ciepłych pikseli. */
  addFrame(pose: FramePose, img: Uint16Array | Uint8Array | Uint8ClampedArray): number {
    const p = this.params;
    if (pose.pos[2] < p.minAltitude) return 0;
    const frameIdx = this.frames.length;
    this.frames.push(pose);
    this.framesUsed++;
    const R = quatToMatrix(pose.quat);
    const [px, py, pz] = pose.pos;
    const n = this.pix.length;
    let warmPixels = 0;
    for (let i = 0; i < n; i++) {
      const T = img[this.pix[i]] * p.scale;
      const lx = this.dirs[3 * i], ly = this.dirs[3 * i + 1], lz = this.dirs[3 * i + 2];
      const dx = R[0] * lx + R[1] * ly + R[2] * lz;
      const dy = R[3] * lx + R[4] * ly + R[5] * lz;
      const dz = R[6] * lx + R[7] * ly + R[8] * lz;
      this.raysCast++;
      const hit = this.grid.raycast(px, py, pz, dx, dy, dz, p.minRange, p.maxRange);
      if (hit < 0) continue;
      let st = this.stats.get(hit);
      if (!st) { st = { visit: 0, warm: 0, fire: 0, sumT: 0, maxT: 0 }; this.stats.set(hit, st); }
      st.visit++;
      st.sumT += T;
      if (T > st.maxT) st.maxT = T;
      if (T >= p.personMinK && T <= p.personMaxK) {
        st.warm++;
        warmPixels++;
        this.warmEvents.push(hit, frameIdx);
      } else if (T >= p.fireMinK) {
        st.fire++;
        this.fireEvents.push(hit, frameIdx);
      }
    }
    return warmPixels;
  }

  meanTemperature(voxel: number): number {
    const st = this.stats.get(voxel);
    return st && st.visit > 0 ? st.sumT / st.visit : NaN;
  }

  /** Średnia temperatura woksela dla każdego punktu chmury (NaN = poza polem widzenia kamery). */
  pointTemperatures(positions: Float32Array, count: number): Float32Array {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const idx = this.grid.indexOf(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
      out[i] = idx < 0 ? NaN : this.meanTemperature(idx);
    }
    return out;
  }

  clusters(): ThermalCluster[] {
    const p = this.params;
    const warmSet = new Set<number>();
    const fireSet = new Set<number>();
    for (const [idx, st] of this.stats) {
      if (st.warm >= p.minWarmHits && st.warm / st.visit >= p.minWarmRatio) warmSet.add(idx);
      if (st.fire >= 2) fireSet.add(idx);
    }
    return [
      ...this.components(warmSet, 'body', this.warmEvents),
      ...this.components(fireSet, 'hot', this.fireEvents),
    ];
  }

  private components(set: Set<number>, kind: 'body' | 'hot', events: number[]): ThermalCluster[] {
    const g = this.grid;
    const label = new Map<number, number>();
    const groups: number[][] = [];
    for (const start of set) {
      if (label.has(start)) continue;
      const id = groups.length;
      const members: number[] = [];
      const stack = [start];
      label.set(start, id);
      while (stack.length) {
        const v = stack.pop()!;
        members.push(v);
        const ix = v % g.nx, iy = Math.floor(v / g.nx) % g.ny, iz = Math.floor(v / (g.nx * g.ny));
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy && !dz) continue;
          const jx = ix + dx, jy = iy + dy, jz = iz + dz;
          if (jx < 0 || jy < 0 || jz < 0 || jx >= g.nx || jy >= g.ny || jz >= g.nz) continue;
          const w = (jz * g.ny + jy) * g.nx + jx;
          if (set.has(w) && !label.has(w)) { label.set(w, id); stack.push(w); }
        }
      }
      groups.push(members);
    }
    // statystyki klatek per klaster
    const framesPer: Map<number, number>[] = groups.map(() => new Map());
    for (let k = 0; k < events.length; k += 2) {
      const id = label.get(events[k]);
      if (id === undefined) continue;
      const m = framesPer[id];
      m.set(events[k + 1], (m.get(events[k + 1]) ?? 0) + 1);
    }
    const out: ThermalCluster[] = [];
    groups.forEach((members, id) => {
      let sx = 0, sy = 0, sz = 0, sw = 0, hits = 0, maxT = 0, ratio = 0;
      const mn: Vec3 = [Infinity, Infinity, Infinity];
      const mx: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const v of members) {
        const st = this.stats.get(v)!;
        const w = kind === 'body' ? st.warm : st.fire;
        const c = g.center(v);
        sx += c[0] * w; sy += c[1] * w; sz += c[2] * w; sw += w; hits += w;
        ratio += (kind === 'body' ? st.warm : st.fire) / st.visit;
        if (st.maxT > maxT) maxT = st.maxT;
        for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], c[k] - g.size / 2); mx[k] = Math.max(mx[k], c[k] + g.size / 2); }
      }
      const fm = framesPer[id];
      let best = -1, bestN = -1, first = Infinity, last = -Infinity;
      for (const [f, n] of fm) {
        if (n > bestN) { bestN = n; best = f; }
        first = Math.min(first, this.frames[f].stamp);
        last = Math.max(last, this.frames[f].stamp);
      }
      out.push({
        kind,
        centroid: [sx / sw, sy / sw, sz / sw],
        min: mn,
        max: mx,
        voxels: members.length,
        hits,
        frames: fm.size,
        firstSeen: first,
        lastSeen: last,
        maxTempK: maxT,
        bestFrame: best >= 0 ? this.frames[best].file : '',
        ratio: ratio / members.length,
      });
    });
    return out;
  }
}

/** Paleta "ironbow" dla podglądu termowizji: t w [0,1]. */
export function ironbow(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const r = Math.min(1, 1.6 * x);
  const g = Math.min(1, Math.max(0, 2.2 * x - 0.9));
  const b = Math.max(0, Math.min(1, x < 0.35 ? 0.2 + 1.8 * x : x > 0.85 ? (x - 0.85) * 5 : 0.83 - 1.6 * (x - 0.35)));
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** Obraz termowizji w fałszywych kolorach (RGBA) do podglądu w UI. */
export function thermalToRgba(img: Uint16Array | Uint8Array | Uint8ClampedArray, width: number, height: number, scale: number, minK = 285, maxK = 320): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const T = img[i] * scale;
    const [r, g, b] = T >= 330 ? [255, 255, 255] : ironbow((T - minK) / (maxK - minK));
    out[4 * i] = r; out[4 * i + 1] = g; out[4 * i + 2] = b; out[4 * i + 3] = 255;
  }
  return out;
}
