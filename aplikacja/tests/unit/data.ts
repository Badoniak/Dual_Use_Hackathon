// Wspólne ładowanie danych z symulacji z dysku (testy działają na prawdziwych plikach).
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import type { DataSource } from '../../src/sim/pipeline';

export const DATA_DIR = path.resolve(import.meta.dirname, '../../', process.env.SIM_DATA_DIR ?? 'dane_z_symulacji');
export const hasData = fs.existsSync(path.join(DATA_DIR, 'manifest.json'));

export function readText(rel: string): string {
  return fs.readFileSync(path.join(DATA_DIR, rel), 'utf8');
}

export function readBuffer(rel: string): ArrayBuffer {
  const b = fs.readFileSync(path.join(DATA_DIR, rel));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** Źródło danych z dysku; JPEG dekodowany przez jpeg-js (w przeglądarce — natywnie). */
export const diskSource: DataSource = {
  text: async p => readText(p),
  binary: async p => readBuffer(p),
  decodeImage: async data => {
    const img = jpeg.decode(new Uint8Array(data), { useTArray: true, formatAsRGBA: true });
    return { width: img.width, height: img.height, data: img.data };
  },
};
