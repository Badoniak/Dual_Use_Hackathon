// Wspólne typy przetwarzania danych z symulacji.
// Układ lokalny: ENU w metrach (x = wschód, y = północ, z = góra), jak `earth` w Gazebo.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Bounds3D extends Bounds2D {
  minZ: number;
  maxZ: number;
}

export interface Trajectory {
  /** czas symulacji [s] */
  t: Float64Array;
  /** pozycje xyz, 3 * n */
  pos: Float32Array;
  /** kwaterniony xyzw, 4 * n */
  quat: Float32Array;
}

export interface PointCloud {
  positions: Float32Array; // 3 * count
  colors: Uint8Array; // 3 * count
  count: number;
}

export interface CameraIntrinsics {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

export interface FramePose {
  file: string;
  stamp: number;
  pos: Vec3;
  quat: Quat;
}

export interface GpsFix {
  t: number;
  lat: number;
  lon: number;
  alt: number;
}

export type SoundSourceType = 'voice' | 'tone' | 'crackle';

export interface SoundSourceGT {
  name: string;
  type: SoundSourceType;
  xyz: Vec3;
  amplitude: number;
  f0?: number;
  period?: number;
  duration?: number;
}

export interface WavData {
  sampleRate: number;
  channels: number;
  /** próbki przeplatane, int16 */
  samples: Int16Array;
  frames: number;
}

/** Zakotwiczenie układu lokalnego na mapie: (0,0) lokalne = (lat0, lon0). */
export interface GeoAnchor {
  lat0: number;
  lon0: number;
  /** 'gps' — georeferencja z GPS drona; 'anchored' — dane przeniesione na obszar wybrany przez operatora */
  mode: 'gps' | 'anchored';
}

/** 'fused' — potencjalne miejsce osoby z fuzji termowizji i mikrofonu; 'manual' — wskazane przez ratownika */
export type HotspotKind = 'fused' | 'manual';

export interface HotspotEvidence {
  thermal: number; // 0..1
  acoustic: number; // 0..1
  manual: number; // 0..1
}

export interface Hotspot {
  id: string;
  kind: HotspotKind;
  label: string;
  /** środek hotspotu na powierzchni (z = wysokość powierzchni z lidaru) */
  position: Vec3;
  /** wysokość źródła ciepła/dźwięku (z) jeśli znana */
  sourceZ: number | null;
  /** niepewność pozioma [m] */
  radius: number;
  confidence: number;
  evidence: HotspotEvidence;
  reasons: string[];
  firstSeen: number | null;
  views: number;
  maxTempK: number | null;
  /** klatka termowizji, na której obiekt był najlepiej widoczny */
  bestFrame: string | null;
  radarCandidate: boolean;
  /** opis składowej termowizji i mikrofonu (zawsze obie) */
  thermalNote: string;
  acousticNote: string;
}

export interface LandingSite {
  id: string;
  hotspotId: string;
  position: Vec3;
  slopeDeg: number;
  roughness: number;
  /** odległość 3D od hot spotu [m] (liczy się dla tłumienia radaru) */
  distance: number;
  /** odległość w poziomie [m] (widoczna na mapie) */
  horizontal: number;
  bearingDeg: number;
  score: number;
  /** 'land' — dron ląduje (wariant L); 'probe' — sonda opuszczana na lince z zawisu (wariant T) */
  method: 'land' | 'probe';
}

export interface AcousticEvent {
  t: number;
  kind: 'tone' | 'voice' | 'broadband';
  freqHz: number;
  snrDb: number;
  dronePos: Vec3;
}

export interface AcousticSource {
  id: string;
  kind: 'tone' | 'voice' | 'broadband';
  freqHz: number;
  position: Vec3;
  radius: number;
  snrMaxDb: number;
  events: number;
  tFirst: number;
  tLast: number;
}

export interface VitalDetection {
  detected: boolean;
  confidence: number;
  breathingHz: number | null;
  heartHz: number | null;
  breathingSnrDb: number;
  heartSnrDb: number;
  disturbed: boolean;
}

export interface VictimEstimate {
  hotspotId: string;
  position: Vec3;
  surfaceZ: number;
  depthBest: number;
  depthMin: number;
  depthMax: number;
  epsBest: number;
  epsMin: number;
  epsMax: number;
  horizontalErr: number;
  rmsResidual: number;
  nMeasurements: number;
}
