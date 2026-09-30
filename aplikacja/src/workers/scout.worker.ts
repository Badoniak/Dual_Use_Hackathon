// Web Worker "stacji naziemnej": pobiera dane zwiadowcy z /sim-data/ i uruchamia pipeline fazy 1,
// nie blokując interfejsu. Wyniki (duże tablice) są przekazywane bez kopiowania (transferables).
import { runScoutPipeline, type DataSource, type DisplayCloud, type ScoutInput, type ScoutResult } from '../sim/pipeline';
import { parseTrajectory } from '../sim/parse';

export type WorkerRequest = { type: 'process'; baseUrl: string; input: ScoutInput };
export type WorkerResponse =
  | { type: 'trajectory'; t: Float64Array; pos: Float32Array }
  | { type: 'cloud'; cloud: DisplayCloud }
  | { type: 'progress'; stage: string; pct: number; message: string }
  | { type: 'result'; result: ScoutResult }
  | { type: 'error'; message: string };

function httpSource(base: string): DataSource {
  const url = (p: string) => base.replace(/\/?$/, '/') + p;
  const get = async (p: string) => {
    const r = await fetch(url(p));
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    return r;
  };
  return {
    text: async p => (await get(p)).text(),
    binary: async p => (await get(p)).arrayBuffer(),
    // natywne dekodowanie JPEG/PNG w workerze (klatki RGB kamery RGB-D)
    decodeImage: async data => {
      const bmp = await createImageBitmap(new Blob([data]));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
      bmp.close();
      return { width: img.width, height: img.height, data: img.data };
    },
  };
}

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  if (e.data.type !== 'process') return;
  const src = httpSource(e.data.baseUrl);
  try {
    // trajektoria od razu — interfejs odtwarza lot, zanim skończy się przetwarzanie
    const tr = parseTrajectory(await src.text('trajectory.csv'));
    post({ type: 'trajectory', t: tr.t, pos: tr.pos });
    const result = await runScoutPipeline(
      src,
      e.data.input,
      (stage, pct, message) => post({ type: 'progress', stage, pct, message }),
      cloud => post({ type: 'cloud', cloud }, [cloud.positions.buffer, cloud.colors.buffer]),
    );
    const transfer: Transferable[] = [
      result.cloud.positions.buffer, result.cloud.colors.buffer, result.cloud.temps.buffer,
      result.heightmap.top.buffer, result.heightmap.bottom.buffer, result.heightmap.count.buffer,
      result.ortho.rgb.rgba.buffer, result.ortho.thermal.rgba.buffer,
      ...Object.values(result.thumbnails).map(t => t.rgba.buffer),
    ];
    post({ type: 'result', result }, transfer as Transferable[]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
