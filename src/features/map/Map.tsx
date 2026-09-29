import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMapStore } from '../../store/useMapStore';
import { useMissionStore } from '../../store/useMissionStore';
import { useDroneStore } from '../../store/useDroneStore';

export function Map() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const droneMarker = useRef<maplibregl.Marker | null>(null);
  const detectionMarkers = useRef<{[id: string]: maplibregl.Marker}>({});
  const { layers, mapBounds } = useMapStore();
  const { lkps, isSelectingLKP, addLKP, gridFeatures, radiusFeatures } = useMissionStore();
  const { isActive, telemetry, detections } = useDroneStore();
  const mapLoaded = useRef(false);

  // Initialize Map
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          'osm-base': {
            type: 'raster',
            tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256
          }
        },
        layers: [
          {
            id: 'osm-base',
            type: 'raster',
            source: 'osm-base'
          }
        ]
      },
      center: [21.9990, 50.0412], 
      zoom: 12
    });

    const clickHandler = (e: maplibregl.MapMouseEvent) => {
      if (useMissionStore.getState().isSelectingLKP) {
        useMissionStore.getState().addLKP(e.lngLat.lng, e.lngLat.lat);
      }
    };

    const initMap = () => {
      mapLoaded.current = true;
      map.current?.on('click', clickHandler);
      syncLayers(); // Initial sync
      syncGrid();
    };

    if (map.current.loaded()) {
      initMap();
    } else {
      map.current.on('load', initMap);
    }
  }, []);

  // Sync Layers
  const syncLayers = () => {
    if (!map.current || !mapLoaded.current) return;
    const m = map.current;

    // Remove old layers not in state
    const currentLayerIds = m.getStyle().layers?.map(l => l.id) || [];
    currentLayerIds.forEach(id => {
      if (!layers.find(l => l.id === id)) {
        if (m.getLayer(id)) m.removeLayer(id);
        if (m.getSource(id)) m.removeSource(id);
      }
    });

    // Add or update layers
    [...layers].reverse().forEach(layer => {
      // 1. Add Source if not exists
      if (!m.getSource(layer.id)) {
        if (layer.type === 'raster' && layer.url) {
          m.addSource(layer.id, {
            type: 'raster',
            tiles: [layer.url],
            tileSize: 256
          });
        } else if (layer.type === 'wms' && layer.url) {
          m.addSource(layer.id, {
            type: 'raster',
            tiles: [`${layer.url}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=Raster&WIDTH=256&HEIGHT=256&SRS=EPSG:3857&BBOX={bbox-epsg-3857}`],
            tileSize: 256
          });
        } else if (layer.type === 'geojson' && layer.data) {
          m.addSource(layer.id, {
            type: 'geojson',
            data: layer.data
          });
        }
      }

      // 2. Add Layer if not exists
      if (!m.getLayer(layer.id) && m.getSource(layer.id)) {
        if (layer.type === 'raster' || layer.type === 'wms') {
          m.addLayer({
            id: layer.id,
            type: 'raster',
            source: layer.id,
            layout: { visibility: layer.visible ? 'visible' : 'none' },
            paint: { 'raster-opacity': layer.opacity }
          });
        } else if (layer.type === 'geojson') {
          // Add line and fill and circle
          m.addLayer({
            id: layer.id, // we might need multiple layers for geojson, but keep it simple
            type: 'line',
            source: layer.id,
            layout: { visibility: layer.visible ? 'visible' : 'none' },
            paint: {
              'line-color': '#ff0000',
              'line-width': 3,
              'line-opacity': layer.opacity
            },
            filter: ['==', ['geometry-type'], 'LineString']
          });
          m.addLayer({
            id: `${layer.id}-fill`,
            type: 'fill',
            source: layer.id,
            layout: { visibility: layer.visible ? 'visible' : 'none' },
            paint: {
              'fill-color': '#ff0000',
              'fill-opacity': layer.opacity * 0.2
            },
            filter: ['==', ['geometry-type'], 'Polygon']
          });
           m.addLayer({
            id: `${layer.id}-circle`,
            type: 'circle',
            source: layer.id,
            layout: { visibility: layer.visible ? 'visible' : 'none' },
            paint: {
              'circle-color': '#ff0000',
              'circle-radius': 5,
              'circle-opacity': layer.opacity
            },
            filter: ['==', ['geometry-type'], 'Point']
          });
        }
      }

      // 3. Update visibility & opacity
      if (m.getLayer(layer.id)) {
        m.setLayoutProperty(layer.id, 'visibility', layer.visible ? 'visible' : 'none');
        if (layer.type === 'raster' || layer.type === 'wms') {
          m.setPaintProperty(layer.id, 'raster-opacity', layer.opacity);
        } else if (layer.type === 'geojson') {
          m.setPaintProperty(layer.id, 'line-opacity', layer.opacity);
          if (m.getLayer(`${layer.id}-fill`)) {
            m.setLayoutProperty(`${layer.id}-fill`, 'visibility', layer.visible ? 'visible' : 'none');
            m.setPaintProperty(`${layer.id}-fill`, 'fill-opacity', layer.opacity * 0.2);
          }
           if (m.getLayer(`${layer.id}-circle`)) {
            m.setLayoutProperty(`${layer.id}-circle`, 'visibility', layer.visible ? 'visible' : 'none');
            m.setPaintProperty(`${layer.id}-circle`, 'circle-opacity', layer.opacity);
          }
        }
      }
    });

    // 4. Reorder layers
    // Note: layers array is top-to-bottom in UI, but maplibre draws them bottom-to-top
    // So we iterate backwards (which we did) and move them to front
    // But wait, it's easier to just move layers:
    const reversed = [...layers].reverse();
    for (let i = 0; i < reversed.length; i++) {
      const l = reversed[i];
      if (m.getLayer(l.id)) m.moveLayer(l.id);
      if (m.getLayer(`${l.id}-fill`)) m.moveLayer(`${l.id}-fill`);
      if (m.getLayer(`${l.id}-circle`)) m.moveLayer(`${l.id}-circle`);
    }
  };

  // Sync Grid & LKP
  const syncGrid = () => {
    if (!map.current || !mapLoaded.current) return;
    const m = map.current;

    // 1. Update Markers
    // Remove old ones
    markers.current.forEach(mkr => mkr.remove());
    markers.current = [];
    
    // Add new ones
    lkps.forEach(p => {
      const mkr = new maplibregl.Marker({ color: '#ef4444' })
        .setLngLat(p)
        .addTo(m);
      markers.current.push(mkr);
    });

    // 2. Update Radius Okręgi (Circles)
    if (radiusFeatures) {
      if (!m.getSource('search-radius')) {
        m.addSource('search-radius', { type: 'geojson', data: radiusFeatures });
        
        m.addLayer({
          id: 'search-radius-line',
          type: 'line',
          source: 'search-radius',
          paint: {
            'line-color': '#ef4444',
            'line-width': 2,
            'line-dasharray': [2, 2],
            'line-opacity': 0.8
          }
        });
      } else {
        (m.getSource('search-radius') as maplibregl.GeoJSONSource).setData(radiusFeatures);
      }
    } else {
      if (m.getLayer('search-radius-line')) m.removeLayer('search-radius-line');
      if (m.getSource('search-radius')) m.removeSource('search-radius');
    }

    // 3. Update Grid Layer
    if (gridFeatures) {
      if (!m.getSource('search-grid')) {
        m.addSource('search-grid', { type: 'geojson', data: gridFeatures });
        
        // Fill layer (colored by probability)
        m.addLayer({
          id: 'search-grid-fill',
          type: 'fill',
          source: 'search-grid',
          paint: {
            'fill-color': [
              'interpolate',
              ['linear'],
              ['get', 'probability'],
              0, '#3b82f6', // low prob (blue)
              1, '#ef4444'  // high prob (red)
            ],
            'fill-opacity': 0.3
          }
        });

        // Line layer (borders)
        m.addLayer({
          id: 'search-grid-line',
          type: 'line',
          source: 'search-grid',
          paint: {
            'line-color': '#ffffff',
            'line-width': 1,
            'line-opacity': 0.5
          }
        });
      } else {
        (m.getSource('search-grid') as maplibregl.GeoJSONSource).setData(gridFeatures);
      }
    } else {
      if (m.getLayer('search-grid-fill')) m.removeLayer('search-grid-fill');
      if (m.getLayer('search-grid-line')) m.removeLayer('search-grid-line');
      if (m.getSource('search-grid')) m.removeSource('search-grid');
    }
  };

  // Sync Drone
  const syncDrone = () => {
    if (!map.current || !mapLoaded.current) return;
    const m = map.current;

    // Drone Marker
    if (isActive && telemetry) {
      if (!droneMarker.current) {
        // Create a custom element for the drone icon
        const el = document.createElement('div');
        el.className = 'w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-lg border-2 border-primary';
        el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-primary"><path d="m2 2 4 4"/><path d="m22 2-4 4"/><path d="m2 22 4-4"/><path d="m22 22-4-4"/><circle cx="12" cy="12" r="2"/></svg>`;
        
        droneMarker.current = new maplibregl.Marker({ element: el })
          .setLngLat([telemetry.lng, telemetry.lat])
          .addTo(m);
      } else {
        droneMarker.current.setLngLat([telemetry.lng, telemetry.lat]);
      }
    } else {
      if (droneMarker.current) {
        droneMarker.current.remove();
        droneMarker.current = null;
      }
    }

    // Detection Markers
    const currentDetIds = new Set(detections.map(d => d.id));
    
    // Remove old detection markers
    Object.keys(detectionMarkers.current).forEach(id => {
      if (!currentDetIds.has(id)) {
        detectionMarkers.current[id].remove();
        delete detectionMarkers.current[id];
      }
    });

    // Add or update detection markers
    detections.forEach(d => {
      let color = '#f97316'; // orange for pending
      if (d.status === 'confirmed') color = '#22c55e'; // green
      if (d.status === 'rejected') color = '#6b7280'; // gray

      if (!detectionMarkers.current[d.id]) {
        detectionMarkers.current[d.id] = new maplibregl.Marker({ color })
          .setLngLat([d.lng, d.lat])
          .addTo(m);
      } else {
        // Update color if status changed (maplibre marker color isn't easily mutable without creating a new one, 
        // but we can just recreate it if it doesn't match, or let it be for now since it's a prototype)
        // Simplest way: recreate marker to change color easily
        const oldColor = detectionMarkers.current[d.id]._color; // internals, but works mostly
        if (oldColor !== color) {
          detectionMarkers.current[d.id].remove();
          detectionMarkers.current[d.id] = new maplibregl.Marker({ color })
            .setLngLat([d.lng, d.lat])
            .addTo(m);
        } else {
          detectionMarkers.current[d.id].setLngLat([d.lng, d.lat]);
        }
      }
    });
  };

  useEffect(() => {
    syncGrid();
  }, [lkps, gridFeatures, radiusFeatures]);

  useEffect(() => {
    syncDrone();
  }, [isActive, telemetry, detections]);

  useEffect(() => {
    syncLayers();
  }, [layers]);

  useEffect(() => {
    if (map.current && mapLoaded.current && mapBounds) {
      try {
        // Turf bbox returns [minX, minY, maxX, maxY]
        const [w, s, e, n] = mapBounds;
        // Check if bounds are valid and within -90 to 90 for latitude
        if (isFinite(w) && isFinite(s) && isFinite(e) && isFinite(n)) {
          if (s >= -90 && s <= 90 && n >= -90 && n <= 90) {
            map.current.fitBounds([[w, s], [e, n]], { padding: 50, duration: 1000 });
          } else {
            console.warn("Współrzędne poza zakresem (prawdopodobnie układ inny niż WGS84/EPSG:4326).");
          }
        }
      } catch (err) {
        console.error("Błąd podczas fitBounds:", err);
      }
    }
  }, [mapBounds]);

  return (
    <div className={`w-full h-full relative bg-black/10 ${isSelectingLKP ? 'cursor-crosshair' : ''}`}>
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  );
}
