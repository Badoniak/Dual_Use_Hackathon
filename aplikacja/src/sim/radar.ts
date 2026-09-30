// Syntetyczny radar SFCW fazy 2 (dron wylądował, silniki wyłączone) i detektor oznak życia.
// Model budżetu łącza z dokumentu koncepcji: L(d) = 40·log10((h+d)/1 m) + 2·α·d ≤ B,
// B = 81,5 dB po wylądowaniu (1 GHz, 10 dBm, anteny 6 dBi, RCS 0,3 m², próg −117 dBm, zapas SNR 13 dB).
import { amplitudeSpectrum, gaussian, median, rng } from './dsp';
import type { VitalDetection } from './types';

export interface RadarParams {
  budgetDb: number;
  /** tłumienie gruzu w jedną stronę [dB/m] — nieznane, zadanie nr 1 do pomiaru */
  attenuationDbPerM: number;
  antennaHeight: number;
  /** SNR na granicy budżetu (zapas z modelu) */
  edgeSnrDb: number;
  fs: number;
  durationS: number;
  /** szum pomiaru odległości elektrycznej [m] */
  rangeSigma: number;
  /**
   * zysk przetwarzania detektora (całkowanie ~90 s w widmie) — skalibrowany tak, by prawdopodobieństwo
   * detekcji 50% wypadało dokładnie na granicy budżetu łącza (SNR = edgeSnrDb)
   */
  processingGainDb: number;
  /** progi detektora */
  breathMinSnrDb: number;
  heartMinSnrDb: number;
}

export const DEFAULT_RADAR_PARAMS: RadarParams = {
  budgetDb: 81.5,
  attenuationDbPerM: 10,
  antennaHeight: 0.1,
  edgeSnrDb: 13,
  fs: 20,
  durationS: 90,
  rangeSigma: 0.04,
  processingGainDb: 29,
  breathMinSnrDb: 13,
  heartMinSnrDb: 11,
};

export function linkLossDb(d: number, p: RadarParams = DEFAULT_RADAR_PARAMS): number {
  return 40 * Math.log10(Math.max(p.antennaHeight + d, 0.05)) + 2 * p.attenuationDbPerM * d;
}

/** SNR sygnału oddechu po całkowaniu [dB] dla ofiary w odległości d przez gruz. */
export function vitalSnrDb(d: number, p: RadarParams = DEFAULT_RADAR_PARAMS): number {
  return p.edgeSnrDb + p.budgetDb - linkLossDb(d, p);
}

/** Maksymalny zasięg detekcji (bisekcja) — do opisu w UI. */
export function maxDetectionRange(p: RadarParams = DEFAULT_RADAR_PARAMS): number {
  let lo = 0, hi = 30;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (linkLossDb(m, p) <= p.budgetDb) lo = m; else hi = m;
  }
  return lo;
}

export interface VictimSignal {
  breathHz: number;
  heartHz: number;
  /** amplituda ruchu klatki [mm] */
  breathMm: number;
  heartMm: number;
}

export interface RadarSimInput {
  victim: VictimSignal | null;
  snrDb: number;
  seed: number;
  /** ratownik przechodzi w wiązce (brak "ciszy radarowej") */
  disturbance: boolean;
  params?: RadarParams;
}

/**
 * Sygnał w wolnym czasie (przesunięcie fazy w binie odległości ofiary), jednostki umowne: σ szumu = 1.
 * Zawiera: dryf tła (osiadanie gruzu), oddech (z lekką nieregularnością), bicie serca, szum, zakłócenie.
 */
export function simulateRadarSignal(inp: RadarSimInput): Float32Array {
  const p = inp.params ?? DEFAULT_RADAR_PARAMS;
  const n = Math.round(p.fs * p.durationS);
  const r = rng(inp.seed);
  const out = new Float32Array(n);
  let drift = 0;
  // SNR po przetwarzaniu → SNR pojedynczej próbki (σ szumu = 1)
  const amp = Math.SQRT2 * Math.pow(10, (inp.snrDb - p.processingGainDb) / 20);
  const v = inp.victim;
  const hRatio = v ? v.heartMm / v.breathMm : 0;
  let phaseB = r() * 2 * Math.PI, phaseH = r() * 2 * Math.PI;
  const dStart = r() * (p.durationS - 25), dLen = 12 + r() * 10;
  for (let i = 0; i < n; i++) {
    const t = i / p.fs;
    drift = drift * 0.999 + gaussian(r) * 0.02;
    let s = drift + gaussian(r);
    if (v) {
      const jitter = 1 + 0.04 * Math.sin((2 * Math.PI * t) / 23);
      phaseB += (2 * Math.PI * v.breathHz * jitter) / p.fs;
      phaseH += (2 * Math.PI * v.heartHz) / p.fs;
      // oddech nie jest czystą sinusoidą — dodajemy 2. harmoniczną
      s += amp * (Math.sin(phaseB) + 0.25 * Math.sin(2 * phaseB + 0.7)) + amp * hRatio * Math.sin(phaseH);
    }
    if (inp.disturbance && t >= dStart && t <= dStart + dLen) {
      const env = Math.sin((Math.PI * (t - dStart)) / dLen);
      s += env * (25 * Math.sin(2 * Math.PI * 0.9 * t) + 15 * gaussian(r));
    }
    out[i] = s;
  }
  return out;
}

export interface VitalSpectrum {
  freq: Float32Array;
  power: Float32Array;
}

/**
 * Detektor oznak życia: usunięcie trendu, widmo 0,1–2 Hz, szczyt oddechu (0,1–0,6 Hz),
 * szczyt serca (0,8–2 Hz, poza harmonicznymi oddechu), test niestacjonarności (ruch w wiązce).
 */
export function detectVitalSigns(sig: Float32Array, fs: number, p: RadarParams = DEFAULT_RADAR_PARAMS): { detection: VitalDetection; spectrum: VitalSpectrum } {
  const n = sig.length;
  // usunięcie trendu liniowego
  let st = 0, ss = 0, stt = 0, sts = 0;
  for (let i = 0; i < n; i++) { st += i; ss += sig[i]; stt += i * i; sts += i * sig[i]; }
  const b = (n * sts - st * ss) / (n * stt - st * st);
  const a = (ss - b * st) / n;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = sig[i] - (a + b * i);

  // niestacjonarność: wariancja w oknach 5 s
  const wlen = Math.round(5 * fs);
  const vars: number[] = [];
  for (let s0 = 0; s0 + wlen <= n; s0 += wlen) {
    let m = 0, v = 0;
    for (let i = s0; i < s0 + wlen; i++) m += x[i];
    m /= wlen;
    for (let i = s0; i < s0 + wlen; i++) v += (x[i] - m) ** 2;
    vars.push(v / wlen);
  }
  const medVar = median(vars);
  const disturbed = vars.some(v => v > 8 * medVar);
  // okna z zakłóceniem są wygaszane (ratownik w wiązce)
  if (disturbed) {
    for (let k = 0; k < vars.length; k++) if (vars[k] > 4 * medVar) for (let i = k * wlen; i < (k + 1) * wlen && i < n; i++) x[i] = 0;
  }

  const nfft = 8192;
  const amp = amplitudeSpectrum(x, nfft);
  const df = fs / nfft;
  const power = new Float32Array(amp.length);
  for (let k = 0; k < amp.length; k++) power[k] = amp[k] * amp[k];
  const band = (f0: number, f1: number) => [Math.ceil(f0 / df), Math.floor(f1 / df)];
  const [n0, n1] = band(2.5, Math.min(9, fs / 2 - 0.5));
  const noise = median(power.subarray(n0, n1 + 1));
  const peak = (k0: number, k1: number, exclude: (f: number) => boolean) => {
    let best = -1, bk = -1;
    for (let k = k0; k <= k1; k++) {
      if (exclude(k * df)) continue;
      if (power[k] > best && power[k] >= power[k - 1] && power[k] >= power[k + 1]) { best = power[k]; bk = k; }
    }
    return { k: bk, p: best };
  };
  const [b0, b1] = band(0.1, 0.6);
  const br = peak(b0, b1, () => false);
  const breathSnr = 10 * Math.log10(Math.max(br.p, 1e-12) / noise);
  const fb = br.k * df;
  const [h0, h1] = band(0.8, 2.0);
  const hr = peak(h0, h1, f => { for (let m = 2; m <= 8; m++) if (Math.abs(f - m * fb) < 0.04) return true; return false; });
  const heartSnr = 10 * Math.log10(Math.max(hr.p, 1e-12) / noise);
  const breathOk = breathSnr >= p.breathMinSnrDb;
  const heartOk = breathOk && heartSnr >= p.heartMinSnrDb;
  const logistic = (z: number) => 1 / (1 + Math.exp(-z));
  let confidence = logistic((breathSnr - p.breathMinSnrDb) / 2.5);
  confidence *= heartOk ? 1 : 0.85;
  if (disturbed) confidence *= 0.75;
  const f1 = band(0, 2.5)[1];
  return {
    detection: {
      detected: breathOk,
      confidence: breathOk ? confidence : Math.min(confidence, 0.3),
      breathingHz: breathOk ? fb : null,
      heartHz: heartOk ? hr.k * df : null,
      breathingSnrDb: breathSnr,
      heartSnrDb: heartSnr,
      disturbed,
    },
    spectrum: { freq: Float32Array.from({ length: f1 + 1 }, (_, k) => k * df), power: power.slice(0, f1 + 1) },
  };
}
