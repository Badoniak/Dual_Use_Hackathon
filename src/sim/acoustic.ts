// Analiza mikrofonu drona zwiadowczego: STFT, usunięcie linii wirników, detekcja
// sygnałów tonalnych (telefon/alarm), głosu (grzebień harmonicznych) i szumu szerokopasmowego
// (trzaski ognia, osuwanie gruzu), a następnie zgrubna lokalizacja źródeł z amplitudy (model 1/r).
import { fft, hann } from './dsp';
import { trajectoryAt } from './geo';
import type { AcousticEvent, AcousticSource, Bounds2D, Trajectory, Vec3, WavData } from './types';

export interface AcousticParams {
  win: number;
  hop: number;
  rotorMinHz: number;
  rotorMaxHz: number;
  toneMinHz: number;
  toneMaxHz: number;
  toneMinSnrDb: number;
  voiceF0Min: number;
  voiceF0Max: number;
  voiceMinScore: number;
  /** średni poziom harmonicznych ponad tłem (krotność) */
  voiceMinLevel: number;
  broadMinHz: number;
  broadMaxHz: number;
  broadMinSnrDb: number;
  minEventsPerSource: number;
  sourceHeight: number;
  maxRadius: number;
}

export const DEFAULT_ACOUSTIC_PARAMS: AcousticParams = {
  win: 4096,
  hop: 2048,
  rotorMinHz: 60,
  rotorMaxHz: 150,
  toneMinHz: 400,
  toneMaxHz: 4000,
  toneMinSnrDb: 14,
  voiceF0Min: 100,
  voiceF0Max: 320,
  voiceMinScore: 8,
  voiceMinLevel: 6,
  broadMinHz: 2000,
  broadMaxHz: 7000,
  broadMinSnrDb: 6,
  minEventsPerSource: 4,
  sourceHeight: 1.0,
  maxRadius: 40,
};

export interface AcousticFrame {
  t: number;
  rotorHz: number;
  toneSnrDb: number;
  voiceScore: number;
  broadSnrDb: number;
}

export interface AcousticResult {
  frames: AcousticFrame[];
  events: AcousticEvent[];
  sources: AcousticSource[];
  durationS: number;
}

const db = (r: number) => 20 * Math.log10(Math.max(r, 1e-9));

export function analyzeAudio(wav: WavData, startStamp: number, tr: Trajectory, bounds: Bounds2D, params: AcousticParams = DEFAULT_ACOUSTIC_PARAMS): AcousticResult {
  const { win, hop } = params;
  const sr = wav.sampleRate;
  const ch = wav.channels;
  const nFrames = Math.max(0, Math.floor((wav.frames - win) / hop) + 1);
  const nBins = win / 2 + 1;
  const df = sr / win;
  const w = hann(win);
  let ws = 0;
  for (let i = 0; i < win; i++) ws += w[i];
  const mag = new Float32Array(nFrames * nBins);
  const re = new Float64Array(win);
  const im = new Float64Array(win);
  const times = new Float64Array(nFrames);
  const rotor = new Float64Array(nFrames);
  const kr0 = Math.ceil(params.rotorMinHz / df), kr1 = Math.floor(params.rotorMaxHz / df);

  for (let f = 0; f < nFrames; f++) {
    const s0 = f * hop;
    for (let i = 0; i < win; i++) {
      let v = 0;
      for (let c = 0; c < ch; c++) v += wav.samples[(s0 + i) * ch + c];
      re[i] = (v / ch / 32768) * w[i];
      im[i] = 0;
    }
    fft(re, im);
    const base = f * nBins;
    let best = 0, bestK = kr0;
    for (let k = 0; k < nBins; k++) {
      const m = (2 * Math.hypot(re[k], im[k])) / ws;
      mag[base + k] = m;
      if (k >= kr0 && k <= kr1 && m > best) { best = m; bestK = k; }
    }
    rotor[f] = bestK * df;
    times[f] = startStamp + (s0 + win / 2) / sr;
  }

  // Tło każdego binu = mediana w czasie (zawiera stałe linie wirników).
  const floor = new Float32Array(nBins);
  const col = new Float32Array(nFrames);
  for (let k = 0; k < nBins; k++) {
    for (let f = 0; f < nFrames; f++) col[f] = mag[f * nBins + k];
    const sorted = col.slice().sort();
    floor[k] = Math.max(sorted[nFrames >> 1], 1e-9);
  }

  const nearRotor = (fHz: number, fr: number, tol: number) => {
    const h = Math.round(fHz / fr);
    return h >= 1 && Math.abs(fHz - h * fr) < tol;
  };

  const frames: AcousticFrame[] = [];
  const events: AcousticEvent[] = [];
  const amps: { kind: AcousticEvent['kind']; freq: number; amp: number; t: number; pos: Vec3 }[] = [];
  const kt0 = Math.ceil(params.toneMinHz / df), kt1 = Math.floor(params.toneMaxHz / df);
  const kb0 = Math.ceil(params.broadMinHz / df), kb1 = Math.min(nBins - 1, Math.floor(params.broadMaxHz / df));
  const toneThr = Math.pow(10, params.toneMinSnrDb / 20);

  for (let f = 0; f < nFrames; f++) {
    const base = f * nBins;
    const Z = (k: number) => mag[base + k] / floor[k];
    const t = times[f];
    const pos = trajectoryAt(tr, t);

    // --- ton: wąski pik wyraźnie ponad tłem binu i ponad sąsiednimi binami tej samej ramki
    let toneBest = 0, toneK = -1;
    for (let k = kt0 + 12; k <= kt1 - 12; k++) {
      const z = Z(k);
      if (z < toneThr) continue;
      if (z < Z(k - 1) || z < Z(k + 1)) continue;
      let side = 0;
      for (let d = 6; d <= 12; d++) side += mag[base + k - d] + mag[base + k + d];
      side /= 14;
      if (mag[base + k] < 4 * side) continue;
      if (nearRotor(k * df, rotor[f], 6)) continue;
      if (z > toneBest) { toneBest = z; toneK = k; }
    }
    if (toneK >= 0) {
      events.push({ t, kind: 'tone', freqHz: toneK * df, snrDb: db(toneBest), dronePos: pos });
      amps.push({ kind: 'tone', freq: toneK * df, amp: mag[base + toneK] - floor[toneK], t, pos });
    }

    // --- głos: grzebień harmonicznych f0 (bez harmonicznych wirnika)
    let vBest = 0, vF0 = 0, vOn = 0;
    for (let f0 = params.voiceF0Min; f0 <= params.voiceF0Max; f0 += 1) {
      let on = 0, off = 0, n = 0;
      for (let h = 1; h <= 6; h++) {
        const fh = h * f0;
        if (fh > 2000) break;
        if (nearRotor(fh, rotor[f], 8)) continue;
        const k = Math.round(fh / df);
        const ko = Math.round((fh + f0 / 2) / df);
        on += Math.max(Z(k - 1), Z(k), Z(k + 1));
        off += Z(ko);
        n++;
      }
      if (n < 3) continue;
      const score = on / Math.max(off, 1e-6);
      if (score > vBest) { vBest = score; vF0 = f0; vOn = on / n; }
    }
    if (vBest >= params.voiceMinScore && vOn >= params.voiceMinLevel) {
      events.push({ t, kind: 'voice', freqHz: vF0, snrDb: db(vOn), dronePos: pos });
      amps.push({ kind: 'voice', freq: vF0, amp: vOn, t, pos });
    }

    // --- szum szerokopasmowy (trzaski)
    let bs = 0;
    for (let k = kb0; k <= kb1; k++) bs += Z(k);
    bs /= kb1 - kb0 + 1;
    const bDb = db(bs);
    if (bDb >= params.broadMinSnrDb) {
      events.push({ t, kind: 'broadband', freqHz: 0, snrDb: bDb, dronePos: pos });
      amps.push({ kind: 'broadband', freq: 0, amp: bs - 1, t, pos });
    }
    frames.push({ t, rotorHz: rotor[f], toneSnrDb: toneK >= 0 ? db(toneBest) : 0, voiceScore: vBest, broadSnrDb: bDb });
  }

  // --- grupowanie zdarzeń w źródła i lokalizacja
  const groups: { kind: AcousticEvent['kind']; freq: number; items: typeof amps }[] = [];
  for (const a of amps) {
    const tol = a.kind === 'tone' ? 10 : a.kind === 'voice' ? 3 : Infinity;
    const g = groups.find(q => q.kind === a.kind && Math.abs(q.freq - a.freq) <= tol);
    if (g) g.items.push(a); else groups.push({ kind: a.kind, freq: a.freq, items: [a] });
  }
  const sources: AcousticSource[] = [];
  for (const g of groups) {
    if (g.items.length < params.minEventsPerSource * (g.kind === 'voice' ? 2 : 1)) continue;
    const loc = localize(g.items, bounds, params.sourceHeight, params.maxRadius);
    const snrs = events.filter(e => e.kind === g.kind && (g.kind === 'broadband' || Math.abs(e.freqHz - g.freq) <= 10)).map(e => e.snrDb);
    sources.push({
      id: `A${sources.length + 1}`,
      kind: g.kind,
      freqHz: g.kind === 'broadband' ? 0 : median1(g.items.map(i => i.freq)),
      position: loc.position,
      radius: loc.radius,
      snrMaxDb: Math.max(...snrs),
      events: g.items.length,
      tFirst: g.items[0].t,
      tLast: g.items[g.items.length - 1].t,
    });
  }
  return { frames, events, sources, durationS: wav.frames / sr };
}

function median1(v: number[]): number {
  const a = [...v].sort((p, q) => p - q);
  return a[a.length >> 1];
}

/**
 * Zgrubna lokalizacja: przeszukanie siatki 1 m, model amplitudy A/r z dopasowanym A.
 * Promień niepewności = zasięg komórek o błędzie bliskim minimum.
 */
export function localize(items: { amp: number; pos: Vec3 }[], b: Bounds2D, z: number, maxRadius: number): { position: Vec3; radius: number; err: number } {
  const step = 1;
  const cells: { x: number; y: number; e: number }[] = [];
  let best = { x: 0, y: 0, e: Infinity };
  let sa2 = 0;
  for (const it of items) sa2 += it.amp * it.amp;
  for (let y = b.minY; y <= b.maxY; y += step) {
    for (let x = b.minX; x <= b.maxX; x += step) {
      let sga = 0, sgg = 0;
      for (const it of items) {
        const r = Math.hypot(it.pos[0] - x, it.pos[1] - y, it.pos[2] - z) + 0.5;
        const g = 1 / r;
        sga += g * it.amp; sgg += g * g;
      }
      const A = sga / sgg;
      let e = 0;
      for (const it of items) {
        const r = Math.hypot(it.pos[0] - x, it.pos[1] - y, it.pos[2] - z) + 0.5;
        const d = it.amp - A / r;
        e += d * d;
      }
      e /= sa2 || 1;
      cells.push({ x, y, e });
      if (e < best.e) best = { x, y, e };
    }
  }
  // komórki o błędzie do 10% gorszym od minimum wyznaczają obszar niepewności
  const thr = best.e * 1.1 + 1e-4;
  let radius = 0;
  for (const c of cells) if (c.e <= thr) radius = Math.max(radius, Math.hypot(c.x - best.x, c.y - best.y));
  return { position: [best.x, best.y, z], radius: Math.min(maxRadius, Math.max(2, radius)), err: best.e };
}
