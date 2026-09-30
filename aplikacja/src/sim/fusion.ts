// Fuzja czujników fazy 1 → hot spoty, czyli potencjalne miejsca, w których może być zasypana osoba.
// Każdy hot spot ma zawsze dwie składowe:
//  • termowizja — anomalia cieplna zrzutowana na mapę 3D (klastry z wielu klatek),
//  • mikrofon — czy sygnał (stuki/trzaski, ton, głos) rośnie, gdy dron zbliża się do tego miejsca,
//    oraz czy w pobliżu zlokalizowano źródło dźwięku.
// Zasada z koncepcji: system proponuje, ratownik zatwierdza; brak hot spotu nie oznacza braku ludzi.
import type { AcousticSource, Hotspot, Trajectory, Vec3 } from './types';
import type { ThermalCluster } from './thermal';
import type { AcousticFrame } from './acoustic';
import { sampleHeight, type HeightMap } from './grid';
import { trajectoryAt } from './geo';

export interface FusionParams {
  mergeDist: number;
  minFrames: number;
  /** źródła akustyczne o większej niepewności nie tworzą osobnego hotspotu, tylko strefę */
  maxAcousticRadiusForHotspot: number;
  /** typowy rozmiar człowieka — większe ciepłe obszary są mniej wiarygodne */
  personMaxExtent: number;
  /** miejsce startu drona w nagraniu — ciepłe obiekty tam to zwykle ratownicy */
  baseRadius: number;
  /** próg ufności, od którego hotspot jest domyślnie kierowany do pomiaru radarem */
  radarMinConfidence: number;
}

export const DEFAULT_FUSION_PARAMS: FusionParams = {
  mergeDist: 2.5,
  minFrames: 3,
  maxAcousticRadiusForHotspot: 8,
  personMaxExtent: 2.5,
  baseRadius: 6,
  radarMinConfidence: 0.6,
};

const KELVIN = 273.15;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

type MergedCluster = ThermalCluster & { bodyHits: number; hotHits: number; bodyMaxK: number; hotMaxK: number };

function mergeClusters(cs: ThermalCluster[], dist: number): MergedCluster[] {
  const out: MergedCluster[] = [];
  for (const c of [...cs].sort((a, b) => b.hits - a.hits)) {
    const body = c.kind === 'body' ? c.hits : 0;
    const hot = c.kind === 'hot' ? c.hits : 0;
    const bodyK = c.kind === 'body' ? c.maxTempK : 0;
    const hotK = c.kind === 'hot' ? c.maxTempK : 0;
    const m = out.find(o => Math.hypot(o.centroid[0] - c.centroid[0], o.centroid[1] - c.centroid[1]) <= dist);
    if (!m) { out.push({ ...c, centroid: [...c.centroid] as Vec3, min: [...c.min] as Vec3, max: [...c.max] as Vec3, bodyHits: body, hotHits: hot, bodyMaxK: bodyK, hotMaxK: hotK }); continue; }
    m.bodyMaxK = Math.max(m.bodyMaxK, bodyK);
    m.hotMaxK = Math.max(m.hotMaxK, hotK);
    const w = m.hits + c.hits;
    for (let k = 0; k < 3; k++) {
      m.centroid[k] = (m.centroid[k] * m.hits + c.centroid[k] * c.hits) / w;
      m.min[k] = Math.min(m.min[k], c.min[k]);
      m.max[k] = Math.max(m.max[k], c.max[k]);
    }
    m.ratio = (m.ratio * m.voxels + c.ratio * c.voxels) / (m.voxels + c.voxels);
    m.voxels += c.voxels;
    m.hits = w;
    m.bodyHits += body;
    m.hotHits += hot;
    m.frames = Math.max(m.frames, c.frames);
    m.firstSeen = Math.min(m.firstSeen, c.firstSeen);
    m.lastSeen = Math.max(m.lastSeen, c.lastSeen);
    m.maxTempK = Math.max(m.maxTempK, c.maxTempK);
    if (c.hits > m.hits - c.hits) m.bestFrame = c.bestFrame;
  }
  return out;
}

export interface AcousticContext {
  frames: AcousticFrame[];
  trajectory: Trajectory;
  sources: AcousticSource[];
}

const KIND_LABEL = {
  broadband: 'stuki / trzaski szerokopasmowe',
  tone: 'sygnał tonalny (telefon / alarm)',
  voice: 'głos',
} as const;

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/**
 * Składowa mikrofonu dla punktu: (1) korelacja poziomu sygnału z bliskością drona do punktu —
 * "czy dźwięk rośnie, gdy dron się zbliża" — oraz (2) bliskość zlokalizowanego źródła dźwięku.
 */
export function acousticSupport(p: Vec3, ctx: AcousticContext | null): { score: number; note: string } {
  if (!ctx || ctx.frames.length === 0) return { score: 0, note: 'Mikrofon: brak danych' };
  const prox = ctx.frames.map(f => {
    const d = trajectoryAt(ctx.trajectory, f.t);
    return 1 / (Math.hypot(d[0] - p[0], d[1] - p[1]) + 2);
  });
  const series: Record<keyof typeof KIND_LABEL, number[]> = {
    broadband: ctx.frames.map(f => Math.max(0, f.broadSnrDb)),
    tone: ctx.frames.map(f => Math.max(0, f.toneSnrDb)),
    voice: ctx.frames.map(f => Math.max(0, f.voiceScore - 3) * 3),
  };
  let best = { score: 0, kind: 'broadband' as keyof typeof KIND_LABEL, r: 0, level: 0 };
  for (const kind of Object.keys(series) as (keyof typeof KIND_LABEL)[]) {
    const y = series[kind];
    const r = pearson(prox, y);
    const sorted = [...y].sort((a, b) => a - b);
    const level = sorted[Math.floor(sorted.length * 0.98)] ?? 0;
    const corrTerm = clamp01((r - 0.2) / 0.5) * clamp01(level / 12);
    // bliskość źródła zlokalizowanego z amplitudy (słaba lokalizacja → mała waga)
    let srcTerm = 0;
    for (const s of ctx.sources.filter(q => q.kind === kind)) {
      const d = Math.hypot(s.position[0] - p[0], s.position[1] - p[1]);
      const quality = clamp01(5 / Math.max(s.radius, 2));
      srcTerm = Math.max(srcTerm, quality * Math.exp(-((d / Math.max(s.radius, 3)) ** 2)));
    }
    const score = 0.5 * corrTerm + 0.5 * srcTerm;
    if (score > best.score) best = { score, kind, r, level };
  }
  if (best.score < 0.05) return { score: 0, note: 'Mikrofon: brak sygnału, który narastałby w pobliżu tego miejsca' };
  return {
    score: clamp01(best.score),
    note: `Mikrofon: ${KIND_LABEL[best.kind]} głośniejsze bliżej tego miejsca (korelacja ${best.r.toFixed(2)}, do ${best.level.toFixed(0)} dB ponad tło)`,
  };
}

export interface FusionResult {
  hotspots: Hotspot[];
  /** źródła akustyczne zbyt słabo zlokalizowane, by wskazać punkt — pokazywane jako strefy */
  acousticZones: AcousticSource[];
}

export function fuseHotspots(
  clusters: ThermalCluster[],
  acoustic: AcousticContext | null,
  hm: HeightMap,
  inArea: (x: number, y: number) => boolean = () => true,
  base: [number, number] | null = null,
  params: FusionParams = DEFAULT_FUSION_PARAMS,
  /** powierzchnia w kolumnie (x, y) nie wyżej niż zMax (z mapy wokselowej) */
  surfaceBelow?: (x: number, y: number, zMax: number) => number,
): FusionResult {
  const hs: Hotspot[] = [];
  const nearBase = (x: number, y: number) => base !== null && Math.hypot(x - base[0], y - base[1]) <= params.baseRadius;
  const heat = mergeClusters(clusters, params.mergeDist);

  for (const c of heat) {
    if (c.frames < params.minFrames && c.hits < 20) continue;
    const [x, y] = c.centroid;
    if (!inArea(x, y)) continue;
    const extent = Math.max(c.max[0] - c.min[0], c.max[1] - c.min[1]);
    // potwierdzenie z wielu pozycji drona + intensywność (liczba ciepłych obserwacji)
    const views = 0.6 * (1 - Math.exp(-c.frames / 5)) + 0.4 * (1 - Math.exp(-c.hits / 30));
    const sizeFactor = extent <= params.personMaxExtent ? 1 : Math.max(0.3, params.personMaxExtent / extent);
    // temperatura zbliżona do ciała jest mocniejszą przesłanką niż bardzo gorące źródło
    const bodyShare = c.bodyHits / Math.max(1, c.bodyHits + c.hotHits);
    const tempFactor = 0.7 + 0.3 * bodyShare;
    let pT = Math.min(0.95, views * Math.min(1, c.ratio / 0.6 + 0.3) * sizeFactor * tempFactor);
    const parts: string[] = [];
    if (c.bodyHits > 0) parts.push(`temperatura zbliżona do ciała (${(c.bodyMaxK - KELVIN).toFixed(1)} °C)`);
    if (c.hotHits > 0) parts.push(`silna anomalia cieplna (do ${(c.hotMaxK - KELVIN).toFixed(0)} °C)`);
    const thermalNote = `Termowizja: ${parts.join(' + ')}, ${c.frames} klatek z różnych pozycji, rozmiar ${extent.toFixed(1)} m`;
    const reasons: string[] = [];
    if (sizeFactor < 1) reasons.push('Duża ciepła powierzchnia — możliwe nagrzane podłoże lub kilka osób');
    if (nearBase(x, y)) {
      pT *= 0.3;
      reasons.push('Blisko miejsca startu drona w nagraniu — możliwe, że to ratownicy');
    }
    // powierzchnia przy źródle ciepła (bez koron murów i nawisów nad nim)
    const below = surfaceBelow ? surfaceBelow(x, y, c.centroid[2] + 0.5) : NaN;
    const surf = Number.isNaN(below) ? sampleHeight(hm, x, y) : below;
    const a = acousticSupport([x, y, surf], acoustic);
    hs.push({
      id: '', kind: 'fused', label: 'Potencjalne miejsce osoby',
      position: [x, y, surf], sourceZ: c.centroid[2],
      radius: Math.max(0.5, Math.min(3, extent / 2)),
      confidence: 0,
      evidence: { thermal: pT, acoustic: a.score, manual: 0 },
      reasons, firstSeen: c.firstSeen, views: c.frames, maxTempK: c.maxTempK, bestFrame: c.bestFrame || null,
      radarCandidate: true, thermalNote, acousticNote: a.note,
    });
  }

  // dobrze zlokalizowane źródła dźwięku bez anomalii cieplnej → osobny hot spot (osoba może być głębiej)
  const zones: AcousticSource[] = [];
  for (const s of acoustic?.sources ?? []) {
    const covered = hs.some(h => Math.hypot(h.position[0] - s.position[0], h.position[1] - s.position[1]) <= Math.max(s.radius, 3));
    if (covered) continue;
    if (s.radius <= params.maxAcousticRadiusForHotspot && inArea(s.position[0], s.position[1])) {
      const [x, y] = s.position;
      const surf = sampleHeight(hm, x, y);
      const a = acousticSupport([x, y, surf], acoustic);
      hs.push({
        id: '', kind: 'fused', label: 'Potencjalne miejsce osoby',
        position: [x, y, surf], sourceZ: null, radius: s.radius,
        confidence: 0,
        evidence: { thermal: 0, acoustic: Math.max(a.score, 0.4), manual: 0 },
        reasons: [], firstSeen: s.tFirst, views: s.events, maxTempK: null, bestFrame: null, radarCandidate: true,
        thermalNote: 'Termowizja: brak anomalii — osoba może być głębiej pod gruzem',
        acousticNote: a.note,
      });
    } else {
      zones.push(s);
    }
  }

  for (const h of hs) {
    h.confidence = combineEvidence(h);
    h.radarCandidate = h.confidence >= params.radarMinConfidence;
  }
  hs.sort((a, b) => b.confidence - a.confidence);
  hs.forEach((h, i) => (h.id = `H${i + 1}`));
  return { hotspots: hs, acousticZones: zones };
}

export function combineEvidence(h: Hotspot): number {
  const e = h.evidence;
  return 1 - (1 - e.thermal) * (1 - e.acoustic) * (1 - e.manual);
}

export function describeAcoustic(s: AcousticSource): string {
  const what = s.kind === 'tone' ? `Ton ${s.freqHz.toFixed(0)} Hz (telefon/alarm)` : s.kind === 'voice' ? `Głos (f0 ≈ ${s.freqHz.toFixed(0)} Hz)` : 'Stuki / trzaski szerokopasmowe';
  return `Mikrofon: ${what}, ${s.events} detekcji, SNR do ${s.snrMaxDb.toFixed(0)} dB, lokalizacja ±${s.radius.toFixed(0)} m`;
}
