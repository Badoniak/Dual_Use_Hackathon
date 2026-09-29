import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMapStore } from '../../store/useMapStore';
import { useMissionStore } from '../../store/useMissionStore';
import { useDroneStore } from '../../store/useDroneStore';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

export function Map() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const droneMarkers = useRef<{[id: string]: maplibregl.Marker}>({});
  const detectionMarkers = useRef<{[id: string]: maplibregl.Marker}>({});
  const yoloMarkers = useRef<{[id: string]: maplibregl.Marker}>({});
  const lkpMarkers = useRef<{[id: string]: maplibregl.Marker}>({});
  const draw = useRef<MapboxDraw | null>(null);
  const { layers, mapBounds } = useMapStore();
  const { lkps, yoloDetections, isSelectingLKP, addLKP, gridFeatures, radiusFeatures, setCustomAreas, isDrawingPolygon, setDrawingPolygon, clearDrawTrigger } = useMissionStore();
  const { drones, detections, showPath } = useDroneStore();
  const mapLoaded = useRef(false);

  useEffect(() => {
    if (draw.current && clearDrawTrigger > 0) {
      draw.current.deleteAll();
      setCustomAreas([]); // Upewnijmy się, że stan też jest pusty
    }
  }, [clearDrawTrigger]);

  useEffect(() => {
    if (draw.current) {
      if (isDrawingPolygon) {
        draw.current.changeMode('draw_polygon');
      } else {
        try {
          draw.current.changeMode('simple_select');
        } catch (e) {}
      }
    }
  }, [isDrawingPolygon]);

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

    draw.current = new MapboxDraw({
      displayControlsDefault: false,
      controls: {} // Ukrywamy natywne kontrolki Mapbox, użyjemy własnego przycisku w panelu
    });
    map.current.addControl(draw.current, 'top-left');

    const updateAreas = () => {
      if (draw.current) {
        const data = draw.current.getAll();
        setCustomAreas(data.features);
      }
    };

    const stopDrawing = () => {
      updateAreas();
      setDrawingPolygon(false);
    };

    map.current.on('draw.create', stopDrawing);
    map.current.on('draw.delete', updateAreas);
    map.current.on('draw.update', updateAreas);
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
      if (id.startsWith('gl-draw-')) return; // Zostaw warstwy od rysowania w spokoju

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

    // Upewnijmy się, że warstwy operacyjne (siatka, promienie, trasy dronów, sensory) zawsze pozostają na wierzchu!
    const operationalStaticLayers = [
      'search-radius-line',
      'search-grid-fill',
      'search-grid-line'
    ];
    
    operationalStaticLayers.forEach(id => {
      if (m.getLayer(id)) m.moveLayer(id);
    });

    if (m.getStyle() && m.getStyle().layers) {
      m.getStyle().layers.forEach(l => {
        if (l.id.startsWith('sensor-') || l.id.startsWith('drone-path-') || l.id.startsWith('gl-draw-')) {
          m.moveLayer(l.id);
        }
      });
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

  // Sync Drones
  const syncDrones = () => {
    if (!map.current || !mapLoaded.current) return;
    const m = map.current;

    // Remove inactive drones
    Object.keys(droneMarkers.current).forEach(id => {
      if (!drones.find(d => d.id === id && d.isActive && d.telemetry)) {
        droneMarkers.current[id].remove();
        delete droneMarkers.current[id];
        if (m.getLayer(`drone-path-line-${id}`)) m.removeLayer(`drone-path-line-${id}`);
        if (m.getSource(`drone-path-${id}`)) m.removeSource(`drone-path-${id}`);
      }
    });

    drones.forEach(drone => {
      if (!drone.isActive || !drone.telemetry) return;

      const el = document.createElement('div');
      el.className = 'w-8 h-8 flex items-center justify-center animate-pulse';
      const svg = drone.type === 'faza1' 
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.2-1.1.6L3 8l6 6-4 4-3-1-1 1 3 3 1-1-1-3 4-4 6 6l1.2-.7c.4-.2.7-.6.6-1.1z"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2v20"/><path d="M2 12h20"/></svg>`;
      el.innerHTML = `<div class="bg-black/80 p-1 rounded-full border border-white/20">${svg}</div>`;

      if (!droneMarkers.current[drone.id]) {
        droneMarkers.current[drone.id] = new maplibregl.Marker({ element: el })
          .setLngLat([drone.telemetry.lng, drone.telemetry.lat])
          .addTo(m);
      } else {
        droneMarkers.current[drone.id].setLngLat([drone.telemetry.lng, drone.telemetry.lat]);
        droneMarkers.current[drone.id].getElement().innerHTML = el.innerHTML;
      }

      // Flight Path
      if (showPath && drone.telemetryHistory.length > 1) {
        const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: drone.telemetryHistory
          }
        };

        const pathColor = drone.type === 'faza1' ? '#3b82f6' : '#22c55e'; // Blue for F1, Green for F2

        if (!m.getSource(`drone-path-${drone.id}`)) {
          m.addSource(`drone-path-${drone.id}`, { type: 'geojson', data: geojson });
          m.addLayer({
            id: `drone-path-line-${drone.id}`,
            type: 'line',
            source: `drone-path-${drone.id}`,
            paint: {
              'line-color': pathColor,
              'line-width': 2,
              'line-dasharray': [2, 1]
            }
          });
        } else {
          (m.getSource(`drone-path-${drone.id}`) as maplibregl.GeoJSONSource).setData(geojson);
        }
      } else {
        if (m.getLayer(`drone-path-line-${drone.id}`)) m.removeLayer(`drone-path-line-${drone.id}`);
        if (m.getSource(`drone-path-${drone.id}`)) m.removeSource(`drone-path-${drone.id}`);
      }
    });

    // Cleanup and Add Heatmaps for activeSensors
    const activeSensorIds = new Set<string>();
    drones.forEach(drone => {
      drone.activeSensors.forEach(sensor => {
        const layerId = `sensor-${drone.id}-${sensor.replace(/[^a-zA-Z0-9]/g, '')}`;
        activeSensorIds.add(layerId);
        
        // Filtrujemy detekcje tak, aby dotyczyły tylko TEGO drona i TEGO wybranego sensora.
        const sensorDetections = detections.filter(d => d.droneId === drone.id && d.sensor === sensor);

        // Generujemy "pokrycie terenu" (swath) na podstawie trasy drona.
        const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
        
        // Próbkowanie trasy żeby nie przeciążyć przeglądarki
        drone.telemetryHistory.forEach((pt, idx) => {
          if (idx % 3 !== 0) return; // bierzemy co 3 punkt z historii

          // Generujemy 4 punkty obok drona symulujące pole widzenia (FOV)
          for (let i = 0; i < 4; i++) {
            const scanLng = pt[0] + (Math.random() - 0.5) * 0.003;
            const scanLat = pt[1] + (Math.random() - 0.5) * 0.003;
            
            // Domyślnie teren jest "bardzo zimny" (brak anomalii)
            let intensity = 0.05;
            
            // Jeśli blisko znajduje się anomalia DLA TEGO SENSORA, drastycznie zwiększamy intensywność
            sensorDetections.forEach(d => {
              const dist = Math.sqrt(Math.pow(d.lng - scanLng, 2) + Math.pow(d.lat - scanLat, 2));
              if (dist < 0.0015) {
                const strength = 1.5 - (dist / 0.001);
                intensity = Math.max(intensity, strength);
              }
            });

            features.push({
              type: 'Feature',
              properties: { intensity },
              geometry: { type: 'Point', coordinates: [scanLng, scanLat] }
            });
          }
        });

        // NAJWAŻNIEJSZE: Wstrzykujemy same detekcje bezwzględnie jako potężne punkty,
        // żeby mieć 100% pewności, że każda anomalia tego sensora się wyrysuje nawet jak trasa obok "nie trafiła" idealnie.
        sensorDetections.forEach(d => {
          features.push({
            type: 'Feature',
            properties: { intensity: 2.0 }, // Bardzo mocny punkt centralny
            geometry: { type: 'Point', coordinates: [d.lng, d.lat] }
          });
          // Dodajemy też 3 małe punkty wokół żeby powiększyć plamę
          for(let i=0; i<3; i++) {
            features.push({
              type: 'Feature',
              properties: { intensity: 1.5 },
              geometry: { type: 'Point', coordinates: [d.lng + (Math.random() - 0.5) * 0.0005, d.lat + (Math.random() - 0.5) * 0.0005] }
            });
          }
        });
        
        const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: 'FeatureCollection', features };

        if (!m.getSource(layerId)) {
          m.addSource(layerId, { type: 'geojson', data: geojson });
          
          let colorRamp: any = [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,255,0)',
            0.1, 'rgba(0,0,255,0.2)',
            0.4, 'lime',
            0.7, 'yellow',
            1.0, 'red'
          ];
          
          if (sensor.includes('GPR') || sensor.includes('SAR')) {
            colorRamp = [
              'interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(128,0,128,0)',
              0.1, 'rgba(128,0,128,0.2)',
              0.5, 'magenta',
              1.0, 'white'
            ];
          }

          m.addLayer({
            id: layerId,
            type: 'heatmap',
            source: layerId,
            paint: {
              'heatmap-weight': ['get', 'intensity'],
              'heatmap-intensity': 1.2,
              'heatmap-color': colorRamp,
              'heatmap-radius': 30,
              'heatmap-opacity': 0.6
            }
          }); // Usunięto 'drone-path-line-f1_d1' aby uniknąć craschu gdy trasa nie istnieje
        } else {
          (m.getSource(layerId) as maplibregl.GeoJSONSource).setData(geojson);
        }
      });
    });

    // Usuwanie odznaczonych warstw sensorów
    const currentStyle = m.getStyle();
    if (currentStyle && currentStyle.layers) {
      currentStyle.layers.forEach(l => {
        if (l.id.startsWith('sensor-') && !activeSensorIds.has(l.id)) {
          m.removeLayer(l.id);
          m.removeSource(l.id);
        }
      });
    }

    // Detection Markers
    const currentDetIds = new Set(detections.map(d => d.id));
    Object.keys(detectionMarkers.current).forEach(id => {
      if (!currentDetIds.has(id)) {
        detectionMarkers.current[id].remove();
        delete detectionMarkers.current[id];
      }
    });

    detections.forEach(d => {
      let color = '#f97316'; // orange (anomaly)
      if (d.type === 'person') color = '#ef4444'; // red
      if (d.type === 'vehicle') color = '#3b82f6'; // blue
      
      if (d.status === 'confirmed') color = '#22c55e'; // green
      if (d.status === 'rejected') color = '#6b7280'; // gray

      const popupHtml = `
        <div class="p-2 w-48 text-black" style="pointer-events: none;">
          <h4 class="font-bold text-sm mb-1" style="color: ${color}">Wykrycie: ${d.type.toUpperCase()}</h4>
          <p class="text-xs font-bold mb-1">Pewność: ${d.confidence}%</p>
          ${d.imageUrl 
            ? `<img src="${d.imageUrl}" class="w-full h-auto rounded border border-gray-300 mb-1" />` 
            : `<div class="w-full py-4 bg-gray-100 rounded border border-gray-300 flex items-center justify-center mb-1"><span class="text-xs text-gray-500 italic">(brak zdjecia)</span></div>`
          }
          <p class="text-[10px] text-gray-400 mt-1">${new Date(d.timestamp).toLocaleTimeString('pl-PL')} | ${new Date(d.timestamp).toLocaleDateString('pl-PL')}</p>
        </div>
      `;

      const popup = new maplibregl.Popup({ offset: 25, closeButton: false, closeOnClick: false })
        .setHTML(popupHtml);

      if (!detectionMarkers.current[d.id]) {
        const mkr = new maplibregl.Marker({ color })
          .setLngLat([d.lng, d.lat])
          .setPopup(popup)
          .addTo(m);
        
        const el = mkr.getElement();
        el.addEventListener('mouseenter', () => mkr.togglePopup());
        el.addEventListener('mouseleave', () => mkr.togglePopup());
        
        detectionMarkers.current[d.id] = mkr;
      } else {
        const mkr = detectionMarkers.current[d.id];
        // Aktualizacja koloru standardowego markera maplibre
        if ((mkr as any)._color !== color) {
          // Aby zmienić kolor markera domyślnego w maplibre, musimy go stworzyć od nowa
          mkr.remove();
          const newMkr = new maplibregl.Marker({ color })
            .setLngLat([d.lng, d.lat])
            .setPopup(popup)
            .addTo(m);
          
          const el = newMkr.getElement();
          el.addEventListener('mouseenter', () => newMkr.togglePopup());
          el.addEventListener('mouseleave', () => newMkr.togglePopup());
          
          detectionMarkers.current[d.id] = newMkr;
        } else {
          mkr.setLngLat([d.lng, d.lat]);
          mkr.setPopup(popup); // Aktualizacja popupu
        }
      }
    });
  };

  const syncYoloDetections = () => {
    if (!map.current || !mapLoaded.current) return;
    const m = map.current;

    // Clear old markers
    Object.values(yoloMarkers.current).forEach(mkr => mkr.remove());
    yoloMarkers.current = {};

    yoloDetections.forEach(detection => {
      const el = document.createElement('div');
      el.className = 'w-6 h-6 bg-orange-500 rounded-md border-2 border-white flex items-center justify-center shadow-lg cursor-pointer hover:scale-110 transition-transform z-50';
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>`;

      const popupHtml = `
        <div class="p-2 w-48 text-black" style="pointer-events: none;">
          <h4 class="font-bold text-sm mb-1 text-orange-600">Wykrycie YOLO</h4>
          <p class="text-xs text-gray-600 mb-2">${detection.timestamp.toLocaleTimeString('pl-PL')} | ${detection.timestamp.toLocaleDateString('pl-PL')}</p>
          <img src="${detection.imageUrl}" class="w-full h-auto rounded border border-gray-300 mb-1" />
          <p class="text-xs font-bold">Pewność: ${detection.confidence}%</p>
        </div>
      `;

      const popup = new maplibregl.Popup({ offset: 15, closeButton: false, closeOnClick: false })
        .setHTML(popupHtml);

      const mkr = new maplibregl.Marker({ element: el })
        .setLngLat([detection.lng, detection.lat])
        .setPopup(popup)
        .addTo(m);

      // Dodanie hover events żeby popup otwierał się po najechaniu myszką
      el.addEventListener('mouseenter', () => popup.addTo(m));
      el.addEventListener('mouseleave', () => popup.remove());

      yoloMarkers.current[detection.id] = mkr;
    });
  };

  useEffect(() => {
    syncGrid();
  }, [lkps, gridFeatures, radiusFeatures]);

  useEffect(() => {
    syncYoloDetections();
  }, [yoloDetections]);

  useEffect(() => {
    syncDrones();
  }, [drones, detections, showPath]);

  useEffect(() => {
    syncLayers();
  }, [layers]);

  // Automatyczne centrowanie mapy na LKP (przydatne do Demo)
  useEffect(() => {
    if (map.current && mapLoaded.current && lkps.length > 0) {
      // Centrujemy na pierwszy punkt, jeśli nagle się pojawił (np. z przycisku Demo)
      map.current.flyTo({
        center: [lkps[0].lng, lkps[0].lat],
        zoom: 15,
        duration: 2000
      });
    }
  }, [lkps.length]); // Reaguj na zmianę ilości punktów

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
