// Zarządzanie Web Workerem przetwarzającym dane zwiadowcy.
import type { DisplayCloud, ScoutInput, ScoutResult } from '../sim/pipeline';
import type { WorkerResponse } from '../workers/scout.worker';

export interface ScoutHandlers {
  onProgress: (stage: string, pct: number, message: string) => void;
  onResult: (r: ScoutResult) => void;
  onError: (message: string) => void;
  onTrajectory?: (t: Float64Array, pos: Float32Array) => void;
  /** chmura punktów wybranego obszaru — zaraz po etapie lidaru (skan narasta podczas lotu) */
  onCloud?: (c: DisplayCloud) => void;
}

let worker: Worker | null = null;

export function startScoutProcessing(baseUrl: string, input: ScoutInput, h: ScoutHandlers): void {
  cancelScoutProcessing();
  const w = new Worker(new URL('../workers/scout.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    if (worker !== w) return; // anulowany
    const m = e.data;
    if (m.type === 'progress') h.onProgress(m.stage, m.pct, m.message);
    else if (m.type === 'trajectory') h.onTrajectory?.(m.t, m.pos);
    else if (m.type === 'cloud') h.onCloud?.(m.cloud);
    else if (m.type === 'result') { h.onResult(m.result); w.terminate(); worker = null; }
    else if (m.type === 'error') { h.onError(m.message); w.terminate(); worker = null; }
  };
  w.onerror = e => { if (worker === w) { h.onError(e.message || 'błąd workera'); worker = null; } };
  w.postMessage({ type: 'process', baseUrl: new URL(baseUrl, location.href).href, input });
}

export function cancelScoutProcessing(): void {
  worker?.terminate();
  worker = null;
}
