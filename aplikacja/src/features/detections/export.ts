// Eksport wyników dla systemów dowodzenia (F5): GeoJSON i KML, offline.
import type { FeatureCollection } from 'geojson';
import { localToLngLat } from '../../sim/geo';
import type { GeoAnchor, Hotspot, LandingSite } from '../../sim/types';
import type { RadarDetection } from '../../store/useMissionStore';

export function buildGeoJson(anchor: GeoAnchor, hotspots: Hotspot[], sites: LandingSite[], detections: RadarDetection[]): FeatureCollection {
  const ll = (x: number, y: number) => localToLngLat(anchor, x, y);
  return {
    type: 'FeatureCollection',
    features: [
      ...detections.map(d => ({
        type: 'Feature' as const,
        properties: {
          type: 'radar_detection', id: d.id, hotspot: d.hotspotId, hotspots: d.hotspotIds.join(','), vital_signs: d.vital, status: d.status,
          confidence: Math.round(d.confidence * 100) / 100,
          depth_min_m: d.estimate ? +d.estimate.depthMin.toFixed(2) : null,
          depth_max_m: d.estimate ? +d.estimate.depthMax.toFixed(2) : null,
          horizontal_error_m: d.estimate ? +d.estimate.horizontalErr.toFixed(2) : null,
          breathing_per_min: d.breathingHz ? Math.round(d.breathingHz * 60) : null,
          heart_per_min: d.heartHz ? Math.round(d.heartHz * 60) : null,
          note: d.note,
        },
        geometry: { type: 'Point' as const, coordinates: [d.lng, d.lat] },
      })),
      ...hotspots.map(h => ({
        type: 'Feature' as const,
        properties: { type: 'hotspot', id: h.id, kind: h.kind, label: h.label, confidence: Math.round(h.confidence * 100) / 100, radar: h.radarCandidate, reasons: h.reasons.join(' | ') },
        geometry: { type: 'Point' as const, coordinates: ll(h.position[0], h.position[1]) },
      })),
      ...sites.map(s => ({
        type: 'Feature' as const,
        properties: { type: 'landing_site', id: s.id, hotspot: s.hotspotId, slope_deg: +s.slopeDeg.toFixed(1), distance_m: +s.distance.toFixed(1), height_m: +s.position[2].toFixed(2) },
        geometry: { type: 'Point' as const, coordinates: ll(s.position[0], s.position[1]) },
      })),
    ],
  };
}

const x = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

export function buildKml(fc: FeatureCollection): string {
  const style = (id: string, color: string) => `<Style id="${id}"><IconStyle><color>${color}</color><scale>1.1</scale></IconStyle></Style>`;
  const pms = fc.features.map(f => {
    const p = f.properties as Record<string, unknown>;
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const styleId = p.type === 'radar_detection' ? (p.vital_signs ? 'vital' : 'none') : p.type === 'hotspot' ? 'hot' : 'land';
    const name = p.type === 'radar_detection' ? `${p.vital_signs ? 'ŻYCIE' : 'brak'} ${p.hotspot}` : String(p.id);
    const desc = Object.entries(p).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`).join('\n');
    return `<Placemark><name>${x(name)}</name><styleUrl>#${styleId}</styleUrl><description>${x(desc)}</description><Point><coordinates>${lng},${lat},0</coordinates></Point></Placemark>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>SKYSAR — wyniki misji</name>
${style('vital', 'ff0000ff')}${style('none', 'ff888888')}${style('hot', 'ff0080ff')}${style('land', 'ff00ff00')}
${pms.join('\n')}
</Document></kml>`;
}

export function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
