import { create } from 'zustand';
import { centroid, circle } from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import { fitGpsAnchor, lngLatToLocal, localToLngLat, M_PER_DEG_LAT, mPerDegLon, pointInPolygon, polygonArea } from '../sim/geo';
import { sampleHeight } from '../sim/grid';
import { combineEvidence } from '../sim/fusion';
import { planCoverage, scanTimeField, type FlightPlan } from '../sim/flightPlan';
import { DEFAULT_LANDING_PARAMS, findLandingSites } from '../sim/landing';
import { clusterRadarDetections, hotspotsNear, type FusionOptions } from '../sim/radarFusion';
import type { HeightMap } from '../sim/grid';
import { maxDetectionRange, DEFAULT_RADAR_PARAMS } from '../sim/radar';
import { parseGps, parseTrajectory } from '../sim/parse';
import { DEFAULT_SCENARIO, victimsFromGroundTruth, type RadarScenarioConfig, type SimVictim, type SiteMeasurement } from '../sim/scenario';
import type { ScoutResult } from '../sim/pipeline';
import type { GeoAnchor, Hotspot, LandingSite, Vec3, VictimEstimate } from '../sim/types';
import { startScoutProcessing, cancelScoutProcessing } from '../engine/scoutService';
import { useDroneStore } from './useDroneStore';
import { useLogStore } from './useLogStore';

export const SIM_DATA_URL = '/sim-data/';

export type MissionPhase = 'planning' | 'scouting' | 'analysis' | 'radar' | 'complete';
export type DrawMode = 'none' | 'polygon' | 'rectangle' | 'lkp' | 'manual-hotspot' | 'sim-victim';

export interface MissionArea {
  id: string;
  name: string;
  feature: Feature<Polygon>;
  areaM2: number;
  source: 'polygon' | 'rectangle' | 'lkp' | 'preset';
  lkp?: { lng: number; lat: number; radiusM: number };
}

export interface ProcessingState {
  status: 'idle' | 'running' | 'done' | 'error';
  stage: string;
  pct: number;
  message: string;
}

export interface RadarDetection {
  id: string;
  /** najbliższy hot spot */
  hotspotId: string;
  /** hot spoty w promieniu 5 m od osoby */
  hotspotIds: string[];
  /** punkty pomiaru, które wykryły tę osobę */
  siteIds: string[];
  vital: boolean;
  confidence: number;
  local: Vec3;
  lng: number;
  lat: number;
  surfaceZ: number | null;
  estimate: VictimEstimate | null;
  breathingHz: number | null;
  heartHz: number | null;
  nDetected: number;
  nMeasured: number;
  disturbed: number;
  status: 'pending' | 'confirmed' | 'rejected';
  simTime: number;
  note: string;
  /** trwają pomiary w pobliżu (wynik może się jeszcze zmienić) */
  refining: boolean;
}

export interface ScoutTrack {
  /** plan lotu pokrycia nad wybranym obszarem (układ lokalny) */
  plan: FlightPlan;
  startSim: number;
}

/** Chmura punktów wybranego obszaru z czasem zeskanowania każdego punktu (narasta w trakcie lotu). */
export interface ScanCloud {
  positions: Float32Array;
  colors: Uint8Array;
  temps: Float32Array | null;
  scanTimes: Float32Array;
  count: number;
  /** punkty [0, nLidar) — lidar, [nLidar, count) — kamera RGB-D */
  nLidar: number;
}

export type CloudSource = 'both' | 'lidar' | 'rgbd';

/** Zakres punktów (początek, liczba) dla wybranego czujnika — chmura jest ułożona blokami [lidar][RGB-D]. */
export function sourceRange(src: CloudSource, count: number, nLidar: number): [number, number] {
  if (src === 'lidar') return [0, nLidar];
  if (src === 'rgbd') return [nLidar, count - nLidar];
  return [0, count];
}

export interface MapLayerToggles {
  /** chmura 3D ze skanu na mapie */
  cloud: 'rgb' | 'height' | 'thermal' | 'none';
  /** czujnik: lidar, kamera RGB-D albo oba */
  cloudSource: CloudSource;
  /** dodatkowo ortofoto 2D (widok z góry) */
  ortho: 'rgb' | 'thermal' | 'none';
  audibility: boolean;
  zones: boolean;
  landing: boolean;
  trails: boolean;
  victimsTruth: boolean;
}

interface MissionState {
  areas: MissionArea[];
  activeAreaId: string | null;
  drawMode: DrawMode;
  lkpRadiusM: number;
  anchor: GeoAnchor | null;
  phase: MissionPhase;
  processing: ProcessingState;
  scoutTrack: ScoutTrack | null;
  /** wysokość lotu zwiadowcy [m] — wyznacza szerokość pasa i liczbę linii */
  flightAltitude: number;
  scan: ScanCloud | null;
  /** czas zeskanowania (od startu lotu) każdego hot spotu */
  hotspotScanTime: Record<string, number>;
  /** hot spoty już "zauważone" przez przelatującego zwiadowcę */
  revealed: string[];
  baseLocal: Vec3 | null;
  result: ScoutResult | null;
  hotspots: Hotspot[];
  landingSites: LandingSite[];
  measurements: SiteMeasurement[];
  detections: RadarDetection[];
  simVictims: SimVictim[];
  simVictimsEdited: boolean;
  victimDepthM: number;
  scenario: RadarScenarioConfig;
  radarQueue: string[];
  /** hot spoty mierzone w pierwszej kolejności (decyzja dowódcy) */
  priorityHotspots: string[];
  selectedHotspotId: string | null;
  viewerOpen: boolean;
  viewerFocus: string | null;
  mapLayers: MapLayerToggles;
  flyToTrigger: { lng: number; lat: number; zoom: number; n: number } | null;

  setDrawMode: (m: DrawMode) => void;
  setFlightAltitude: (h: number) => void;
  revealHotspots: (elapsed: number) => void;
  setLkpRadius: (r: number) => void;
  addArea: (feature: Feature<Polygon>, source: MissionArea['source'], meta?: Partial<MissionArea>) => string;
  updateAreaGeometry: (id: string, feature: Feature<Polygon>) => void;
  addLkpArea: (lng: number, lat: number, radiusM?: number) => void;
  updateLkpRadius: (id: string, radiusM: number) => void;
  removeArea: (id: string) => void;
  clearAreas: () => void;
  setActiveArea: (id: string) => void;
  flyTo: (lng: number, lat: number, zoom?: number) => void;

  launchScout: () => Promise<void>;
  skipScoutFlight: () => void;
  onScoutFlightDone: () => void;

  selectHotspot: (id: string | null) => void;
  toggleRadarCandidate: (id: string) => void;
  addManualHotspot: (lng: number, lat: number) => void;
  removeHotspot: (id: string) => void;

  launchRadar: () => void;
  takeRadarTask: (from: Vec3) => LandingSite | null;
  returnRadarTask: (siteId: string) => void;
  prioritizeHotspot: (id: string) => void;
  addMeasurement: (m: SiteMeasurement) => void;
  remeasureHotspot: (id: string) => void;
  refineDetection: (id: string) => number;
  setDetectionStatus: (id: string, status: RadarDetection['status']) => void;

  addSimVictim: (lng: number, lat: number, depthM: number) => void;
  removeSimVictim: (id: string) => void;
  placeVictimsAtHotspots: (n: number, depthM: number) => void;
  setVictimDepth: (d: number) => void;
  resetSimVictims: () => void;
  setScenario: (patch: Partial<RadarScenarioConfig>) => void;

  openViewer: (focus?: string | null) => void;
  closeViewer: () => void;
  setMapLayers: (patch: Partial<MapLayerToggles>) => void;
  resetMission: (keepAreas?: boolean) => void;
}

const log = (msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info', source: 'SYSTEM' | 'DRON' | 'DOWÓDCA' = 'SYSTEM') =>
  useLogStore.getState().addLog(msg, type, source);

let areaCounter = 0;
let manualCounter = 0;
let victimCounter = 0;
let detCounter = 0;

const emptyProcessing: ProcessingState = { status: 'idle', stage: '', pct: 0, message: '' };

const missionReset = {
  anchor: null,
  phase: 'planning' as MissionPhase,
  processing: emptyProcessing,
  scoutTrack: null,
  scan: null,
  hotspotScanTime: {},
  revealed: [],
  baseLocal: null,
  result: null,
  hotspots: [],
  landingSites: [],
  measurements: [],
  detections: [],
  radarQueue: [],
  priorityHotspots: [],
  selectedHotspotId: null,
  viewerFocus: null,
};

export function areaCentroid(a: MissionArea): [number, number] {
  const c = centroid(a.feature).geometry.coordinates;
  return [c[0], c[1]];
}

export const useMissionStore = create<MissionState>((set, get) => ({
  areas: [],
  activeAreaId: null,
  drawMode: 'none',
  lkpRadiusM: 40,
  ...missionReset,
  simVictims: [],
  simVictimsEdited: false,
  victimDepthM: 1.5,
  scenario: { ...DEFAULT_SCENARIO },
  viewerOpen: false,
  mapLayers: { cloud: 'rgb', cloudSource: 'both', ortho: 'none', audibility: false, zones: true, landing: true, trails: true, victimsTruth: false },
  flyToTrigger: null,

  setDrawMode: m => set({ drawMode: m }),
  flightAltitude: 30,
  setFlightAltitude: h => set({ flightAltitude: h }),

  revealHotspots: elapsed => {
    const s = get();
    if (s.processing.status !== 'done') return;
    const fresh = s.hotspots.filter(h => !s.revealed.includes(h.id) && (s.hotspotScanTime[h.id] ?? Infinity) <= elapsed);
    if (!fresh.length) return;
    set({ revealed: [...s.revealed, ...fresh.map(h => h.id)] });
    for (const h of fresh) {
      log(`Zwiadowca: potencjalne miejsce osoby ${h.id} — termowizja ${(h.evidence.thermal * 100).toFixed(0)}%, mikrofon ${(h.evidence.acoustic * 100).toFixed(0)}%.`, 'warning', 'DRON');
    }
  },
  setLkpRadius: r => set({ lkpRadiusM: r }),

  addArea: (feature, source, meta) => {
    const id = `area-${++areaCounter}`;
    const ring = feature.geometry.coordinates[0] as [number, number][];
    const a0 = { lat0: ring[0][1], lon0: ring[0][0], mode: 'gps' as const };
    const areaM2 = polygonArea(ring.map(([lng, lat]) => lngLatToLocal(a0, lng, lat)));
    const area: MissionArea = { id, name: `Obszar ${areaCounter}`, feature: { ...feature, id }, areaM2, source, ...meta };
    set(s => ({ areas: [...s.areas, area], activeAreaId: id }));
    log(`Wyznaczono ${area.name}: ${(areaM2 / 10000).toFixed(2)} ha (${source === 'lkp' ? 'LKP + promień' : source === 'rectangle' ? 'prostokąt' : source === 'preset' ? 'scenariusz' : 'wielokąt'}).`, 'info', 'DOWÓDCA');
    return id;
  },

  updateAreaGeometry: (id, feature) => {
    const ring = feature.geometry.coordinates[0] as [number, number][];
    const a0 = { lat0: ring[0][1], lon0: ring[0][0], mode: 'gps' as const };
    const areaM2 = polygonArea(ring.map(([lng, lat]) => lngLatToLocal(a0, lng, lat)));
    set(s => ({ areas: s.areas.map(a => (a.id === id ? { ...a, feature: { ...feature, id }, areaM2 } : a)) }));
  },

  addLkpArea: (lng, lat, radiusM) => {
    const r = radiusM ?? get().lkpRadiusM;
    const c = circle([lng, lat], r / 1000, { steps: 48, units: 'kilometers' }) as Feature<Polygon>;
    get().addArea(c, 'lkp', { lkp: { lng, lat, radiusM: r } });
    set({ drawMode: 'none' });
  },

  updateLkpRadius: (id, radiusM) => {
    const a = get().areas.find(x => x.id === id);
    if (!a?.lkp) return;
    const c = circle([a.lkp.lng, a.lkp.lat], radiusM / 1000, { steps: 48, units: 'kilometers' }) as Feature<Polygon>;
    set(s => ({ areas: s.areas.map(x => (x.id === id ? { ...x, feature: { ...c, id }, lkp: { ...a.lkp!, radiusM }, areaM2: Math.PI * radiusM * radiusM } : x)) }));
  },

  removeArea: id => set(s => {
    const areas = s.areas.filter(a => a.id !== id);
    return { areas, activeAreaId: s.activeAreaId === id ? areas[areas.length - 1]?.id ?? null : s.activeAreaId };
  }),

  clearAreas: () => set({ areas: [], activeAreaId: null }),
  setActiveArea: id => set({ activeAreaId: id }),
  flyTo: (lng, lat, zoom = 18) => set(s => ({ flyToTrigger: { lng, lat, zoom, n: (s.flyToTrigger?.n ?? 0) + 1 } })),

  launchScout: async () => {
    const s = get();
    const area = s.areas.find(a => a.id === s.activeAreaId);
    if (!area) {
      log('Najpierw wyznacz obszar działań na mapie.', 'warning');
      return;
    }
    if (s.phase === 'scouting') return;
    cancelScoutProcessing();
    refined.clear();
    set({ ...missionReset, processing: { status: 'running', stage: 'telemetria', pct: 0, message: 'Łączenie ze zwiadowcą…' } });
    useDroneStore.getState().resetFleet();
    try {
      const [trText, gpsText] = await Promise.all([
        fetch(SIM_DATA_URL + 'trajectory.csv').then(r => { if (!r.ok) throw new Error(`trajectory.csv: HTTP ${r.status}`); return r.text(); }),
        fetch(SIM_DATA_URL + 'gps/gps.csv').then(r => { if (!r.ok) throw new Error(`gps.csv: HTTP ${r.status}`); return r.text(); }),
      ]);
      const tr = parseTrajectory(trText);
      const gpsFit = fitGpsAnchor(parseGps(gpsText), tr);
      let cx0 = Infinity, cx1 = -Infinity, cy0 = Infinity, cy1 = -Infinity;
      for (let i = 0; i < tr.t.length; i++) {
        cx0 = Math.min(cx0, tr.pos[3 * i]); cx1 = Math.max(cx1, tr.pos[3 * i]);
        cy0 = Math.min(cy0, tr.pos[3 * i + 1]); cy1 = Math.max(cy1, tr.pos[3 * i + 1]);
      }
      const trC: [number, number] = [(cx0 + cx1) / 2, (cy0 + cy1) / 2];
      const gpsAnchor: GeoAnchor = { lat0: gpsFit.lat0, lon0: gpsFit.lon0, mode: 'gps' };
      const [tlng, tlat] = localToLngLat(gpsAnchor, trC[0], trC[1]);
      const ring = area.feature.geometry.coordinates[0] as [number, number][];
      const [clng, clat] = areaCentroid(area);
      // Dron zawsze leci nad wybrany obszar. Skan (sesja Gazebo) jest zakotwiczony w środku obszaru;
      // jeśli obszar obejmuje prawdziwe miejsce z symulacji — używamy georeferencji z GPS drona.
      let anchor: GeoAnchor;
      if (pointInPolygon(tlng, tlat, ring)) {
        anchor = gpsAnchor;
        log(`Obszar obejmuje miejsce z symulacji — georeferencja z GPS drona (średni błąd ${gpsFit.residualM.toFixed(1)} m).`, 'info');
      } else {
        anchor = { lat0: clat - trC[1] / M_PER_DEG_LAT, lon0: clng - trC[0] / mPerDegLon(clat), mode: 'anchored' };
      }
      const areaLocal = ring.map(([lng, lat]) => lngLatToLocal(anchor, lng, lat));
      const plan = planCoverage(areaLocal, { altitude: s.flightAltitude });
      const simTime = useDroneStore.getState().simTime;
      set({ anchor, phase: 'scouting', scoutTrack: { plan, startSim: simTime }, baseLocal: plan.base });
      useDroneStore.getState().updateDrone('scout-1', { status: 'scanning', pos: [...plan.base] as Vec3, trail: [], battery: 100, phaseStartedAt: simTime });
      log(`Start zwiadowcy nad „${area.name}”: ${plan.lines} linii przelotu na ${plan.altitude} m, pas termowizji ${plan.swath.toFixed(0)} m, trasa ${plan.lengthM.toFixed(0)} m, ~${Math.round(plan.duration)} s.`, 'info', 'DOWÓDCA');
      if (area.areaM2 > 40000) log(`Obszar ${(area.areaM2 / 10000).toFixed(1)} ha jest większy niż zasięg danych skanu z symulacji (~1 ha) — poza nim mapa 3D będzie pusta.`, 'warning');

      let scanField: ((x: number, y: number) => number) | null = null;
      startScoutProcessing(SIM_DATA_URL, { areaLocal }, {
        onProgress: (stage, pct, message) => set({ processing: { status: 'running', stage, pct, message } }),
        onCloud: c => {
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
          for (let i = 0; i < c.count; i++) {
            x0 = Math.min(x0, c.positions[3 * i]); x1 = Math.max(x1, c.positions[3 * i]);
            y0 = Math.min(y0, c.positions[3 * i + 1]); y1 = Math.max(y1, c.positions[3 * i + 1]);
          }
          const field = scanTimeField(plan, { minX: x0 - 1, minY: y0 - 1, maxX: x1 + 1, maxY: y1 + 1 });
          scanField = field;
          const scanTimes = new Float32Array(c.count);
          for (let i = 0; i < c.count; i++) scanTimes[i] = Math.min(1e9, field(c.positions[3 * i], c.positions[3 * i + 1]));
          set({ scan: { positions: c.positions, colors: c.colors, temps: null, scanTimes, count: c.count, nLidar: c.nLidar } });
        },
        onResult: result => {
          const victims = get().simVictimsEdited ? get().simVictims : victimsFromGroundTruth(result.groundTruth);
          const hotspotScanTime: Record<string, number> = {};
          for (const h of result.hotspots) hotspotScanTime[h.id] = scanField ? scanField(h.position[0], h.position[1]) : 0;
          set(st => ({
            result,
            hotspots: result.hotspots,
            landingSites: result.landingSites,
            simVictims: victims,
            hotspotScanTime,
            scan: st.scan ? { ...st.scan, temps: result.cloud.temps } : st.scan,
            processing: { status: 'done', stage: 'gotowe', pct: 100, message: `${result.hotspots.length} potencjalnych miejsc, ${result.landingSites.length} lądowisk` },
          }));
          const t = result.stats.timingsMs;
          log(`Przetworzono dane zwiadowcy: mapa 3D obszaru — lidar ${result.stats.lidarPoints.toLocaleString('pl-PL')} pkt + kamera RGB-D ${result.stats.rgbdPoints.toLocaleString('pl-PL')} pkt (${result.stats.rgbdFrames} map głębi), ${result.stats.thermalFramesUsed} klatek termowizji, ${result.stats.audioSeconds.toFixed(0)} s audio (${Object.values(t).reduce((a, b) => a + b, 0)} ms).`, 'success');
          if (get().scoutTrack && useDroneStore.getState().drones.find(d => d.id === 'scout-1')?.status === 'base') get().onScoutFlightDone();
        },
        onError: message => {
          set({ processing: { status: 'error', stage: 'błąd', pct: 0, message } });
          log(`Błąd przetwarzania danych zwiadowcy: ${message}`, 'error');
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ phase: 'planning', processing: { status: 'error', stage: 'błąd', pct: 0, message } });
      log(`Nie udało się pobrać danych z symulacji (${message}). Czy folder dane_z_symulacji istnieje?`, 'error');
    }
  },

  skipScoutFlight: () => {
    const tr = get().scoutTrack;
    if (!tr) return;
    const now = useDroneStore.getState().simTime;
    set({ scoutTrack: { ...tr, startSim: now - tr.plan.duration } });
  },

  onScoutFlightDone: () => {
    const s = get();
    if (s.phase !== 'scouting') return;
    if (s.processing.status !== 'done') return; // wyniki pojawią się po zakończeniu przetwarzania
    set({ phase: 'analysis', revealed: s.hotspots.map(h => h.id) });
    const n = s.hotspots.filter(h => h.radarCandidate).length;
    log(`Mapa 3D obszaru gotowa. Potencjalne miejsca osób: ${s.hotspots.length} (do pomiaru radarem: ${n}), miejsca lądowania: ${s.landingSites.length}. Każde trafienie wymaga zatwierdzenia przez ratownika.`, 'success');
  },

  selectHotspot: id => set({ selectedHotspotId: id }),

  toggleRadarCandidate: id => {
    const s = get();
    const h = s.hotspots.find(x => x.id === id);
    if (!h || !s.result) return;
    const on = !h.radarCandidate;
    let sites = s.landingSites;
    if (on && !sites.some(x => x.hotspotId === id)) {
      const found = findLandingSites(s.result.heightmap, h);
      sites = [...sites, ...found];
      if (found.length < 3) log(`${id}: tylko ${found.length} bezpieczne miejsca lądowania — rozważ sondę na lince (wariant T).`, 'warning');
    }
    set({ hotspots: s.hotspots.map(x => (x.id === id ? { ...x, radarCandidate: on } : x)), landingSites: sites });
  },

  addManualHotspot: (lng, lat) => {
    const s = get();
    if (!s.anchor || !s.result) {
      log('Ręczny hot spot wymaga mapy 3D z fazy 1.', 'warning');
      return;
    }
    const [x, y] = lngLatToLocal(s.anchor, lng, lat);
    const z = sampleHeight(s.result.heightmap, x, y);
    if (Number.isNaN(z)) {
      log('Brak danych lidaru w tym miejscu — wskaż punkt w obszarze zeskanowanym przez zwiadowcę.', 'warning');
      return;
    }
    const id = `R${++manualCounter}`;
    const h: Hotspot = {
      id, kind: 'manual', label: 'Zgłoszenie ratownika', position: [x, y, z], sourceZ: null, radius: 1.5,
      confidence: 0, evidence: { thermal: 0, acoustic: 0, manual: 0.5 },
      reasons: ['Wskazany ręcznie przez ratownika (np. stukanie, relacja świadka)'],
      firstSeen: null, views: 0, maxTempK: null, bestFrame: null, radarCandidate: true,
      thermalNote: 'Termowizja: nie dotyczy (wskazanie ratownika)', acousticNote: 'Mikrofon: nie dotyczy (wskazanie ratownika)',
    };
    h.confidence = combineEvidence(h);
    const sites = findLandingSites(s.result.heightmap, h);
    set({ hotspots: [...s.hotspots, h], landingSites: [...s.landingSites, ...sites], selectedHotspotId: id, drawMode: 'none', revealed: [...s.revealed, id] });
    log(`Dodano ręczny hot spot ${id} (${sites.length} miejsc lądowania).`, 'info', 'DOWÓDCA');
    if (s.phase === 'radar') set(st => ({ radarQueue: [...st.radarQueue, ...sites.map(x => x.id)] }));
  },

  removeHotspot: id => set(s => ({
    hotspots: s.hotspots.filter(h => h.id !== id),
    landingSites: s.landingSites.filter(l => l.hotspotId !== id),
    radarQueue: s.radarQueue.filter(q => !q.startsWith(id + '-')),
    selectedHotspotId: s.selectedHotspotId === id ? null : s.selectedHotspotId,
  })),

  launchRadar: () => {
    const s = get();
    if (!s.result) return;
    const measured = new Set(s.measurements.map(m => m.siteId));
    const candidates = new Set(s.hotspots.filter(h => h.radarCandidate).map(h => h.id));
    const queue = s.landingSites.filter(l => candidates.has(l.hotspotId) && !measured.has(l.id)).map(l => l.id);
    if (queue.length === 0) {
      log('Brak miejsc lądowania do pomiaru — zaznacz hot spoty do pomiaru radarem.', 'warning');
      return;
    }
    set({ phase: 'radar', radarQueue: queue });
    const range = maxDetectionRange({ ...DEFAULT_RADAR_PARAMS, attenuationDbPerM: s.scenario.attenuationDbPerM });
    log(`Faza 2: ${queue.length} punktów pomiaru przy ${candidates.size} hot spotach. Drony lądują i mierzą ${s.scenario.measureS} s (zasięg radaru przy ${s.scenario.attenuationDbPerM} dB/m: ~${range.toFixed(1)} m). Obowiązuje cisza radarowa.`, 'info', 'DOWÓDCA');
  },

  takeRadarTask: from => {
    const s = get();
    if (s.radarQueue.length === 0) return null;
    // przydział zachłanny: najbliższy punkt, najpierw z hot spotów priorytetowych
    const sites = s.radarQueue.map(id => s.landingSites.find(l => l.id === id)).filter((l): l is LandingSite => !!l);
    const prio = s.priorityHotspots.find(h => sites.some(l => l.hotspotId === h));
    const pool = prio ? sites.filter(l => l.hotspotId === prio) : sites;
    let best: LandingSite | null = null, bd = Infinity;
    for (const site of pool) {
      const d = Math.hypot(site.position[0] - from[0], site.position[1] - from[1]);
      if (d < bd) { bd = d; best = site; }
    }
    if (best) set({ radarQueue: s.radarQueue.filter(q => q !== best!.id) });
    return best;
  },

  returnRadarTask: siteId => set(s => (s.radarQueue.includes(siteId) || s.measurements.some(m => m.siteId === siteId) ? {} : { radarQueue: [siteId, ...s.radarQueue] })),

  prioritizeHotspot: id => {
    set(s => ({ priorityHotspots: [id, ...s.priorityHotspots.filter(x => x !== id)] }));
    log(`Priorytet pomiaru: ${id} — najbliższe wolne drony polecą najpierw tutaj.`, 'info', 'DOWÓDCA');
  },

  addMeasurement: m => {
    set(s => ({ measurements: [...s.measurements.filter(x => x.siteId !== m.siteId), m] }));
    const s = get();
    const d = m.detection;
    log(d.detected
      ? `[${m.siteId}] Oznaki życia: oddech ${(d.breathingHz! * 60).toFixed(0)}/min${d.heartHz ? `, tętno ${(d.heartHz * 60).toFixed(0)}/min` : ''} (ufność ${(d.confidence * 100).toFixed(0)}%)${d.disturbed ? ' — zakłócenie w wiązce!' : ''}.`
      : `[${m.siteId}] Brak oznak życia${d.disturbed ? ' (ruch w wiązce — naruszona cisza radarowa)' : ''}.`, d.detected ? 'success' : 'info', 'DRON');
    void s;
    recomputeDetections();
  },

  remeasureHotspot: id => {
    const s = get();
    const sites = s.landingSites.filter(l => l.hotspotId === id).map(l => l.id);
    set({
      measurements: s.measurements.filter(m => m.hotspotId !== id),
      radarQueue: [...s.radarQueue.filter(q => !sites.includes(q)), ...sites],
      phase: 'radar',
    });
    recomputeDetections();
    log(`Ponowny pomiar hot spotu ${id} (${sites.length} punktów).`, 'info', 'DOWÓDCA');
  },

  refineDetection: id => {
    const d = get().detections.find(x => x.id === id);
    if (!d) return 0;
    return refineAt(d.local, d.hotspotId);
  },

  setDetectionStatus: (id, status) => {
    set(s => ({ detections: s.detections.map(d => (d.id === id ? { ...d, status } : d)) }));
    const d = get().detections.find(x => x.id === id);
    if (d) log(`${status === 'confirmed' ? 'Zatwierdzono' : status === 'rejected' ? 'Odrzucono' : 'Cofnięto decyzję'}: ${d.vital ? 'oznaki życia' : 'brak oznak życia'} przy ${d.hotspotId}.`, status === 'confirmed' ? 'success' : 'info', 'DOWÓDCA');
  },

  addSimVictim: (lng, lat, depthM) => {
    const s = get();
    if (!s.anchor || !s.result) {
      log('Poszkodowanych do symulacji radaru można dodać po zakończeniu fazy 1.', 'warning');
      return;
    }
    const [x, y] = lngLatToLocal(s.anchor, lng, lat);
    const surf = sampleHeight(s.result.heightmap, x, y);
    if (Number.isNaN(surf)) return;
    const v: SimVictim = {
      id: `P${++victimCounter}`, name: `Poszkodowany operatora ${victimCounter}`, position: [x, y, surf - depthM],
      breathHz: 0.2 + Math.random() * 0.1, heartHz: 1.0 + Math.random() * 0.4, source: 'operator',
    };
    set({ simVictims: [...s.simVictims, v], simVictimsEdited: true, drawMode: 'none' });
    log(`Scenariusz: dodano zasypaną osobę ${v.id} na głębokości ${depthM.toFixed(1)} m (znana tylko symulatorowi radaru).`, 'info', 'SYSTEM');
  },

  removeSimVictim: id => set(s => ({ simVictims: s.simVictims.filter(v => v.id !== id), simVictimsEdited: true })),

  placeVictimsAtHotspots: (n, depthM) => {
    const s = get();
    if (!s.result) return;
    // pod hot spotami, z których lądowisk radar sięgnie do osoby (≥ 3 punkty w ~85% zasięgu)
    const range = maxDetectionRange({ ...DEFAULT_RADAR_PARAMS, attenuationDbPerM: s.scenario.attenuationDbPerM });
    const cands = s.hotspots
      .filter(h => h.radarCandidate)
      .filter(h => {
        const v: Vec3 = [h.position[0], h.position[1], h.position[2] - depthM];
        return s.landingSites.filter(l => l.hotspotId === h.id && Math.hypot(l.position[0] - v[0], l.position[1] - v[1], l.position[2] - v[2]) <= 0.85 * range).length >= 3;
      })
      .slice(0, n);
    if (cands.length < n) log(`Tylko ${cands.length} hot spot(y) mają lądowiska w zasięgu radaru od osoby na głębokości ${depthM.toFixed(1)} m.`, 'warning');
    const vs: SimVictim[] = cands.map(h => ({
      id: `P${++victimCounter}`, name: `Osoba pod ${h.id}`,
      position: [h.position[0], h.position[1], h.position[2] - depthM] as Vec3,
      breathHz: 0.2 + Math.random() * 0.1, heartHz: 1.0 + Math.random() * 0.4, source: 'operator' as const,
    }));
    set({ simVictims: [...s.simVictims, ...vs], simVictimsEdited: true });
    log(`Scenariusz: ${vs.length} zasypane osoby pod ${cands.map(h => h.id).join(', ')} (${depthM.toFixed(1)} m) — znane tylko symulatorowi radaru.`, 'info', 'SYSTEM');
  },
  setVictimDepth: d => set({ victimDepthM: d }),
  resetSimVictims: () => set(s => ({ simVictims: s.result ? victimsFromGroundTruth(s.result.groundTruth) : [], simVictimsEdited: false })),
  setScenario: patch => set(s => ({ scenario: { ...s.scenario, ...patch } })),

  openViewer: focus => set(s => ({ viewerOpen: true, viewerFocus: focus ?? null, selectedHotspotId: focus ?? s.selectedHotspotId })),
  closeViewer: () => set({ viewerOpen: false }),
  setMapLayers: patch => set(s => ({ mapLayers: { ...s.mapLayers, ...patch } })),

  resetMission: (keepAreas = true) => {
    cancelScoutProcessing();
    refined.clear();
    useDroneStore.getState().resetFleet();
    set(s => ({ ...missionReset, areas: keepAreas ? s.areas : [], activeAreaId: keepAreas ? s.activeAreaId : null, drawMode: 'none', simVictims: [], simVictimsEdited: false }));
  },
}));

/**
 * Głębokość liczymy od powierzchni gruzu przy hot spocie (nie od korony muru czy nawisu nad nim),
 * a jako prognozę wysokości osoby bierzemy poziom źródła ciepła najbliższego hot spotu.
 */
export function radarFusionOptions(hotspots: Hotspot[], hm: HeightMap): FusionOptions {
  const nearest = (x: number, y: number, r: number) => {
    let best: Hotspot | null = null, bd = r;
    for (const h of hotspots) { const d = Math.hypot(h.position[0] - x, h.position[1] - y); if (d < bd) { bd = d; best = h; } }
    return best;
  };
  return {
    surfaceFn: (x, y) => {
      const top = sampleHeight(hm, x, y);
      const h = nearest(x, y, 3);
      return h && (Number.isNaN(top) || top - h.position[2] > 1.5) ? h.position[2] : top;
    },
    priorZ: (x, y) => {
      const h = nearest(x, y, 4);
      return h ? (h.sourceZ ?? h.position[2] - 1) : null;
    },
  };
}

const refined = new Set<string>();
const refineKey = (p: Vec3) => `${Math.round(p[0] / 2)}:${Math.round(p[1] / 2)}`;

/** Dodatkowe punkty pomiaru bliżej miejsca, w którym radar wykrył oddech (pętla pomiarowa z koncepcji). */
function refineAt(center: Vec3, hotspotId: string): number {
  const s = useMissionStore.getState();
  const h = s.hotspots.find(x => x.id === hotspotId);
  if (!h || !s.result) return 0;
  refined.add(refineKey(center));
  const existing = s.landingSites.map(l => l.position);
  const found = findLandingSites(s.result.heightmap, { ...h, position: [center[0], center[1], h.position[2]] }, { ...DEFAULT_LANDING_PARAMS, minDist: 0.8, maxDist: 3.2, radiusSteps: [3.2], maxSites: 3, minSeparationDeg: 45, preferredDist: 1.3 }, existing, 1.0);
  const n0 = s.landingSites.filter(l => l.hotspotId === hotspotId).length;
  const extra = found.map((l, i) => ({ ...l, hotspotId, id: `${hotspotId}-${l.method === 'probe' ? 'T' : 'L'}${n0 + i + 1}` }));
  if (extra.length === 0) {
    log(`Przy ${hotspotId} brak dodatkowych bezpiecznych lądowisk — zalecana sonda na lince (wariant T).`, 'warning');
    return 0;
  }
  useMissionStore.setState(st => ({
    landingSites: [...st.landingSites, ...extra],
    radarQueue: [...st.radarQueue, ...extra.map(l => l.id)],
    phase: 'radar',
  }));
  log(`Dogęszczanie pomiaru przy ${hotspotId}: +${extra.length} punkty bliżej miejsca z detekcją oddechu.`, 'info', 'SYSTEM');
  return extra.length;
}

/**
 * Wyniki fazy 2 liczone od nowa po każdym pomiarze: detekcje ze wszystkich lądowisk są grupowane
 * w osoby (jedną osobę słyszy często kilka lądowisk różnych hot spotów), lokalizowane w 3D i
 * przypisywane do najbliższych hot spotów. Decyzje ratownika i identyfikatory są zachowywane.
 */
function recomputeDetections() {
  const s = useMissionStore.getState();
  if (!s.result || !s.anchor) return;
  const anchor = s.anchor;
  const hm = s.result.heightmap;
  const range = maxDetectionRange({ ...DEFAULT_RADAR_PARAMS, attenuationDbPerM: s.scenario.attenuationDbPerM });
  const hyps = clusterRadarDetections(s.measurements, hm, radarFusionOptions(s.hotspots, hm));
  const prev = s.detections;
  const used = new Set<string>();
  const out: RadarDetection[] = [];
  const now = useDroneStore.getState().simTime;
  const siteById = new globalThis.Map(s.landingSites.map(l => [l.id, l]));
  const inFlight = new Set(useDroneStore.getState().drones.map(d => d.taskSiteId).filter((x): x is string => !!x));
  const pendingNear = (p: Vec3) => [...s.radarQueue, ...inFlight].some(id => {
    const l = siteById.get(id);
    return l && !s.measurements.some(m => m.siteId === id) && Math.hypot(l.position[0] - p[0], l.position[1] - p[1]) <= range + 1;
  });
  const med = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : null);
  const refineRequests: { p: Vec3; h: string }[] = [];

  for (const hyp of hyps) {
    const p = hyp.position;
    const near = hotspotsNear(p, s.hotspots, 5);
    const primary = near[0]?.id ?? hyp.members[0].hotspotId;
    const memberIds = new Set(hyp.members.map(m => m.siteId));
    const heardBy = s.measurements.filter(m => memberIds.has(m.siteId) || Math.hypot(m.sitePos[0] - p[0], m.sitePos[1] - p[1]) <= range);
    const e = hyp.estimate;
    const n = hyp.members.length;
    let conf = 1 - hyp.members.reduce((acc, m) => acc * (1 - m.detection.confidence), 1);
    if (n === 1) conf *= 0.5; else if (n === 2) conf *= 0.8;
    const busy = pendingNear(p);
    if (!e && !busy && !refined.has(refineKey(p))) refineRequests.push({ p, h: primary });
    const match = prev.find(d => d.vital && !used.has(d.id) && Math.hypot(d.local[0] - p[0], d.local[1] - p[1]) < 2.5);
    if (match) used.add(match.id);
    const note = e
      ? `Oznaki życia w ${n}/${heardBy.length} punktach w zasięgu. Głębokość ${e.depthMin.toFixed(1)}–${e.depthMax.toFixed(1)} m (εr ${e.epsMin.toFixed(1)}–${e.epsMax.toFixed(1)}), położenie ±${e.horizontalErr.toFixed(1)} m.${busy ? ' Trwają kolejne pomiary.' : ''}`
      : `Oznaki życia w ${n}/${heardBy.length} punktach — za mało do lokalizacji 3D (potrzeba ≥ 3). ${busy ? 'Trwają kolejne pomiary.' : 'Zalecane dogęszczenie pomiaru.'}`;
    const [lng, lat] = localToLngLat(anchor, p[0], p[1]);
    out.push({
      id: match?.id ?? `D${++detCounter}`, hotspotId: primary, hotspotIds: near.map(h => h.id), siteIds: hyp.members.map(m => m.siteId),
      vital: true, confidence: Math.min(0.99, conf), local: p, lng, lat, surfaceZ: e?.surfaceZ ?? null, estimate: e,
      breathingHz: med(hyp.members.map(m => m.detection.breathingHz!).filter(Boolean)),
      heartHz: med(hyp.members.map(m => m.detection.heartHz).filter((v): v is number => v !== null)),
      nDetected: n, nMeasured: heardBy.length, disturbed: heardBy.filter(m => m.detection.disturbed).length,
      status: match?.status ?? 'pending', simTime: match?.simTime ?? now, note, refining: busy,
    });
    if (!match) log(`Radar: oznaki życia przy ${primary} — ${note}`, 'success', 'SYSTEM');
    else if (e && !match.estimate) log(`Lokalizacja 3D osoby (${primary}): głębokość ${e.depthMin.toFixed(1)}–${e.depthMax.toFixed(1)} m, ±${e.horizontalErr.toFixed(1)} m.`, 'success', 'SYSTEM');
  }

  // hot spoty, w których wszystkie punkty zmierzono i nikt nie oddycha w zasięgu
  for (const h of s.hotspots.filter(x => x.radarCandidate)) {
    const sites = s.landingSites.filter(l => l.hotspotId === h.id);
    if (!sites.length || !sites.every(l => s.measurements.some(m => m.siteId === l.id))) continue;
    if (out.some(d => d.vital && Math.hypot(d.local[0] - h.position[0], d.local[1] - h.position[1]) <= 3)) continue;
    const ms = s.measurements.filter(m => m.hotspotId === h.id);
    const match = prev.find(d => !d.vital && d.hotspotId === h.id);
    const [lng, lat] = localToLngLat(anchor, h.position[0], h.position[1]);
    const note = `Brak oznak życia w ${ms.length} punktach (zasięg radaru ~${range.toFixed(1)} m). Brak trafienia NIE oznacza braku ludzi — strefa pozostaje otwarta.`;
    out.push({
      id: match?.id ?? `D${++detCounter}`, hotspotId: h.id, hotspotIds: [h.id], siteIds: [], vital: false, confidence: 0,
      local: [...h.position] as Vec3, lng, lat, surfaceZ: null, estimate: null, breathingHz: null, heartHz: null,
      nDetected: 0, nMeasured: ms.length, disturbed: ms.filter(m => m.detection.disturbed).length,
      status: match?.status ?? 'pending', simTime: match?.simTime ?? now, note, refining: false,
    });
    if (!match) log(`${h.id}: ${note}`, 'info', 'SYSTEM');
  }
  useMissionStore.setState({ detections: out });
  for (const r of refineRequests) refineAt(r.p, r.h);
}
