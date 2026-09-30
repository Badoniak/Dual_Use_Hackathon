import { create } from 'zustand';

export type LayerType = 'wms' | 'geojson' | 'raster';

export interface MapLayer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  opacity: number;
  data?: any; // For geojson
  url?: string; // For WMS/raster
}

interface MapState {
  layers: MapLayer[];
  mapBounds: [number, number, number, number] | null;
  addLayer: (layer: Omit<MapLayer, 'id'>) => void;
  toggleLayerVisibility: (id: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  removeLayer: (id: string) => void;
  reorderLayers: (startIndex: number, endIndex: number) => void;
  setMapBounds: (bounds: [number, number, number, number] | null) => void;
}

export const useMapStore = create<MapState>((set) => ({
  layers: [
    {
      id: 'osm-base',
      name: 'OpenStreetMap',
      type: 'raster',
      visible: true,
      opacity: 1,
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
    },
    {
      id: 'orto-gugik',
      name: 'Ortofotomapa (GUGiK)',
      type: 'wms',
      visible: false,
      opacity: 1,
      url: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution'
    }
  ],
  mapBounds: null,
  addLayer: (layer) => set((state) => ({
    layers: [{ ...layer, id: `layer-${Math.random().toString(36).substring(2, 11)}` }, ...state.layers]
  })),
  toggleLayerVisibility: (id) => set((state) => ({
    layers: state.layers.map(l => l.id === id ? { ...l, visible: !l.visible } : l)
  })),
  setLayerOpacity: (id, opacity) => set((state) => ({
    layers: state.layers.map(l => l.id === id ? { ...l, opacity } : l)
  })),
  removeLayer: (id) => set((state) => ({
    layers: state.layers.filter(l => l.id !== id)
  })),
  reorderLayers: (startIndex, endIndex) => set((state) => {
    const result = Array.from(state.layers);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return { layers: result };
  }),
  setMapBounds: (bounds) => set({ mapBounds: bounds })
}));
