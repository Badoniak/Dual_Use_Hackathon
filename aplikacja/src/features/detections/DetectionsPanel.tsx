import { useMemo, useState } from 'react';
import { Box, CheckCircle, Crosshair, Download, HeartPulse, RotateCcw, Undo2, XCircle } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMissionStore, type RadarDetection } from '../../store/useMissionStore';
import type { SiteMeasurement } from '../../sim/scenario';
import { buildGeoJson, buildKml, download } from './export';

function SignalCharts({ m }: { m: SiteMeasurement }) {
  const sig = useMemo(() => {
    const step = Math.max(1, Math.floor(m.signal.length / 450));
    const out: { t: number; v: number }[] = [];
    for (let i = 0; i < m.signal.length; i += step) out.push({ t: +(i / m.fs).toFixed(1), v: +m.signal[i].toFixed(2) });
    return out;
  }, [m]);
  const spec = useMemo(() => {
    const out: { f: number; p: number }[] = [];
    const maxP = Math.max(...m.spectrum.power);
    for (let k = 0; k < m.spectrum.freq.length; k += 2) out.push({ f: +m.spectrum.freq[k].toFixed(3), p: +(m.spectrum.power[k] / maxP).toFixed(4) });
    return out;
  }, [m]);
  const d = m.detection;
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">Sygnał radaru w binie odległości (faza, j.u.) — {m.siteId}, {(m.signal.length / m.fs).toFixed(0)} s</div>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sig} margin={{ top: 2, right: 4, bottom: 0, left: -28 }}>
            <CartesianGrid stroke="#1e293b" />
            <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#94a3b8' }} interval={Math.floor(sig.length / 6)} />
            <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} />
            <Line dataKey="v" dot={false} stroke={d.detected ? '#22c55e' : '#94a3b8'} strokeWidth={1} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[11px] text-muted-foreground">Widmo 0–2,5 Hz: oddech {d.breathingHz ? `${d.breathingHz.toFixed(2)} Hz` : '—'} (SNR {d.breathingSnrDb.toFixed(0)} dB), serce {d.heartHz ? `${d.heartHz.toFixed(2)} Hz` : '—'} (SNR {d.heartSnrDb.toFixed(0)} dB)</div>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={spec} margin={{ top: 2, right: 4, bottom: 0, left: -28 }}>
            <CartesianGrid stroke="#1e293b" />
            <XAxis dataKey="f" type="number" domain={[0, 2.5]} tick={{ fontSize: 9, fill: '#94a3b8' }} />
            <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} />
            <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 11 }} formatter={(v) => [Number(v).toFixed(3), 'moc']} labelFormatter={l => `${l} Hz`} />
            {d.breathingHz && <ReferenceLine x={d.breathingHz} stroke="#22c55e" strokeDasharray="3 3" />}
            {d.heartHz && <ReferenceLine x={d.heartHz} stroke="#f43f5e" strokeDasharray="3 3" />}
            <Line dataKey="p" dot={false} stroke="#38bdf8" strokeWidth={1.2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DetectionCard({ d }: { d: RadarDetection }) {
  const measurements = useMissionStore(s => s.measurements);
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState<string | null>(null);
  const ms = useMissionStore.getState();
  const mine = measurements
    .filter(m => d.siteIds.includes(m.siteId) || m.hotspotId === d.hotspotId)
    .sort((a, b) => Number(d.siteIds.includes(b.siteId)) - Number(d.siteIds.includes(a.siteId)));
  const shown = mine.find(m => m.siteId === site) ?? mine.find(m => m.detection.detected) ?? mine[0];
  const e = d.estimate;
  const tone = d.vital ? (d.status === 'confirmed' ? 'border-green-500/50 bg-green-500/10' : 'border-red-500/50 bg-red-500/10') : 'border-border/50 bg-muted/20';
  return (
    <div className={`rounded-lg border p-3 space-y-2 text-sm ${tone} ${d.status === 'rejected' ? 'opacity-60' : ''}`} data-testid="detection-card">
      <div className="flex justify-between items-start gap-2">
        <div>
          <div className="font-bold flex items-center gap-1.5">
            {d.vital ? <HeartPulse className="h-4 w-4 text-red-400" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
            {d.vital ? 'Oznaki życia' : 'Brak oznak życia'} · {d.hotspotId}
            {d.hotspotIds.length > 1 && <span className="font-normal text-xs text-muted-foreground">(też {d.hotspotIds.slice(1).join(', ')})</span>}
          </div>
          <div className="text-xs text-muted-foreground">Punkty z detekcją {d.nDetected}/{d.nMeasured}{d.disturbed ? ` · zakłócenia: ${d.disturbed}` : ''}{d.refining ? ' · trwają pomiary' : ''}</div>
        </div>
        {d.vital && <span className="text-xs font-mono">{(d.confidence * 100).toFixed(0)}%</span>}
      </div>
      {d.vital && (
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <div className="bg-background/50 rounded p-1.5"><div className="text-muted-foreground">Głębokość</div><div className="font-bold">{e ? `${e.depthMin.toFixed(1)}–${e.depthMax.toFixed(1)} m` : 'nieznana (< 3 pkt)'}</div></div>
          <div className="bg-background/50 rounded p-1.5"><div className="text-muted-foreground">Położenie</div><div className="font-bold">{e ? `±${e.horizontalErr.toFixed(1)} m` : '± kilka m'}</div></div>
          <div className="bg-background/50 rounded p-1.5"><div className="text-muted-foreground">Oddech</div><div className="font-bold">{d.breathingHz ? `${(d.breathingHz * 60).toFixed(0)} /min` : '—'}</div></div>
          <div className="bg-background/50 rounded p-1.5"><div className="text-muted-foreground">Tętno</div><div className="font-bold">{d.heartHz ? `${(d.heartHz * 60).toFixed(0)} /min` : '—'}</div></div>
        </div>
      )}
      <div className="text-xs text-muted-foreground">{d.note}</div>
      <div className="text-[11px] font-mono text-muted-foreground">{d.lat.toFixed(6)} N, {d.lng.toFixed(6)} E{e ? ` · εr ${e.epsMin.toFixed(1)}–${e.epsMax.toFixed(1)}` : ''}</div>
      <div className="flex flex-wrap gap-1.5">
        {d.status === 'pending' ? (
          <>
            <button onClick={() => ms.setDetectionStatus(d.id, 'confirmed')} className="flex-1 bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-600/50 py-1 rounded flex justify-center items-center gap-1 text-xs" data-testid="confirm"><CheckCircle className="h-3.5 w-3.5" /> Zatwierdź</button>
            <button onClick={() => ms.setDetectionStatus(d.id, 'rejected')} className="flex-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-600/50 py-1 rounded flex justify-center items-center gap-1 text-xs"><XCircle className="h-3.5 w-3.5" /> Odrzuć</button>
          </>
        ) : (
          <button onClick={() => ms.setDetectionStatus(d.id, 'pending')} className="flex-1 border border-border/60 py-1 rounded flex justify-center items-center gap-1 text-xs hover:bg-muted"><Undo2 className="h-3.5 w-3.5" /> {d.status === 'confirmed' ? 'Zatwierdzone' : 'Odrzucone'} — cofnij</button>
        )}
        <button title="Pokaż na mapie" onClick={() => ms.flyTo(d.lng, d.lat, 19.5)} className="px-2 border border-border/60 rounded hover:bg-muted"><Crosshair className="h-3.5 w-3.5" /></button>
        <button title="Pokaż w 3D" onClick={() => ms.openViewer(d.hotspotId)} className="px-2 border border-border/60 rounded hover:bg-muted"><Box className="h-3.5 w-3.5" /></button>
        <button title="Powtórz pomiar" onClick={() => ms.remeasureHotspot(d.hotspotId)} className="px-2 border border-border/60 rounded hover:bg-muted"><RotateCcw className="h-3.5 w-3.5" /></button>
      </div>
      {d.vital && !e && !d.refining && (
        <button onClick={() => ms.refineDetection(d.id)} className="w-full text-xs py-1 border border-amber-500/50 text-amber-300 rounded hover:bg-amber-500/10">Dogęść pomiar (dodatkowe lądowiska bliżej detekcji)</button>
      )}
      <button onClick={() => setOpen(!open)} className="text-xs text-primary hover:underline">{open ? 'Ukryj' : 'Pokaż'} pomiary radaru ({mine.length})</button>
      {open && shown && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {mine.map(m => (
              <button key={m.siteId} onClick={() => setSite(m.siteId)} className={`text-[10px] px-1.5 py-0.5 rounded border ${m.siteId === shown.siteId ? 'border-primary' : 'border-border/50'} ${m.detection.detected ? 'text-green-400' : 'text-muted-foreground'}`}>
                {m.siteId.split('-').pop()} {m.detection.detected ? '♥' : '–'}{m.detection.disturbed ? ' ⚠' : ''}
              </button>
            ))}
          </div>
          <SignalCharts m={shown} />
        </div>
      )}
    </div>
  );
}

export function DetectionsPanel() {
  const detections = useMissionStore(s => s.detections);
  const hotspots = useMissionStore(s => s.hotspots);
  const landingSites = useMissionStore(s => s.landingSites);
  const anchor = useMissionStore(s => s.anchor);
  const sorted = [...detections].sort((a, b) => Number(b.vital) - Number(a.vital) || b.confidence - a.confidence);
  const pending = detections.filter(d => d.status === 'pending' && d.vital).length;

  const exportData = (fmt: 'geojson' | 'kml') => {
    if (!anchor) return;
    const fc = buildGeoJson(anchor, hotspots, landingSites, detections);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    if (fmt === 'geojson') download(`skysar-${stamp}.geojson`, JSON.stringify(fc, null, 2), 'application/geo+json');
    else download(`skysar-${stamp}.kml`, buildKml(fc), 'application/vnd.google-earth.kml+xml');
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-4 custom-scrollbar" data-testid="detections-panel">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Wyniki radaru — do zatwierdzenia</h3>
        {pending > 0 && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-bold">{pending} oczekuje</span>}
      </div>
      {detections.length === 0 ? (
        <p className="text-sm text-muted-foreground">Brak pomiarów. Po fazie 1 wyślij drony radarowe — każdy hot spot jest mierzony z 3–4 miejsc lądowania.</p>
      ) : (
        <div className="space-y-2">{sorted.map(d => <DetectionCard key={d.id} d={d} />)}</div>
      )}
      {anchor && (hotspots.length > 0 || detections.length > 0) && (
        <div className="pt-3 border-t border-border/40 space-y-2">
          <div className="text-xs text-muted-foreground">Eksport mapy dla tabletu ratownika i systemu dowodzenia (offline):</div>
          <div className="flex gap-2">
            <button onClick={() => exportData('geojson')} className="flex-1 py-1.5 text-xs border border-border/60 rounded hover:bg-muted flex items-center justify-center gap-1"><Download className="h-3.5 w-3.5" /> GeoJSON</button>
            <button onClick={() => exportData('kml')} className="flex-1 py-1.5 text-xs border border-border/60 rounded hover:bg-muted flex items-center justify-center gap-1"><Download className="h-3.5 w-3.5" /> KML</button>
          </div>
        </div>
      )}
    </div>
  );
}
