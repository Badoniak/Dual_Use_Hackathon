import { useEffect, useRef, useState } from 'react';
import { Box, Crosshair, Flag, Hand, Mic, Plus, ThermometerSun, Trash2, UserRound } from 'lucide-react';
import { useMissionStore, SIM_DATA_URL } from '../../store/useMissionStore';
import { localToLngLat } from '../../sim/geo';
import { describeAcoustic } from '../../sim/fusion';
import type { Hotspot } from '../../sim/types';
import type { RasterImage } from '../../sim/pipeline';
import { HOTSPOT_COLORS } from '../map/constants';

function RasterCanvas({ img, className }: { img: RasterImage; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  }, [img]);
  return <canvas ref={ref} className={className} />;
}

const KIND_ICON = {
  fused: UserRound,
  manual: Hand,
} as const;

function EvidenceRow({ icon: Icon, label, value, note, color }: { icon: typeof Mic; label: string; value: number; note: string; color: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 text-[11px]">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
        <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full" style={{ width: `${value * 100}%`, background: color }} /></div>
        <span className="w-9 text-right font-mono">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="text-[10px] text-muted-foreground pl-5 leading-tight">{note}</div>
    </div>
  );
}

function frameStamp(file: string): number {
  const m = /_(\d+)_(\d+)\.\w+$/.exec(file);
  return m ? parseInt(m[1], 10) + parseInt(m[2], 10) * 1e-9 : NaN;
}

function HotspotCard({ h }: { h: Hotspot }) {
  const selected = useMissionStore(s => s.selectedHotspotId === h.id);
  const anchor = useMissionStore(s => s.anchor);
  const result = useMissionStore(s => s.result);
  const allSites = useMissionStore(s => s.landingSites);
  const phase = useMissionStore(s => s.phase);
  const radarQueue = useMissionStore(s => s.radarQueue);
  const prio = useMissionStore(s => s.priorityHotspots[0] === h.id);
  const measured = useMissionStore(s => s.measurements.reduce((n, m) => n + (m.hotspotId === h.id ? 1 : 0), 0));
  const sites = allSites.filter(l => l.hotspotId === h.id);
  const pendingHere = sites.filter(l => radarQueue.includes(l.id)).length;
  const ms = useMissionStore.getState();
  const Icon = KIND_ICON[h.kind];
  const [lng, lat] = anchor ? localToLngLat(anchor, h.position[0], h.position[1]) : [0, 0];
  const thumb = h.bestFrame && result ? result.thumbnails[h.bestFrame] : undefined;
  let rgbFile: string | null = null;
  if (h.bestFrame && result?.rgbFrames.length) {
    const st = frameStamp(h.bestFrame);
    rgbFile = result.rgbFrames.reduce((a, b) => (Math.abs(b.stamp - st) < Math.abs(a.stamp - st) ? b : a)).file;
  }
  const ev = h.evidence;
  return (
    <div
      className={`rounded-lg border p-3 space-y-2 text-sm transition-colors ${selected ? 'border-amber-500 bg-amber-500/5' : 'border-border/50 bg-muted/20 hover:bg-muted/30'} ${h.confidence < 0.5 ? 'opacity-80' : ''}`}
      onClick={() => ms.selectHotspot(selected ? null : h.id)}
      data-testid="hotspot-card"
    >
      <div className="flex items-start gap-2">
        <div className="rounded-full p-1.5 mt-0.5" style={{ background: HOTSPOT_COLORS[h.kind] + '33', color: HOTSPOT_COLORS[h.kind] }}><Icon className="h-4 w-4" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-center gap-2">
            <span className="font-bold">{h.id} <span className="font-normal text-muted-foreground">· {h.label}</span></span>
            <span className="text-xs font-mono">{(h.confidence * 100).toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
            <div className="h-full" style={{ width: `${h.confidence * 100}%`, background: HOTSPOT_COLORS[h.kind] }} />
          </div>
        </div>
      </div>
      {h.kind === 'fused' ? (
        <div className="space-y-1.5">
          <EvidenceRow icon={ThermometerSun} label="Termowizja" value={ev.thermal} note={h.thermalNote} color="#f87171" />
          <EvidenceRow icon={Mic} label="Mikrofon" value={ev.acoustic} note={h.acousticNote} color="#c084fc" />
        </div>
      ) : (
        <div className="text-[11px] text-blue-300">Wskazane przez ratownika (np. stukanie, relacja świadka)</div>
      )}
      <div className="text-[11px] font-mono text-muted-foreground">
        {lat.toFixed(6)} N, {lng.toFixed(6)} E · pow. {h.position[2].toFixed(1)} m{h.sourceZ !== null ? ` · źródło z=${h.sourceZ.toFixed(1)} m` : ''}
      </div>
      {selected && (
        <div className="space-y-2" onClick={e => e.stopPropagation()}>
          {h.reasons.length > 0 && <ul className="text-xs list-disc ml-4 space-y-0.5 text-amber-300/90">{h.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          {(thumb || rgbFile) && (
            <div className="grid grid-cols-2 gap-1.5">
              {thumb && <figure><RasterCanvas img={thumb} className="w-full rounded border border-border/50" /><figcaption className="text-[10px] text-muted-foreground mt-0.5">Termowizja t={frameStamp(h.bestFrame!).toFixed(1)} s</figcaption></figure>}
              {rgbFile && <figure><img src={SIM_DATA_URL + 'rgbd_camera_rgb/' + rgbFile} className="w-full rounded border border-border/50" alt="RGB" /><figcaption className="text-[10px] text-muted-foreground mt-0.5">Kamera RGB (najbliższa klatka)</figcaption></figure>}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            {`Punkty pomiaru: ${sites.length}${sites.length ? ` (${sites.map(s => `${s.horizontal.toFixed(1)} m${s.method === 'probe' ? ' sonda' : ` / ${s.slopeDeg.toFixed(0)}°`}`).join(', ')})` : ''} · zmierzono ${measured}`}
            {h.radarCandidate && sites.length < 3 && <span className="text-amber-400"> — w pobliżu brak bezpiecznych miejsc nawet dla sondy (ściany/nawisy); pozycja 3D możliwa po dogęszczeniu pomiaru lub z punktów sąsiednich hot spotów.</span>}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer mr-auto">
          <input type="checkbox" checked={h.radarCandidate} onChange={() => ms.toggleRadarCandidate(h.id)} className="accent-green-500" data-testid="radar-toggle" />
          Pomiar radarem
        </label>
        {pendingHere > 0 && phase === 'radar' && (
          <button title="Mierz ten hot spot w pierwszej kolejności" onClick={() => ms.prioritizeHotspot(h.id)} className={`px-1.5 py-1 rounded text-[11px] flex items-center gap-1 ${prio ? 'bg-amber-500/20 text-amber-300' : 'hover:bg-muted'}`}><Flag className="h-3.5 w-3.5" />{prio ? 'Priorytet' : 'Najpierw'}</button>
        )}
        <button title="Pokaż na mapie" onClick={() => { ms.selectHotspot(h.id); ms.flyTo(lng, lat, 19.5); }} className="p-1.5 rounded hover:bg-muted"><Crosshair className="h-3.5 w-3.5" /></button>
        <button title="Pokaż w 3D" onClick={() => ms.openViewer(h.id)} className="p-1.5 rounded hover:bg-muted"><Box className="h-3.5 w-3.5" /></button>
        <button title="Usuń" onClick={() => ms.removeHotspot(h.id)} className="p-1.5 rounded hover:bg-muted hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

export function HotspotsPanel() {
  const hotspots = useMissionStore(s => s.hotspots);
  const phase = useMissionStore(s => s.phase);
  const result = useMissionStore(s => s.result);
  const drawMode = useMissionStore(s => s.drawMode);
  const [showWeak, setShowWeak] = useState(false);
  const ms = useMissionStore.getState();
  const revealed = useMissionStore(s => s.revealed);
  const visible = phase === 'scouting' ? hotspots.filter(h => revealed.includes(h.id)) : hotspots;
  const strong = visible.filter(h => h.confidence >= 0.5 || h.kind === 'manual');
  const weak = visible.filter(h => !(h.confidence >= 0.5 || h.kind === 'manual'));
  const zones = result && phase !== 'scouting' ? result.acousticZones : [];

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-4 custom-scrollbar" data-testid="hotspots-panel">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Potencjalne miejsca osób</h3>
        <span className="text-xs text-muted-foreground">{strong.length} istotnych</span>
      </div>
      {visible.length === 0 && (
        <p className="text-sm text-muted-foreground">{phase === 'scouting' ? 'Zwiadowca skanuje obszar — hot spoty pojawią się, gdy dron nad nimi przeleci.' : 'Brak danych. Wyślij zwiadowcę nad obszar — każdy hot spot łączy termowizję (anomalia cieplna na mapie 3D) i mikrofon (dźwięk narastający w pobliżu).'}</p>
      )}
      {visible.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">System proponuje, ratownik decyduje. Brak hot spotu nie oznacza braku ludzi.</p>
          <button
            onClick={() => ms.setDrawMode(drawMode === 'manual-hotspot' ? 'none' : 'manual-hotspot')}
            className={`w-full py-1.5 text-xs rounded border flex items-center justify-center gap-1 ${drawMode === 'manual-hotspot' ? 'bg-amber-500 text-black border-amber-500' : 'border-border/60 hover:bg-muted/50'}`}
          >
            <Plus className="h-3.5 w-3.5" /> Dodaj ręczny hot spot (kliknij na mapie)
          </button>
          <div className="space-y-2">{strong.map(h => <HotspotCard key={h.id} h={h} />)}</div>
          {weak.length > 0 && (
            <div>
              <button onClick={() => setShowWeak(!showWeak)} className="text-xs text-muted-foreground hover:text-foreground">
                {showWeak ? 'Ukryj' : 'Pokaż'} słabe sygnały ({weak.length}, ufność &lt; 50%)
              </button>
              {showWeak && <div className="space-y-2 mt-2">{weak.map(h => <HotspotCard key={h.id} h={h} />)}</div>}
            </div>
          )}
        </>
      )}
      {zones.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-border/40">
          <h4 className="text-sm font-semibold flex items-center gap-1"><Mic className="h-4 w-4 text-purple-400" /> Sygnały z mikrofonu bez dokładnej lokalizacji</h4>
          {zones.map(z => (
            <div key={z.id} className="text-xs bg-purple-500/10 border border-purple-500/30 rounded p-2 space-y-1">
              <div>{describeAcoustic(z)}</div>
              <div className="text-muted-foreground">Słyszalny w t = {z.tFirst.toFixed(0)}–{z.tLast.toFixed(0)} s. Pojedynczy mikrofon na dronie daje tylko zgrubną strefę — wskaż punkt ręcznie, jeśli ratownicy słyszą sygnał.</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
