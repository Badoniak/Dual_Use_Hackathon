import { Eye, EyeOff, FlaskConical, MapPinned, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { useMissionStore, areaCentroid } from '../../store/useMissionStore';
import { maxDetectionRange, DEFAULT_RADAR_PARAMS } from '../../sim/radar';
import { sampleHeight } from '../../sim/grid';
import { simSitePreset } from '../mission/presets';

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="font-medium">{fmt(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="w-full accent-primary" />
    </div>
  );
}

export function ScenarioPanel() {
  const scenario = useMissionStore(s => s.scenario);
  const simVictims = useMissionStore(s => s.simVictims);
  const result = useMissionStore(s => s.result);
  const detections = useMissionStore(s => s.detections);
  const drawMode = useMissionStore(s => s.drawMode);
  const victimDepthM = useMissionStore(s => s.victimDepthM);
  const showTruth = useMissionStore(s => s.mapLayers.victimsTruth);
  const ms = useMissionStore.getState();
  const range = maxDetectionRange({ ...DEFAULT_RADAR_PARAMS, attenuationDbPerM: scenario.attenuationDbPerM });
  const depthOf = (p: [number, number, number]) => (result ? sampleHeight(result.heightmap, p[0], p[1]) - p[2] : NaN);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-5 custom-scrollbar" data-testid="scenario-panel">
      <section className="space-y-2">
        <h3 className="font-semibold flex items-center gap-2"><MapPinned className="h-4 w-4 text-primary" /> Scenariusz demonstracyjny</h3>
        <button
          onClick={() => {
            ms.resetMission(false);
            const id = ms.addArea(simSitePreset(), 'preset', { name: 'Remiza (symulacja)' });
            const c = areaCentroid(useMissionStore.getState().areas.find(a => a.id === id)!);
            ms.flyTo(c[0], c[1], 18.3);
          }}
          className="w-full text-left p-3 rounded-lg border border-border/50 bg-muted/30 hover:bg-muted/50 space-y-1"
          data-testid="preset-site"
        >
          <div className="font-semibold text-sm">Gruzowisko: zawalona remiza (dane z Gazebo)</div>
          <div className="text-xs text-muted-foreground">Warszawa, 52.2297 N 21.0122 E — prawdziwe miejsce z GPS drona. Możesz też narysować dowolny obszar na mapie: skan zostanie przypisany do niego.</div>
        </button>
      </section>

      <section className="space-y-3 pt-4 border-t border-border/40">
        <h3 className="font-semibold flex items-center gap-2"><FlaskConical className="h-4 w-4 text-primary" /> Symulator radaru fazy 2</h3>
        <p className="text-xs text-muted-foreground">Radar jest syntetyczny (plan hackathonu: bez sprzętu). Model budżetu łącza z koncepcji: B = 81,5 dB po wylądowaniu.</p>
        <Slider label="Tłumienie gruzu (jedna strona)" value={scenario.attenuationDbPerM} min={5} max={40} step={1} fmt={v => `${v} dB/m → zasięg ~${range.toFixed(1)} m`} onChange={v => ms.setScenario({ attenuationDbPerM: v })} />
        <Slider label="Przenikalność gruzu εr (prawda, nieznana algorytmowi)" value={scenario.epsTrue} min={4} max={9} step={0.1} fmt={v => v.toFixed(1)} onChange={v => ms.setScenario({ epsTrue: v })} />
        <Slider label="Ryzyko ruchu w wiązce (brak ciszy radarowej)" value={scenario.disturbanceProb} min={0} max={0.6} step={0.05} fmt={v => `${(v * 100).toFixed(0)}%`} onChange={v => ms.setScenario({ disturbanceProb: v })} />
        <Slider label="Czas pomiaru w punkcie" value={scenario.measureS} min={60} max={120} step={10} fmt={v => `${v} s`} onChange={v => ms.setScenario({ measureS: v })} />
      </section>

      <section className="space-y-2 pt-4 border-t border-border/40">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Zasypane osoby w scenariuszu</h3>
          <button onClick={() => ms.setMapLayers({ victimsTruth: !showTruth })} className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground">
            {showTruth ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {showTruth ? 'Ukryj' : 'Pokaż'} na mapie
          </button>
        </div>
        <p className="text-xs text-muted-foreground">Znane tylko symulatorowi radaru — algorytmy fazy 1 i 2 ich nie widzą. Domyślnie: źródła „voice” z ground_truth/sound_sources.yaml.</p>
        {!result && <p className="text-xs text-amber-400">Lista pojawi się po przetworzeniu danych zwiadowcy (potrzebna mapa wysokości).</p>}
        {simVictims.map(v => {
          const depth = depthOf(v.position);
          return (
            <div key={v.id} className="flex items-center gap-2 text-xs bg-muted/30 border border-border/50 rounded p-2" data-testid="sim-victim">
              <div className="flex-1">
                <div className="font-medium">{v.id} · {v.name}</div>
                <div className="text-muted-foreground">
                  ({v.position.map(c => c.toFixed(1)).join(', ')}) · głęb. {Number.isNaN(depth) ? '?' : `${depth.toFixed(1)} m`}{!Number.isNaN(depth) && depth > range ? ' — poza zasięgiem radaru' : ''} · oddech {(v.breathHz * 60).toFixed(0)}/min
                </div>
              </div>
              <button onClick={() => ms.removeSimVictim(v.id)} className="p-1 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          );
        })}
        <Slider label="Głębokość nowej osoby" value={victimDepthM} min={0.3} max={4} step={0.1} fmt={v => `${v.toFixed(1)} m`} onChange={v => ms.setVictimDepth(v)} />
        <button disabled={!result} onClick={() => ms.placeVictimsAtHotspots(2, victimDepthM)} className="w-full py-1.5 text-xs rounded border border-border/60 hover:bg-muted disabled:opacity-40" data-testid="victims-at-hotspots">
          Umieść 2 osoby pod najsilniejszymi hot spotami ({victimDepthM.toFixed(1)} m)
        </button>
        <div className="flex gap-2">
          <button disabled={!result} onClick={() => ms.setDrawMode(drawMode === 'sim-victim' ? 'none' : 'sim-victim')} className={`flex-1 py-1.5 text-xs rounded border flex items-center justify-center gap-1 disabled:opacity-40 ${drawMode === 'sim-victim' ? 'bg-amber-500 text-black border-amber-500' : 'border-border/60 hover:bg-muted'}`}>
            <UserPlus className="h-3.5 w-3.5" /> Dodaj (kliknij na mapie)
          </button>
          <button disabled={!result} onClick={() => ms.resetSimVictims()} className="px-3 py-1.5 text-xs rounded border border-border/60 hover:bg-muted disabled:opacity-40" title="Przywróć z ground truth"><RotateCcw className="h-3.5 w-3.5" /></button>
        </div>
      </section>

      {detections.length > 0 && simVictims.length > 0 && (
        <section className="space-y-2 pt-4 border-t border-border/40">
          <h3 className="font-semibold text-sm">Ewaluacja względem prawdy scenariusza</h3>
          {detections.map(d => {
            const nearest = simVictims
              .map(v => ({ v, dh: Math.hypot(v.position[0] - d.local[0], v.position[1] - d.local[1]) }))
              .sort((a, b) => a.dh - b.dh)[0];
            const trueDepth = nearest ? depthOf(nearest.v.position) : NaN;
            const e = d.estimate;
            const inInterval = e && !Number.isNaN(trueDepth) ? trueDepth >= e.depthMin - 0.1 && trueDepth <= e.depthMax + 0.1 : null;
            const hit = nearest && nearest.dh < 3;
            return (
              <div key={d.id} className="text-xs bg-muted/20 border border-border/40 rounded p-2">
                <span className="font-medium">{d.hotspotId}:</span>{' '}
                {d.vital
                  ? hit
                    ? <>trafienie {nearest.v.id}, błąd poziomy {nearest.dh.toFixed(2)} m{e ? `, głębokość prawdziwa ${trueDepth.toFixed(2)} m ${inInterval ? '∈' : '∉'} [${e.depthMin.toFixed(2)}, ${e.depthMax.toFixed(2)}]` : ''}</>
                    : <span className="text-amber-400">fałszywy alarm (najbliższa osoba {nearest ? nearest.dh.toFixed(1) : '?'} m)</span>
                  : hit ? <span className="text-amber-400">pominięta osoba {nearest.v.id} ({nearest.dh.toFixed(1)} m, głęb. {trueDepth.toFixed(1)} m)</span> : 'poprawnie brak detekcji'}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
