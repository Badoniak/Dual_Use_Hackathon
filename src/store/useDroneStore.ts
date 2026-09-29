import { create } from 'zustand';
import type { Vec3 } from '../sim/types';

export type DroneRole = 'scout' | 'radar';

export type DroneStatus =
  | 'base' // w bazie, gotowy
  | 'scanning' // zwiadowca w locie (odtwarzanie trajektorii z symulacji)
  | 'takeoff'
  | 'transit'
  | 'landing'
  | 'measuring' // wylądował, silniki wyłączone, radar mierzy
  | 'returning'
  | 'charging'; // wymiana baterii w bazie

export interface Drone {
  id: string;
  name: string;
  role: DroneRole;
  status: DroneStatus;
  /** pozycja w układzie lokalnym misji (ENU, m); null gdy dron w bazie przed misją */
  pos: Vec3 | null;
  heading: number;
  speed: number;
  battery: number;
  trail: Vec3[];
  taskSiteId: string | null;
  /** czas symulacji zakończenia bieżącej fazy (start/lądowanie/pomiar/ładowanie) */
  phaseEndsAt: number;
  phaseStartedAt: number;
  sensors: string[];
  measurementsDone: number;
  /** dron dostępny do przydziału zadań (operator może wyłączyć pojedynczy dron) */
  enabled: boolean;
}

/** Status z uwzględnieniem wariantu T (sonda na lince z zawisu). */
export function statusLabel(d: Drone, probe: boolean): string {
  if (probe && d.status === 'landing') return 'Opuszczanie sondy';
  if (probe && d.status === 'measuring') return 'Pomiar sondą (zawis)';
  return STATUS_LABEL[d.status];
}

export const STATUS_LABEL: Record<DroneStatus, string> = {
  base: 'W bazie',
  scanning: 'Zwiad (lot)',
  takeoff: 'Start',
  transit: 'Przelot',
  landing: 'Lądowanie',
  measuring: 'Pomiar radarem',
  returning: 'Powrót do bazy',
  charging: 'Wymiana baterii',
};

const makeDrone = (id: string, name: string, role: DroneRole, sensors: string[]): Drone => ({
  id, name, role, status: 'base', pos: null, heading: 0, speed: 0, battery: 100, trail: [],
  taskSiteId: null, phaseEndsAt: 0, phaseStartedAt: 0, sensors, measurementsDone: 0, enabled: true,
});

export const initialFleet = (): Drone[] => [
  makeDrone('scout-1', 'Zwiadowca-1 (drone0)', 'scout', ['Lidar 3D', 'Kamera RGB-D', 'Kamera HD', 'Termowizja', 'Mikrofon', 'IMU / GPS / baro']),
  ...[1, 2, 3, 4].map(i => makeDrone(`radar-${i}`, `Radar-${i} (L)`, 'radar', ['Radar SFCW 0,5–3 GHz', 'Mikrofon i głośnik', 'Czujniki kontaktu w nogach'])),
];

interface DroneState {
  drones: Drone[];
  simTime: number;
  timeMultiplier: number;
  paused: boolean;
  setDrones: (drones: Drone[]) => void;
  updateDrone: (id: string, patch: Partial<Drone>) => void;
  setSimTime: (t: number) => void;
  setTimeMultiplier: (m: number) => void;
  setPaused: (p: boolean) => void;
  resetFleet: () => void;
}

export const useDroneStore = create<DroneState>(set => ({
  drones: initialFleet(),
  simTime: 0,
  timeMultiplier: 4,
  paused: false,
  setDrones: drones => set({ drones }),
  updateDrone: (id, patch) => set(s => ({ drones: s.drones.map(d => (d.id === id ? { ...d, ...patch } : d)) })),
  setSimTime: simTime => set({ simTime }),
  setTimeMultiplier: timeMultiplier => set({ timeMultiplier }),
  setPaused: paused => set({ paused }),
  resetFleet: () => set({ drones: initialFleet() }),
}));
