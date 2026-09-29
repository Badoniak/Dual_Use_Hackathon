import { create } from 'zustand';
import * as turf from '@turf/turf';

export interface LKPPoint {
  id: string;
  lng: number;
  lat: number;
  radiusKm: number;
}

export interface SectorConfig {
  sectorSizeKm: number;
}

interface MissionState {
  lkps: LKPPoint[]; 
  isSelectingLKP: boolean;
  config: SectorConfig;
  gridFeatures: any | null; 
  radiusFeatures: any | null; 
  customAreas: any[];
  isDrawingPolygon: boolean;
  
  setSelectingLKP: (val: boolean) => void;
  setDrawingPolygon: (val: boolean) => void;
  addLKP: (lng: number, lat: number) => void;
  updateLKP: (id: string, radiusKm: number) => void;
  removeLKP: (id: string) => void;
  setCustomAreas: (features: any[]) => void;
  updateConfig: (config: Partial<SectorConfig>) => void;
  generateGrid: () => void;
  clearSectors: () => void;
}

export const useMissionStore = create<MissionState>((set, get) => ({
  lkps: [],
  isSelectingLKP: false,
  config: {
    sectorSizeKm: 0.5, 
  },
  gridFeatures: null,
  radiusFeatures: null,
  customAreas: [],
  isDrawingPolygon: false,

  setSelectingLKP: (val) => set({ isSelectingLKP: val }),
  setDrawingPolygon: (val) => set({ isDrawingPolygon: val }),
  
  addLKP: (lng, lat) => {
    const newLKP: LKPPoint = {
      id: Math.random().toString(36).substring(7),
      lng,
      lat,
      radiusKm: 2 // Domyślnie 2km dla nowego punktu
    };
    set((state) => ({ 
      lkps: [...state.lkps, newLKP],
      isSelectingLKP: false 
    }));
    get().generateGrid();
  },

  updateLKP: (id, radiusKm) => {
    set((state) => ({
      lkps: state.lkps.map(p => p.id === id ? { ...p, radiusKm } : p)
    }));
    get().generateGrid();
  },

  removeLKP: (id) => {
    set((state) => ({
      lkps: state.lkps.filter(p => p.id !== id)
    }));
    get().generateGrid();
  },

  setCustomAreas: (features) => {
    set({ customAreas: features });
    if (get().lkps.length > 0 || features.length > 0) get().generateGrid();
  },

  updateConfig: (config) => {
    set((state) => ({ config: { ...state.config, ...config } }));
    if (get().lkps.length > 0 || get().customAreas.length > 0) {
      get().generateGrid();
    }
  },

  generateGrid: () => {
    const { lkps, config, customAreas } = get();
    if (lkps.length === 0 && customAreas.length === 0) {
      set({ gridFeatures: null, radiusFeatures: null });
      return;
    }

    // 1. Zbuduj okręgi i połączony Bounding Box dla wszystkich LKP z ich własnymi promieniami
    const buffers = lkps.map(lkp => {
      const pt = turf.point([lkp.lng, lkp.lat]);
      return turf.buffer(pt, lkp.radiusKm, { units: 'kilometers' });
    });
    
    // FeatureCollection ze wszystkich buforów (do rysowania na mapie)
    const radiusCollection = turf.featureCollection([...buffers, ...customAreas]);
    const bbox = turf.bbox(radiusCollection);

    // 2. Generuj siatkę (Grid) obejmującą wszystkie punkty
    const grid = turf.squareGrid(bbox, config.sectorSizeKm, { units: 'kilometers' });

    const finalGridFeatures = [];

    grid.features.forEach((feature) => {
      const centroid = turf.centroid(feature);
      
      let maxProbForCell = 0;
      let minDistanceToAny = Infinity;
      let isInsideAnyRadius = false;

      // Sprawdzamy względem każdego LKP osobno
      lkps.forEach(lkp => {
        const dist = turf.distance(turf.point([lkp.lng, lkp.lat]), centroid, { units: 'kilometers' });
        if (dist < minDistanceToAny) minDistanceToAny = dist;
        
        // Zasięg szukania to promień LKP + rozmiar sektora (żeby załapać kwadraty brzegowe)
        if (dist <= lkp.radiusKm + config.sectorSizeKm) {
          isInsideAnyRadius = true;
          // Prawdopodobieństwo względem tego konkretnego LKP (zależne od jego promienia)
          let prob = Math.max(0, 1 - (dist / lkp.radiusKm));
          prob = Math.pow(prob, 1.5);
          if (prob > maxProbForCell) {
            maxProbForCell = prob;
          }
        }
      });
      
      // Sprawdzamy czy środek kwadratu leży w jakimkolwiek narysowanym Custom Area
      customAreas.forEach(area => {
        if (turf.booleanPointInPolygon(centroid, area)) {
          isInsideAnyRadius = true;
          if (0.8 > maxProbForCell) {
            maxProbForCell = 0.8; // Stałe, wysokie prawd. dla narysowanego obszaru
          }
        }
      });
      
      if (isInsideAnyRadius) {
        feature.properties = {
          id: `S-${finalGridFeatures.length + 1}`,
          probability: maxProbForCell,
          distance: minDistanceToAny
        };
        finalGridFeatures.push(feature);
      }
    });

    grid.features = finalGridFeatures;

    set({ gridFeatures: grid, radiusFeatures: radiusCollection });
  },

  clearSectors: () => set({ lkps: [], customAreas: [], gridFeatures: null, radiusFeatures: null })
}));
