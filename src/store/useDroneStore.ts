import { create } from 'zustand';

export type DetectionStatus = 'pending' | 'confirmed' | 'rejected';

export interface Detection {
  id: string;
  lng: number;
  lat: number;
  timestamp: number;
  confidence: number;
  status: DetectionStatus;
  type: 'person' | 'vehicle' | 'anomaly';
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

interface DroneState {
  isActive: boolean;
  telemetry: Telemetry | null;
  detections: Detection[];
  
  activateDrone: (startLng: number, startLat: number) => void;
  deactivateDrone: () => void;
  updateTelemetry: (telemetry: Partial<Telemetry>) => void;
  addDetection: (detection: Omit<Detection, 'id' | 'status' | 'timestamp'>) => void;
  updateDetectionStatus: (id: string, status: DetectionStatus) => void;
}

export const useDroneStore = create<DroneState>((set, get) => ({
  isActive: false,
  telemetry: null,
  detections: [],

  activateDrone: (startLng, startLat) => {
    set({
      isActive: true,
      telemetry: {
        lng: startLng,
        lat: startLat,
        alt: 120,
        heading: 0,
        speed: 15,
        battery: 100
      }
    });
  },

  deactivateDrone: () => set({ isActive: false, telemetry: null }),

  updateTelemetry: (updates) => {
    set((state) => ({
      telemetry: state.telemetry ? { ...state.telemetry, ...updates } : null
    }));
  },

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
  }
}));
