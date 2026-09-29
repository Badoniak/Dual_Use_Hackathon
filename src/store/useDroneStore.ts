import { create } from 'zustand';
import { useLogStore } from './useLogStore';

export type DetectionStatus = 'pending' | 'confirmed' | 'rejected';

export interface Detection {
  id: string;
  lng: number;
  lat: number;
  timestamp: number;
  confidence: number;
  status: DetectionStatus;
  type: 'person' | 'vehicle' | 'anomaly';
  droneId: string;
  sensor: string;
  imageUrl?: string;
}

export interface Telemetry {
  lng: number;
  lat: number;
  alt: number; // in meters
  heading: number; // degrees
  speed: number; // m/s
  battery: number; // percentage
}

export interface Drone {
  id: string;
  name: string;
  type: 'faza1' | 'faza2'; // Zwiadowca vs Radar
  isActive: boolean;
  telemetry: Telemetry | null;
  telemetryHistory: [number, number][];
  route: [number, number][];
  currentWaypoint: number;
  scanningTimer: number;
  sensors: string[];
  activeSensors: string[];
}

interface DroneState {
  drones: Drone[];
  timeMultiplier: number;
  showPath: boolean;
  detections: Detection[];
  
  launchDrones: (droneIds: string[], startLng: number, startLat: number, route: [number, number][]) => void;
  deactivateAll: () => void;
  updateDrone: (id: string, updates: Partial<Drone>) => void;
  updateDroneTelemetry: (id: string, updates: Partial<Telemetry>) => void;
  addDetection: (detection: Omit<Detection, 'id' | 'status' | 'timestamp'>) => void;
  updateDetectionStatus: (id: string, status: DetectionStatus) => void;
  setTimeMultiplier: (mul: number) => void;
  togglePath: () => void;
  toggleDroneSensor: (droneId: string, sensor: string) => void;
}

const initialDrones: Drone[] = [
  // Faza 1: 10 Dronów
  ...Array.from({ length: 10 }).map((_, i) => ({
    id: `f1_d${i+1}`,
    name: `Zwiadowca Alfa-${i+1}`,
    type: 'faza1' as const,
    isActive: false, telemetry: null, telemetryHistory: [], route: [], currentWaypoint: 0, scanningTimer: 0,
    sensors: ['Termowizja (IR)', 'Optyczny (RGB)', 'LIDAR'],
    activeSensors: []
  })),
  // Faza 2: 4 Drony
  ...Array.from({ length: 4 }).map((_, i) => ({
    id: `f2_d${i+1}`,
    name: `Radar GPR-${i+1}`,
    type: 'faza2' as const,
    isActive: false, telemetry: null, telemetryHistory: [], route: [], currentWaypoint: 0, scanningTimer: 0,
    sensors: ['Radar GPR (Penetrujący)', 'SAR (Odbiciowy)'],
    activeSensors: []
  }))
];

export const useDroneStore = create<DroneState>((set, get) => ({
  drones: initialDrones,
  timeMultiplier: 1,
  showPath: false,
  detections: [],

  launchDrones: (droneIds, startLng, startLat, route) => {
    set((state) => {
      const activeCount = droneIds.length;
      let chunks: [number, number][][] = [];
      
      // Dzielimy trasę (waypoints) równo na liczbę wybranych dronów
      if (activeCount > 0 && route.length > 0) {
        const chunkSize = Math.ceil(route.length / activeCount);
        for (let i = 0; i < route.length; i += chunkSize) {
          chunks.push(route.slice(i, i + chunkSize));
        }
      }

      let droneIndex = 0;

      useLogStore.getState().addLog(`Autoryzowano start floty: ${activeCount} dron(ów). Otrzymano przydział obszaru.`, 'info', 'DOWÓDCA');

      const updatedDrones = state.drones.map((d) => {
        if (droneIds.includes(d.id)) {
          const myRoute = chunks[droneIndex] || [];
          
          // Drony startują z bazy (lub pierwszego ogólnego punktu trasy),
          // lekko rozsunięte od siebie (0.0002 ~ 20m), by się nie nakładały.
          const spawnLng = startLng + (droneIndex * 0.0002);
          const spawnLat = startLat + (droneIndex * 0.0002);
          
          droneIndex++;
          
          return {
            ...d,
            isActive: true,
            route: myRoute,
            currentWaypoint: 0,
            scanningTimer: 0,
            telemetryHistory: [[spawnLng, spawnLat]],
            telemetry: {
              lng: spawnLng,
              lat: spawnLat,
              alt: d.type === 'faza1' ? 60 : 5,
              heading: 0,
              speed: d.type === 'faza1' ? 15 : 5,
              battery: 100
            }
          };
        }
        return d;
      });
      return { drones: updatedDrones };
    });
  },

  deactivateAll: () => set((state) => ({
    drones: state.drones.map(d => ({ ...d, isActive: false, telemetry: null, route: [], currentWaypoint: 0, scanningTimer: 0 }))
  })),

  updateDrone: (id, updates) => set((state) => ({
    drones: state.drones.map(d => d.id === id ? { ...d, ...updates } : d)
  })),

  updateDroneTelemetry: (id, updates) => set((state) => ({
    drones: state.drones.map(d => {
      if (d.id === id && d.telemetry) {
        const newTelemetry = { ...d.telemetry, ...updates };
        let newHistory = d.telemetryHistory;
        if (updates.lng !== undefined && updates.lat !== undefined) {
          const lastPoint = d.telemetryHistory[d.telemetryHistory.length - 1];
          // Dodaj nowy punkt tylko jeśli dron ruszył się zauważalnie (np. > 1 metr)
          if (!lastPoint || Math.abs(lastPoint[0] - updates.lng) > 0.00001 || Math.abs(lastPoint[1] - updates.lat) > 0.00001) {
            newHistory = [...d.telemetryHistory, [updates.lng, updates.lat]];
          }
        }
        return { ...d, telemetry: newTelemetry, telemetryHistory: newHistory };
      }
      return d;
    })
  })),

  addDetection: (data) => {
    const newDetection: Detection = {
      ...data,
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      status: 'pending'
    };
    set((state) => ({ detections: [newDetection, ...state.detections] }));
  },

  updateDetectionStatus: (id, status) => {
    set((state) => ({
      detections: state.detections.map(d => d.id === id ? { ...d, status } : d)
    }));
  },

  setTimeMultiplier: (mul) => set({ timeMultiplier: mul }),
  togglePath: () => set((state) => ({ showPath: !state.showPath })),
  
  toggleDroneSensor: (droneId, sensor) => set((state) => ({
    drones: state.drones.map(d => {
      if (d.id === droneId) {
        const isActive = d.activeSensors.includes(sensor);
        return {
          ...d,
          activeSensors: isActive ? d.activeSensors.filter(s => s !== sensor) : [...d.activeSensors, sensor]
        };
      }
      return d;
    })
  }))
}));
