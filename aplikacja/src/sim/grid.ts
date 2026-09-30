// Siatka zajętości 3D (raycasting kamer) i mapa wysokości 2.5D (lądowiska, głębokość).
import type { Bounds3D, Bounds2D } from './types';

export class VoxelGrid {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly occ: Uint8Array;
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  readonly size: number;

  constructor(bounds: Bounds3D, size: number) {
    this.size = size;
    this.ox = bounds.minX;
    this.oy = bounds.minY;
    this.oz = bounds.minZ;
    this.nx = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / size));
    this.ny = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) / size));
    this.nz = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / size));
    this.occ = new Uint8Array(this.nx * this.ny * this.nz);
  }

  static fromPoints(positions: Float32Array, count: number, bounds: Bounds3D, size: number): VoxelGrid {
    const g = new VoxelGrid(bounds, size);
    for (let i = 0; i < count; i++) {
      const idx = g.indexOf(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
      if (idx >= 0) g.occ[idx] = 1;
    }
    return g;
  }

  indexOf(x: number, y: number, z: number): number {
    const ix = Math.floor((x - this.ox) / this.size);
    const iy = Math.floor((y - this.oy) / this.size);
    const iz = Math.floor((z - this.oz) / this.size);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) return -1;
    return (iz * this.ny + iy) * this.nx + ix;
  }

  /** Najwyższy zajęty woksel w kolumnie (x, y) nie wyżej niż zMax — powierzchnia pod nawisem/koroną muru. */
  topBelow(x: number, y: number, zMax: number, searchCells = 2): number {
    const ix0 = Math.floor((x - this.ox) / this.size), iy0 = Math.floor((y - this.oy) / this.size);
    const izMax = Math.min(this.nz - 1, Math.floor((zMax - this.oz) / this.size));
    let best = -Infinity;
    for (let dy = -searchCells; dy <= searchCells; dy++) for (let dx = -searchCells; dx <= searchCells; dx++) {
      const ix = ix0 + dx, iy = iy0 + dy;
      if (ix < 0 || iy < 0 || ix >= this.nx || iy >= this.ny) continue;
      for (let iz = izMax; iz >= 0; iz--) {
        if (this.occ[(iz * this.ny + iy) * this.nx + ix]) { best = Math.max(best, this.oz + (iz + 0.5) * this.size); break; }
      }
    }
    return Number.isFinite(best) ? best : NaN;
  }

  center(idx: number): [number, number, number] {
    const ix = idx % this.nx;
    const iy = Math.floor(idx / this.nx) % this.ny;
    const iz = Math.floor(idx / (this.nx * this.ny));
    return [this.ox + (ix + 0.5) * this.size, this.oy + (iy + 0.5) * this.size, this.oz + (iz + 0.5) * this.size];
  }

  /**
   * Pierwszy zajęty woksel na promieniu (Amanatides–Woo). Kierunek musi być znormalizowany.
   * Zwraca indeks woksela albo -1.
   */
  raycast(px: number, py: number, pz: number, dx: number, dy: number, dz: number, tMin: number, tMax: number): number {
    const s = this.size;
    let x = px + dx * tMin, y = py + dy * tMin, z = pz + dz * tMin;
    let ix = Math.floor((x - this.ox) / s);
    let iy = Math.floor((y - this.oy) / s);
    let iz = Math.floor((z - this.oz) / s);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const inv = (v: number) => (Math.abs(v) < 1e-12 ? Infinity : Math.abs(1 / v));
    const tdx = s * inv(dx), tdy = s * inv(dy), tdz = s * inv(dz);
    const bx = this.ox + (ix + (dx > 0 ? 1 : 0)) * s;
    const by = this.oy + (iy + (dy > 0 ? 1 : 0)) * s;
    const bz = this.oz + (iz + (dz > 0 ? 1 : 0)) * s;
    let tx = Math.abs(dx) < 1e-12 ? Infinity : (bx - x) / dx;
    let ty = Math.abs(dy) < 1e-12 ? Infinity : (by - y) / dy;
    let tz = Math.abs(dz) < 1e-12 ? Infinity : (bz - z) / dz;
    let t = tMin;
    const nx = this.nx, ny = this.ny, nz = this.nz, occ = this.occ;
    while (t <= tMax) {
      if (ix >= 0 && iy >= 0 && iz >= 0 && ix < nx && iy < ny && iz < nz) {
        const idx = (iz * ny + iy) * nx + ix;
        if (occ[idx]) return idx;
      } else if ((ix < 0 && stepX < 0) || (ix >= nx && stepX > 0) || (iy < 0 && stepY < 0) || (iy >= ny && stepY > 0) || (iz < 0 && stepZ < 0) || (iz >= nz && stepZ > 0)) {
        return -1; // wychodzi poza siatkę i się oddala
      }
      if (tx < ty) {
        if (tx < tz) { ix += stepX; t = tMin + tx; tx += tdx; } else { iz += stepZ; t = tMin + tz; tz += tdz; }
      } else if (ty < tz) { iy += stepY; t = tMin + ty; ty += tdy; } else { iz += stepZ; t = tMin + tz; tz += tdz; }
    }
    return -1;
  }
}

export interface HeightMap {
  ox: number;
  oy: number;
  cell: number;
  nx: number;
  ny: number;
  /** najwyższy punkt w komórce, NaN = brak danych */
  top: Float32Array;
  /** najniższy punkt w komórce */
  bottom: Float32Array;
  count: Uint16Array;
}

export function buildHeightMap(positions: Float32Array, count: number, b: Bounds2D, cell: number, zMax = 60): HeightMap {
  const nx = Math.ceil((b.maxX - b.minX) / cell);
  const ny = Math.ceil((b.maxY - b.minY) / cell);
  const top = new Float32Array(nx * ny).fill(NaN);
  const bottom = new Float32Array(nx * ny).fill(NaN);
  const cnt = new Uint16Array(nx * ny);
  for (let i = 0; i < count; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2];
    if (z > zMax) continue;
    const ix = Math.floor((x - b.minX) / cell), iy = Math.floor((y - b.minY) / cell);
    if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) continue;
    const k = iy * nx + ix;
    if (!(top[k] >= z)) top[k] = z;
    if (!(bottom[k] <= z)) bottom[k] = z;
    if (cnt[k] < 65535) cnt[k]++;
  }
  return { ox: b.minX, oy: b.minY, cell, nx, ny, top, bottom, count: cnt };
}

/** Wysokość powierzchni w punkcie; gdy brak danych — najbliższa komórka z danymi w promieniu `searchCells`. */
export function sampleHeight(hm: HeightMap, x: number, y: number, searchCells = 4): number {
  const ix = Math.floor((x - hm.ox) / hm.cell), iy = Math.floor((y - hm.oy) / hm.cell);
  for (let r = 0; r <= searchCells; r++) {
    let best = NaN, bestD = Infinity;
    for (let j = iy - r; j <= iy + r; j++) {
      for (let i = ix - r; i <= ix + r; i++) {
        if (Math.max(Math.abs(i - ix), Math.abs(j - iy)) !== r) continue;
        if (i < 0 || j < 0 || i >= hm.nx || j >= hm.ny) continue;
        const v = hm.top[j * hm.nx + i];
        if (Number.isNaN(v)) continue;
        const d = (i - ix) ** 2 + (j - iy) ** 2;
        if (d < bestD) { bestD = d; best = v; }
      }
    }
    if (!Number.isNaN(best)) return best;
  }
  return NaN;
}
