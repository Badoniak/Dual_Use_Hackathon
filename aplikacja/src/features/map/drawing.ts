// Rysowanie obszarów na mapie MapLibre: wielokąt (klik = wierzchołek, dwuklik / klik w pierwszy punkt / Enter = koniec,
// Esc = anuluj, Backspace = cofnij), prostokąt (dwa rogi), LKP (środek okręgu) i pojedyncze punkty.
import type { Map as MLMap, MapMouseEvent, GeoJSONSource } from 'maplibre-gl';
import type { Feature, Polygon } from 'geojson';
import type { DrawMode } from '../../store/useMissionStore';

export interface DrawCallbacks {
  onPolygon: (f: Feature<Polygon>, source: 'polygon' | 'rectangle') => void;
  onPoint: (mode: DrawMode, lng: number, lat: number) => void;
  onCancel: () => void;
}

const PREVIEW = 'draw-preview';

export class DrawController {
  private map: MLMap;
  private cb: DrawCallbacks;
  private mode: DrawMode = 'none';
  private pts: [number, number][] = [];
  private hover: [number, number] | null = null;

  constructor(map: MLMap, cb: DrawCallbacks) {
    this.map = map;
    this.cb = cb;
    map.addSource(PREVIEW, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'draw-preview-fill', type: 'fill', source: PREVIEW, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.15 } });
    map.addLayer({ id: 'draw-preview-line', type: 'line', source: PREVIEW, filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [2, 1] } });
    map.addLayer({ id: 'draw-preview-pts', type: 'circle', source: PREVIEW, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#f59e0b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    map.on('click', this.onClick);
    map.on('mousemove', this.onMove);
    map.on('dblclick', this.onDbl);
    window.addEventListener('keydown', this.onKey);
  }

  destroy() {
    this.map.off('click', this.onClick);
    this.map.off('mousemove', this.onMove);
    this.map.off('dblclick', this.onDbl);
    window.removeEventListener('keydown', this.onKey);
  }

  setMode(mode: DrawMode) {
    this.mode = mode;
    this.pts = [];
    this.hover = null;
    const drawing = mode !== 'none';
    this.map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    if (drawing) this.map.doubleClickZoom.disable(); else this.map.doubleClickZoom.enable();
    this.render();
  }

  private onClick = (e: MapMouseEvent) => {
    if (this.mode === 'none') return;
    const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    if (this.mode === 'polygon') {
      if (this.pts.length >= 3 && this.nearFirst(e)) { this.finishPolygon(); return; }
      // drugie kliknięcie dwukliku (ten sam punkt) nie dodaje wierzchołka
      if (this.pts.length && this.nearLast(e)) return;
      this.pts.push(p);
      this.render();
    } else if (this.mode === 'rectangle') {
      if (this.pts.length === 0) { this.pts.push(p); this.render(); return; }
      const [a] = this.pts;
      if (Math.abs(a[0] - p[0]) < 1e-7 || Math.abs(a[1] - p[1]) < 1e-7) return;
      const ring: [number, number][] = [a, [p[0], a[1]], p, [a[0], p[1]], a];
      this.pts = [];
      this.render();
      this.cb.onPolygon({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }, 'rectangle');
    } else {
      this.cb.onPoint(this.mode, p[0], p[1]);
    }
  };

  private onDbl = (e: MapMouseEvent) => {
    if (this.mode !== 'polygon') return;
    e.preventDefault();
    this.finishPolygon();
  };

  private onMove = (e: MapMouseEvent) => {
    if (this.mode !== 'polygon' && this.mode !== 'rectangle') return;
    this.hover = [e.lngLat.lng, e.lngLat.lat];
    if (this.pts.length) this.render();
  };

  private onKey = (e: KeyboardEvent) => {
    if (this.mode === 'none') return;
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT')) return;
    if (e.key === 'Escape') { this.pts = []; this.render(); this.cb.onCancel(); }
    else if (e.key === 'Enter' && this.mode === 'polygon') this.finishPolygon();
    else if (e.key === 'Backspace' && this.pts.length) { this.pts.pop(); this.render(); }
  };

  private nearLast(e: MapMouseEvent): boolean {
    const a = this.map.project(this.pts[this.pts.length - 1]);
    return Math.hypot(a.x - e.point.x, a.y - e.point.y) < 4;
  }

  private nearFirst(e: MapMouseEvent): boolean {
    const a = this.map.project(this.pts[0]);
    return Math.hypot(a.x - e.point.x, a.y - e.point.y) < 10;
  }

  private finishPolygon() {
    // usuwamy zdublowane punkty (np. z dwukliku)
    const pts = this.pts.filter((p, i, arr) => i === 0 || Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) > 1e-8);
    if (pts.length < 3) return;
    const ring = [...pts, pts[0]];
    this.pts = [];
    this.render();
    this.cb.onPolygon({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }, 'polygon');
  }

  private render() {
    const src = this.map.getSource(PREVIEW) as GeoJSONSource | undefined;
    if (!src) return;
    const feats: GeoJSON.Feature[] = this.pts.map(p => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }));
    if (this.mode === 'polygon' && this.pts.length) {
      const line = this.hover ? [...this.pts, this.hover] : this.pts;
      if (line.length >= 3) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...line, line[0]]] } });
      else feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } });
    }
    if (this.mode === 'rectangle' && this.pts.length === 1 && this.hover) {
      const a = this.pts[0], p = this.hover;
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[a, [p[0], a[1]], p, [a[0], p[1]], a]] } });
    }
    src.setData({ type: 'FeatureCollection', features: feats });
  }
}
