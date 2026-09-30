import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap, ImageSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { circle } from '@turf/turf';
import type { Feature, FeatureCollection } from 'geojson';
import { useMapStore } from '../../store/useMapStore';
import { useMissionStore, sourceRange, type RadarDetection } from '../../store/useMissionStore';
import { useDroneStore, STATUS_LABEL, type Drone } from '../../store/useDroneStore';
import { lngLatToLocal, localToLngLat } from '../../sim/geo';
import { planCoverage } from '../../sim/flightPlan';
import type { GeoAnchor, Hotspot } from '../../sim/types';
import { DrawController } from './drawing';
import { rasterToDataUrl } from './rasters';
import { HOTSPOT_COLORS, SIM_SITE } from './constants';
import { ScanLayer, cloudColors } from './scanLayer';
import { ironbow } from '../../sim/thermal';

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const MISSION_BOTTOM = 'areas-fill';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function ll(a: GeoAnchor, x: number, y: number): [number, number] {
  return localToLngLat(a, x, y);
}

function setData(map: MLMap, id: string, data: FeatureCollection) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

function addMissionLayers(map: MLMap) {
  for (const id of ['areas', 'zones', 'audibility', 'scout-plan', 'trails', 'links', 'landing', 'truth']) map.addSource(id, { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['case', ['get', 'active'], '#f59e0b', '#94a3b8'], 'fill-opacity': ['case', ['get', 'active'], 0.12, 0.06] } });
  map.addLayer({ id: 'areas-line', type: 'line', source: 'areas', paint: { 'line-color': ['case', ['get', 'active'], '#f59e0b', '#94a3b8'], 'line-width': ['case', ['get', 'active'], 2.5, 1.5], 'line-dasharray': [3, 2] } });
  map.addLayer({
    id: 'audibility-heat', type: 'heatmap', source: 'audibility',
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', 'snr'], 6, 0.05, 25, 1],
      'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 14, 6, 19, 60],
      'heatmap-opacity': 0.55,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(168,85,247,0)', 0.3, 'rgba(168,85,247,0.35)', 0.7, 'rgba(236,72,153,0.7)', 1, 'rgba(253,224,71,0.9)'],
    },
  });
  map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': '#a855f7', 'fill-opacity': 0.07 } });
  map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': '#a855f7', 'line-width': 1.5, 'line-dasharray': [1, 1.5] } });
  map.addLayer({ id: 'scout-plan-line', type: 'line', source: 'scout-plan', paint: { 'line-color': '#60a5fa', 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'trails-line', type: 'line', source: 'trails', paint: { 'line-color': ['case', ['==', ['get', 'role'], 'scout'], '#3b82f6', '#22c55e'], 'line-width': 2, 'line-opacity': 0.85 } });
  map.addLayer({ id: 'links-line', type: 'line', source: 'links', paint: { 'line-color': '#e5e7eb', 'line-width': 1, 'line-opacity': 0.5, 'line-dasharray': [2, 2] } });
  map.addLayer({
    id: 'landing-circle', type: 'circle', source: 'landing',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 3, 20, 9],
      'circle-color': ['match', ['get', 'state'], 'vital', '#22c55e', 'none', '#64748b', 'busy', '#facc15', '#0ea5e9'],
      'circle-stroke-color': ['case', ['==', ['get', 'method'], 'probe'], '#f59e0b', '#ffffff'],
      'circle-stroke-width': ['case', ['==', ['get', 'method'], 'probe'], 2.5, 1.5],
    },
  });
  map.addLayer({ id: 'truth-circle', type: 'circle', source: 'truth', paint: { 'circle-radius': 6, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#f472b6', 'circle-stroke-width': 2 } });
}

function droneElement(d: Drone): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'drone-marker';
  el.dataset.droneId = d.id;
  const color = d.role === 'scout' ? '#3b82f6' : '#22c55e';
  el.innerHTML = `
    <div class="drone-ring"></div>
    <svg class="drone-arrow" width="26" height="26" viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 16 L4 21 Z" fill="${color}" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>
    <div class="drone-label">${d.role === 'scout' ? 'Z-1' : 'R-' + d.id.split('-')[1]}</div>`;
  return el;
}

const PERSON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="6" r="4"/><path d="M4 22c0-5 3.6-8 8-8s8 3 8 8z"/></svg>';

function hotspotElement(h: Hotspot, selected: boolean): HTMLDivElement {
  const el = document.createElement('div');
  const color = HOTSPOT_COLORS[h.kind];
  const dim = h.confidence < 0.5;
  el.className = `hotspot-marker${selected ? ' selected' : ''}${dim ? ' dim' : ''}`;
  el.dataset.hotspotId = h.id;
  const bar = (v: number, c: string) => `<span style="display:block;height:3px;width:${Math.round(v * 22)}px;background:${c}"></span>`;
  el.innerHTML = `<div class="hotspot-dot" style="background:${color}">${h.kind === 'manual' ? '✚' : PERSON_SVG}</div>
    <div class="hotspot-label">${h.id} ${(h.confidence * 100).toFixed(0)}%${h.kind === 'fused' ? `<span class="hotspot-bars">${bar(h.evidence.thermal, '#f87171')}${bar(h.evidence.acoustic, '#c084fc')}</span>` : ''}</div>`;
  return el;
}

function detectionElement(d: RadarDetection): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `detection-marker ${d.vital ? 'vital' : 'none'} ${d.status}`;
  const depth = d.estimate ? `${d.estimate.depthMin.toFixed(1)}–${d.estimate.depthMax.toFixed(1)} m` : d.vital ? 'głęb. ?' : 'brak';
  el.innerHTML = `<div class="detection-pulse"></div><div class="detection-core">${d.vital ? '♥' : '–'}</div><div class="detection-label">${d.hotspotId} · ${depth}</div>`;
  return el;
}

function hotspotPopup(h: Hotspot): string {
  const reasons = h.reasons.map(r => `<li>${esc(r)}</li>`).join('');
  return `<div class="map-popup">
    <div class="map-popup-title" style="color:${HOTSPOT_COLORS[h.kind]}">${h.id} · ${esc(h.label)}</div>
    <div class="map-popup-conf">Ufność: <b>${(h.confidence * 100).toFixed(0)}%</b>${h.radarCandidate ? ' · do pomiaru radarem' : ''}</div>
    <div class="map-popup-ev"><span class="t">Termowizja ${(h.evidence.thermal * 100).toFixed(0)}%</span> <span class="a">Mikrofon ${(h.evidence.acoustic * 100).toFixed(0)}%</span></div>
    <ul><li>${esc(h.thermalNote)}</li><li>${esc(h.acousticNote)}</li>${reasons}</ul></div>`;
}

export function Map() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const drawRef = useRef<DrawController | null>(null);
  const baseIds = useRef<Set<string>>(new Set());
  const droneMarkers = useRef<Record<string, maplibregl.Marker>>({});
  const hotspotMarkers = useRef<maplibregl.Marker[]>([]);
  const detectionMarkers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const scanLayer = useRef(new ScanLayer());
  const scanCount = useRef(-1);
  const [pitched, setPitched] = useState(false);

  const layers = useMapStore(s => s.layers);
  const mapBounds = useMapStore(s => s.mapBounds);
  const areas = useMissionStore(s => s.areas);
  const activeAreaId = useMissionStore(s => s.activeAreaId);
  const drawMode = useMissionStore(s => s.drawMode);
  const anchor = useMissionStore(s => s.anchor);
  const result = useMissionStore(s => s.result);
  const phase = useMissionStore(s => s.phase);
  const hotspots = useMissionStore(s => s.hotspots);
  const landingSites = useMissionStore(s => s.landingSites);
  const measurements = useMissionStore(s => s.measurements);
  const detections = useMissionStore(s => s.detections);
  const scoutTrack = useMissionStore(s => s.scoutTrack);
  const mapLayers = useMissionStore(s => s.mapLayers);
  const scan = useMissionStore(s => s.scan);
  const flightAltitude = useMissionStore(s => s.flightAltitude);
  const revealed = useMissionStore(s => s.revealed);
  const selectedHotspotId = useMissionStore(s => s.selectedHotspotId);
  const simVictims = useMissionStore(s => s.simVictims);
  const flyToTrigger = useMissionStore(s => s.flyToTrigger);

  // --- inicjalizacja mapy
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0b1220' } }] },
      center: SIM_SITE,
      zoom: 16.5,
      maxZoom: 21,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    mapRef.current = map;
    (window as unknown as { __map?: MLMap }).__map = map;
    map.on('load', () => {
      addMissionLayers(map);
      map.addLayer(scanLayer.current, 'audibility-heat');
      drawRef.current = new DrawController(map, {
        onPolygon: (f, source) => {
          const ms = useMissionStore.getState();
          ms.addArea(f, source);
          ms.setDrawMode('none');
        },
        onPoint: (mode, lng, lat) => {
          const ms = useMissionStore.getState();
          if (mode === 'lkp') ms.addLkpArea(lng, lat);
          else if (mode === 'manual-hotspot') ms.addManualHotspot(lng, lat);
          else if (mode === 'sim-victim') ms.addSimVictim(lng, lat, ms.victimDepthM);
        },
        onCancel: () => useMissionStore.getState().setDrawMode('none'),
      });
      setReady(true);
    });
    const markers = droneMarkers.current;
    return () => {
      drawRef.current?.destroy();
      drawRef.current = null;
      Object.values(markers).forEach(m => m.remove());
      for (const k of Object.keys(markers)) delete markers[k];
      baseIds.current.clear();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // --- warstwy bazowe (OSM, ortofotomapa, wgrane GeoJSON/KML) — zawsze pod warstwami misji
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    const wanted = new Set<string>();
    [...layers].reverse().forEach(layer => {
      const ids = layer.type === 'geojson' ? [layer.id + '-fill', layer.id + '-line', layer.id + '-circle'] : [layer.id];
      ids.forEach(i => wanted.add(i));
      if (!m.getSource(layer.id)) {
        if (layer.type === 'raster' && layer.url) m.addSource(layer.id, { type: 'raster', tiles: [layer.url], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap' });
        else if (layer.type === 'wms' && layer.url) m.addSource(layer.id, { type: 'raster', tiles: [`${layer.url}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=Raster&STYLES=&WIDTH=256&HEIGHT=256&SRS=EPSG:3857&BBOX={bbox-epsg-3857}`], tileSize: 256, attribution: '© GUGiK' });
        else if (layer.type === 'geojson' && layer.data) m.addSource(layer.id, { type: 'geojson', data: layer.data });
      }
      if (!m.getSource(layer.id)) return;
      const vis = layer.visible ? 'visible' : 'none';
      if (layer.type === 'geojson') {
        if (!m.getLayer(layer.id + '-fill')) {
          m.addLayer({ id: layer.id + '-fill', type: 'fill', source: layer.id, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.2 } }, MISSION_BOTTOM);
          m.addLayer({ id: layer.id + '-line', type: 'line', source: layer.id, filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#ef4444', 'line-width': 2 } }, MISSION_BOTTOM);
          m.addLayer({ id: layer.id + '-circle', type: 'circle', source: layer.id, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#ef4444', 'circle-radius': 5 } }, MISSION_BOTTOM);
        }
        m.setPaintProperty(layer.id + '-fill', 'fill-opacity', layer.opacity * 0.2);
        m.setPaintProperty(layer.id + '-line', 'line-opacity', layer.opacity);
        m.setPaintProperty(layer.id + '-circle', 'circle-opacity', layer.opacity);
        ids.forEach(i => m.setLayoutProperty(i, 'visibility', vis));
      } else {
        if (!m.getLayer(layer.id)) m.addLayer({ id: layer.id, type: 'raster', source: layer.id }, MISSION_BOTTOM);
        m.setLayoutProperty(layer.id, 'visibility', vis);
        m.setPaintProperty(layer.id, 'raster-opacity', layer.opacity);
      }
      ids.forEach(i => m.getLayer(i) && m.moveLayer(i, MISSION_BOTTOM));
    });
    // usunięcie warstw bazowych, których już nie ma w stanie (tylko zarządzanych tutaj!)
    for (const id of baseIds.current) {
      if (wanted.has(id)) continue;
      if (m.getLayer(id)) m.removeLayer(id);
      const srcId = id.replace(/-(fill|line|circle)$/, '');
      if (!layers.some(l => l.id === srcId) && m.getSource(srcId) && !m.getStyle().layers.some(l => 'source' in l && l.source === srcId)) m.removeSource(srcId);
    }
    baseIds.current = wanted;
  }, [layers, ready]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready || !mapBounds) return;
    const [w, s, e, n] = mapBounds;
    if ([w, s, e, n].every(Number.isFinite) && s >= -90 && n <= 90) m.fitBounds([[w, s], [e, n]], { padding: 50, duration: 800 });
  }, [mapBounds, ready]);

  // --- tryb rysowania
  useEffect(() => {
    if (ready) drawRef.current?.setMode(drawMode);
  }, [drawMode, ready]);

  // --- obszary
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    setData(m, 'areas', { type: 'FeatureCollection', features: areas.map(a => ({ ...a.feature, properties: { id: a.id, active: a.id === activeAreaId } })) });
  }, [areas, activeAreaId, ready]);

  // --- ortofoto z lidaru / termowizji
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    const show = !!(result && anchor && mapLayers.ortho !== 'none' && phase !== 'scouting');
    if (!show) {
      if (m.getLayer('ortho-layer')) m.removeLayer('ortho-layer');
      if (m.getSource('ortho')) m.removeSource('ortho');
      return;
    }
    const b = result!.ortho.bounds;
    const coords: [[number, number], [number, number], [number, number], [number, number]] = [ll(anchor!, b.minX, b.maxY), ll(anchor!, b.maxX, b.maxY), ll(anchor!, b.maxX, b.minY), ll(anchor!, b.minX, b.minY)];
    const url = rasterToDataUrl(mapLayers.ortho === 'thermal' ? result!.ortho.thermal : result!.ortho.rgb);
    const src = m.getSource('ortho') as ImageSource | undefined;
    if (src) src.updateImage({ url, coordinates: coords });
    else {
      m.addSource('ortho', { type: 'image', url, coordinates: coords });
      m.addLayer({ id: 'ortho-layer', type: 'raster', source: 'ortho', paint: { 'raster-opacity': 0.92, 'raster-resampling': 'nearest' } }, MISSION_BOTTOM);
    }
  }, [result, anchor, mapLayers.ortho, phase, ready]);

  // --- dopasowanie widoku do wyników
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready || !result || !anchor || phase !== 'analysis') return;
    const b = result.ortho.bounds;
    m.fitBounds([ll(anchor, b.minX, b.minY), ll(anchor, b.maxX, b.maxY)], { padding: 40, duration: 1200, maxZoom: 19.5, pitch: m.getPitch(), bearing: m.getBearing() });
  }, [phase, ready, result, anchor]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready || !flyToTrigger) return;
    m.flyTo({ center: [flyToTrigger.lng, flyToTrigger.lat], zoom: flyToTrigger.zoom, duration: 1200 });
  }, [flyToTrigger, ready]);

  // --- plan / pełna trajektoria zwiadowcy
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    let coords: [number, number][] = [];
    if (scoutTrack && anchor) coords = scoutTrack.plan.waypoints.map(w => ll(anchor, w[0], w[1]));
    else {
      // podgląd planu lotu nad aktywnym obszarem (przed startem)
      const area = areas.find(a => a.id === activeAreaId);
      if (area && phase === 'planning') {
        const ring = area.feature.geometry.coordinates[0] as [number, number][];
        const a0: GeoAnchor = { lat0: ring[0][1], lon0: ring[0][0], mode: 'gps' };
        const plan = planCoverage(ring.map(([lng, lat]) => lngLatToLocal(a0, lng, lat)), { altitude: flightAltitude });
        coords = plan.waypoints.map(w => ll(a0, w[0], w[1]));
      }
    }
    setData(m, 'scout-plan', coords.length ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] } : EMPTY);
  }, [scoutTrack, anchor, areas, activeAreaId, phase, flightAltitude, ready]);

  // --- start lotu: widok 3D nad wybranym obszarem
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready || phase !== 'scouting' || !scoutTrack || !anchor) return;
    const w = scoutTrack.plan.waypoints;
    const xs = w.map(p => p[0]), ys = w.map(p => p[1]);
    const cam = m.cameraForBounds([ll(anchor, Math.min(...xs), Math.min(...ys)), ll(anchor, Math.max(...xs), Math.max(...ys))], { padding: 60 });
    m.easeTo({ center: cam?.center, zoom: Math.min(19.5, (cam?.zoom ?? 18) - 0.2), pitch: 55, bearing: -20, duration: 1500 });
    setPitched(true);
  }, [phase, scoutTrack, anchor, ready]);

  // --- skan 3D na mapie: dane i kolory
  useEffect(() => {
    const layer = scanLayer.current;
    if (!ready) return;
    if (!scan || !anchor) { layer.clear(); scanCount.current = -1; return; }
    const mode = mapLayers.cloud === 'none' ? 'rgb' : mapLayers.cloud;
    const colors = cloudColors(mode, scan.positions, scan.colors, scan.temps, ironbow);
    if (!layer.hasData() || scanCount.current !== scan.count) layer.setData(anchor, scan.positions, colors, scan.scanTimes);
    else layer.setColors(colors);
    scanCount.current = scan.count;
    layer.setRange(...sourceRange(mapLayers.cloudSource, scan.count, scan.nLidar));
    layer.setVisible(mapLayers.cloud !== 'none');
  }, [scan, anchor, mapLayers.cloud, mapLayers.cloudSource, ready]);

  // --- postęp skanu (czas od startu lotu)
  useEffect(() => {
    if (!ready) return;
    const apply = () => {
      const ms = useMissionStore.getState();
      const tr = ms.scoutTrack;
      const t = tr && ms.phase === 'scouting' ? useDroneStore.getState().simTime - tr.startSim : 1e9;
      scanLayer.current.setTime(t);
    };
    apply();
    const u1 = useDroneStore.subscribe(apply);
    const u2 = useMissionStore.subscribe(apply);
    return () => { u1(); u2(); };
  }, [ready]);

  // --- strefy akustyczne i mapa słyszalności
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    if (!result || !anchor || phase === 'scouting') { setData(m, 'zones', EMPTY); setData(m, 'audibility', EMPTY); return; }
    const zones: Feature[] = mapLayers.zones
      ? result.acousticZones.map(z => circle(ll(anchor, z.position[0], z.position[1]), z.radius / 1000, { steps: 64, units: 'kilometers', properties: { kind: z.kind } }))
      : [];
    setData(m, 'zones', { type: 'FeatureCollection', features: zones });
    const pts: Feature[] = mapLayers.audibility
      ? result.acousticEvents.filter(e => e.kind !== 'broadband' || e.snrDb > 8).map(e => ({ type: 'Feature', properties: { snr: e.snrDb, kind: e.kind }, geometry: { type: 'Point', coordinates: ll(anchor, e.dronePos[0], e.dronePos[1]) } }))
      : [];
    setData(m, 'audibility', { type: 'FeatureCollection', features: pts });
  }, [result, anchor, phase, mapLayers.zones, mapLayers.audibility, ready]);

  // --- lądowiska i powiązania z hotspotami
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    if (!anchor || !mapLayers.landing || phase === 'scouting') { setData(m, 'landing', EMPTY); setData(m, 'links', EMPTY); return; }
    const byId = new globalThis.Map(hotspots.map(h => [h.id, h]));
    const active = new Set(hotspots.filter(h => h.radarCandidate).map(h => h.id));
    const sites = landingSites.filter(s => active.has(s.hotspotId));
    const state = (id: string) => {
      const ms = measurements.find(x => x.siteId === id);
      return ms ? (ms.detection.detected ? 'vital' : 'none') : 'pending';
    };
    setData(m, 'landing', { type: 'FeatureCollection', features: sites.map(s => ({ type: 'Feature', properties: { id: s.id, state: state(s.id), method: s.method }, geometry: { type: 'Point', coordinates: ll(anchor, s.position[0], s.position[1]) } })) });
    setData(m, 'links', {
      type: 'FeatureCollection', features: sites.filter(s => byId.has(s.hotspotId)).map(s => {
        const h = byId.get(s.hotspotId)!;
        return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [ll(anchor, s.position[0], s.position[1]), ll(anchor, h.position[0], h.position[1])] } };
      }),
    });
  }, [landingSites, hotspots, measurements, anchor, phase, mapLayers.landing, ready]);

  // --- hotspoty (znaczniki HTML)
  useEffect(() => {
    const m = mapRef.current;
    hotspotMarkers.current.forEach(mk => mk.remove());
    hotspotMarkers.current = [];
    if (!m || !ready || !anchor) return;
    for (const h of hotspots) {
      if (phase === 'scouting' && !revealed.includes(h.id)) continue;
      const el = hotspotElement(h, h.id === selectedHotspotId);
      el.addEventListener('click', ev => {
        // w trybie rysowania kliknięcie ma trafić do mapy (np. punkt tuż obok hotspotu)
        if (useMissionStore.getState().drawMode !== 'none') return;
        ev.stopPropagation();
        useMissionStore.getState().selectHotspot(h.id);
      });
      const mk = new maplibregl.Marker({ element: el })
        .setLngLat(ll(anchor, h.position[0], h.position[1]))
        .setPopup(new maplibregl.Popup({ offset: 16, closeButton: true, maxWidth: '320px' }).setHTML(hotspotPopup(h)))
        .addTo(m);
      if (h.id === selectedHotspotId) mk.togglePopup();
      hotspotMarkers.current.push(mk);
    }
  }, [hotspots, anchor, phase, selectedHotspotId, revealed, ready]);

  // --- wyniki radaru
  useEffect(() => {
    const m = mapRef.current;
    detectionMarkers.current.forEach(mk => mk.remove());
    detectionMarkers.current = [];
    if (!m || !ready) return;
    for (const d of detections) {
      const mk = new maplibregl.Marker({ element: detectionElement(d), anchor: 'center' })
        .setLngLat([d.lng, d.lat])
        .setPopup(new maplibregl.Popup({ offset: 14, maxWidth: '300px' }).setHTML(`<div class="map-popup"><div class="map-popup-title">${d.vital ? 'Oznaki życia' : 'Brak oznak życia'} · ${d.hotspotId}</div><div>${esc(d.note)}</div>${d.breathingHz ? `<div>Oddech: ${(d.breathingHz * 60).toFixed(0)}/min${d.heartHz ? `, tętno: ${(d.heartHz * 60).toFixed(0)}/min` : ''}</div>` : ''}<div class="map-popup-conf">${d.lat.toFixed(6)} N, ${d.lng.toFixed(6)} E</div></div>`))
        .addTo(m);
      detectionMarkers.current.push(mk);
    }
  }, [detections, ready]);

  // --- prawda scenariusza (tylko podgląd dla prowadzącego demo)
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !ready) return;
    if (!anchor || !mapLayers.victimsTruth) { setData(m, 'truth', EMPTY); return; }
    setData(m, 'truth', { type: 'FeatureCollection', features: simVictims.map(v => ({ type: 'Feature', properties: { id: v.id }, geometry: { type: 'Point', coordinates: ll(anchor, v.position[0], v.position[1]) } })) });
  }, [simVictims, anchor, mapLayers.victimsTruth, ready]);

  // --- drony: aktualizacja imperatywna przy każdym takcie zegara (bez re-renderu komponentu)
  useEffect(() => {
    if (!ready) return;
    let lastTrail = 0;
    const apply = () => {
      const m = mapRef.current;
      const a = useMissionStore.getState().anchor;
      if (!m) return;
      const { drones } = useDroneStore.getState();
      const seen = new Set<string>();
      for (const d of drones) {
        if (!a || !d.pos || (d.role === 'scout' && d.status === 'base' && d.trail.length === 0)) continue;
        seen.add(d.id);
        let mk = droneMarkers.current[d.id];
        if (!mk) {
          mk = new maplibregl.Marker({ element: droneElement(d), anchor: 'center' }).setLngLat(ll(a, d.pos[0], d.pos[1])).addTo(m);
          droneMarkers.current[d.id] = mk;
        }
        mk.setLngLat(ll(a, d.pos[0], d.pos[1]));
        const el = mk.getElement();
        el.dataset.status = d.status;
        el.title = `${d.name} — ${STATUS_LABEL[d.status]}, bateria ${d.battery.toFixed(0)}%`;
        const arrow = el.querySelector('.drone-arrow') as SVGElement | null;
        if (arrow) arrow.style.transform = `rotate(${d.heading}deg)`;
      }
      for (const id of Object.keys(droneMarkers.current)) if (!seen.has(id)) { droneMarkers.current[id].remove(); delete droneMarkers.current[id]; }
      const now = performance.now();
      if (now - lastTrail > 400) {
        lastTrail = now;
        const show = useMissionStore.getState().mapLayers.trails;
        setData(m, 'trails', {
          type: 'FeatureCollection',
          features: !a || !show ? [] : drones.filter(d => d.trail.length > 1).map(d => ({ type: 'Feature', properties: { role: d.role }, geometry: { type: 'LineString', coordinates: d.trail.map(p => ll(a, p[0], p[1])) } })),
        });
      }
    };
    apply();
    return useDroneStore.subscribe(apply);
  }, [ready]);

  return (
    <div className="w-full h-full relative bg-black/10">
      <div ref={container} className="w-full h-full" data-testid="map" />
      <button
        onClick={() => { const m = mapRef.current; if (!m) return; const to3d = m.getPitch() < 10; m.easeTo({ pitch: to3d ? 55 : 0, bearing: to3d ? -20 : 0, duration: 800 }); setPitched(to3d); }}
        className="absolute top-3 right-14 bg-background/90 border border-border/60 rounded-md px-2.5 py-1.5 text-xs font-semibold hover:bg-muted shadow"
        data-testid="toggle-3d"
      >{pitched ? 'Widok 2D' : 'Widok 3D'}</button>
      {drawMode !== 'none' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-black text-sm font-medium px-4 py-2 rounded-md shadow-lg pointer-events-none">
          {drawMode === 'polygon' && 'Klikaj wierzchołki obszaru · dwuklik, Enter lub klik w pierwszy punkt kończy · Esc anuluje'}
          {drawMode === 'rectangle' && 'Kliknij dwa przeciwległe rogi prostokąta · Esc anuluje'}
          {drawMode === 'lkp' && 'Kliknij ostatnią znaną pozycję (LKP) — powstanie okrąg poszukiwań · Esc anuluje'}
          {drawMode === 'manual-hotspot' && 'Kliknij miejsce do sprawdzenia radarem (np. słychać stukanie) · Esc anuluje'}
          {drawMode === 'sim-victim' && 'Kliknij, gdzie w scenariuszu leży zasypana osoba · Esc anuluje'}
        </div>
      )}
    </div>
  );
}
