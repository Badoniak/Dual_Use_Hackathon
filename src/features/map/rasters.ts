import type { RasterImage } from '../../sim/pipeline';

const cache = new WeakMap<Uint8ClampedArray, string>();

/** RGBA → data URL (PNG) przez canvas; wynik jest zapamiętywany dla danej tablicy. */
export function rasterToDataUrl(img: RasterImage): string {
  const hit = cache.get(img.rgba);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  const url = c.toDataURL('image/png');
  cache.set(img.rgba, url);
  return url;
}
