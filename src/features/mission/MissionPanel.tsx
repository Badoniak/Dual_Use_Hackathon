import { Crosshair, Hexagon, LocateFixed, MapPin, Pause, Play, Plane, Radar, RotateCcw, Square, SkipForward, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMissionStore, areaCentroid, type DrawMode } from '../../store/useMissionStore';
import { useDroneStore, STATUS_LABEL, statusLabel, type Drone } from '../../store/useDroneStore';
import { simSitePreset } from './presets';
import { planCoverage } from '../../sim/flightPlan';
import { lngLatToLocal } from '../../sim/geo';
import { recallDrone } from '../../engine/engine';

function previewPlan(ring: [number, number][], altitude: number) {
  const a = { lat0: ring[0][1], lon0: ring[0][0], mode: 'gps' as const };
  return planCoverage(ring.map(([lng, lat]) => lngLatToLocal(a, lng, lat)), { altitude });
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function DrawButton({ mode, label, icon }: { mode: DrawMode; label: string; icon: ReactNode }) {
  const drawMode = useMissionStore(s => s.drawMode);
  const setDrawMode = useMissionStore(s => s.setDrawMode);
  const active = drawMode === mode;
  return (
    <button
      onClick={() => setDrawMode(active ? 'none' : mode)}
      className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-md border text-xs font-medium transition-colors ${active ? 'bg-amber-500 text-black border-amber-500' : 'bg-muted/30 border-border/60 hover:bg-muted/60'}`}
    >
      {icon}
      {label}
    </button>
  );
}

function Progress({ value, color = 'bg-primary' }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function RadarDroneRow({ d }: { d: Drone }) {
  const simTime = useDroneStore(s => s.simTime);
  const phasePct = d.phaseEndsAt > d.phaseStartedAt ? ((simTime - d.phaseStartedAt) / (d.phaseEndsAt - d.phaseStartedAt)) * 100 : 0;
  const busy = d.status === 'measuring' || d.status === 'landing' || d.status === 'takeoff' || d.status === 'charging';
  const active = d.status !== 'base' && d.status !== 'charging' && d.status !== 'returning';
  const probe = useMissionStore(s => (d.taskSiteId ? s.landingSites.find(l => l.id === d.taskSiteId)?.method === 'probe' : false));
  return (
    <div className={`bg-muted/30 p-2 rounded border border-border/50 text-xs space-y-1 ${d.enabled ? '' : 'opacity-60'}`} data-testid={`drone-${d.id}`}>
      <div className="flex justify-between items-center gap-2">
        <label className="flex items-center gap-1.5 font-semibold cursor-pointer" title="Dron dostępny do przydziału zadań">
          <input type="checkbox" checked={d.enabled} onChange={() => useDroneStore.getState().updateDrone(d.id, { enabled: !d.enabled })} className="accent-green-500" data-testid={`enable-${d.id}`} />
          {d.name}
        </label>
        <div className="flex items-center gap-1">
          {active && <button onClick={() => recallDrone(d.id)} className="px-1.5 py-0.5 rounded border border-amber-500/50 text-amber-300 hover:bg-amber-500/10" data-testid={`recall-${d.id}`}>Zawróć</button>}
          <span className={`px-1.5 py-0.5 rounded ${d.status === 'measuring' ? 'bg-yellow-500/20 text-yellow-400' : d.status === 'base' ? 'bg-muted text-muted-foreground' : 'bg-green-500/15 text-green-400'}`}>{d.enabled || d.status !== 'base' ? statusLabel(d, probe) : 'Wyłączony'}</span>
        </div>
      </div>
      <div className="flex justify-between text-muted-foreground">
        <span>{d.taskSiteId ? `Cel: ${d.taskSiteId}` : 'Bez zadania'}</span>
        <span>Bateria {d.battery.toFixed(0)}% · pomiary {d.measurementsDone}</span>
      </div>
      {busy && <Progress value={phasePct} color={d.status === 'measuring' ? 'bg-yellow-400' : 'bg-green-500'} />}
    </div>
  );
}

export function MissionPanel() {
  const areas = useMissionStore(s => s.areas);
  const activeAreaId = useMissionStore(s => s.activeAreaId);
  const drawMode = useMissionStore(s => s.drawMode);
  const lkpRadiusM = useMissionStore(s => s.lkpRadiusM);
  const phase = useMissionStore(s => s.phase);
  const processing = useMissionStore(s => s.processing);
  const scoutTrack = useMissionStore(s => s.scoutTrack);
  const hotspots = useMissionStore(s => s.hotspots);
  const landingSites = useMissionStore(s => s.landingSites);
  const measurements = useMissionStore(s => s.measurements);
  const radarQueue = useMissionStore(s => s.radarQueue);
  const anchor = useMissionStore(s => s.anchor);
  const ms = useMissionStore.getState();

  const drones = useDroneStore(s => s.drones);
  const simTime = useDroneStore(s => s.simTime);
  const timeMultiplier = useDroneStore(s => s.timeMultiplier);
  const paused = useDroneStore(s => s.paused);
  const scout = drones.find(d => d.role === 'scout')!;
  const radars = drones.filter(d => d.role === 'radar');

  const activeArea = areas.find(a => a.id === activeAreaId);
  const flightTotal = scoutTrack ? scoutTrack.plan.duration : 0;
  const flightAltitude = useMissionStore(s => s.flightAltitude);
  const preview = activeArea ? previewPlan(activeArea.feature.geometry.coordinates[0] as [number, number][], flightAltitude) : null;
  const flightElapsed = scoutTrack ? Math.min(flightTotal, simTime - scoutTrack.startSim) : 0;
  const candidates = hotspots.filter(h => h.radarCandidate);
  const candSet = new Set(candidates.map(h => h.id));
  const pendingSites = landingSites.filter(l => candSet.has(l.hotspotId) && !measurements.some(m => m.siteId === l.id)).length;
  const hasResult = processing.status === 'done';
  const radarBusy = phase === 'radar';

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-5 custom-scrollbar" data-testid="mission-panel">
      {/* 1. Obszar */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 font-semibold"><span className="text-xs bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center">1</span>Obszar działań</h3>
        <div className="flex gap-2">
          <DrawButton mode="polygon" label="Wielokąt" icon={<Hexagon className="h-4 w-4" />} />
          <DrawButton mode="rectangle" label="Prostokąt" icon={<Square className="h-4 w-4" />} />
          <DrawButton mode="lkp" label="LKP + promień" icon={<MapPin className="h-4 w-4" />} />
        </div>
        {(drawMode === 'lkp' || activeArea?.lkp) && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Promień wokół LKP</span>
              <span className="font-medium text-foreground">{(activeArea?.lkp && drawMode !== 'lkp' ? activeArea.lkp.radiusM : lkpRadiusM).toFixed(0)} m</span>
            </div>
            <input
              type="range" min={10} max={300} step={5}
              value={activeArea?.lkp && drawMode !== 'lkp' ? activeArea.lkp.radiusM : lkpRadiusM}
              onChange={e => {
                const r = parseFloat(e.target.value);
                if (activeArea?.lkp && drawMode !== 'lkp') ms.updateLkpRadius(activeArea.id, r);
                else ms.setLkpRadius(r);
              }}
              className="w-full accent-amber-500"
            />
          </div>
        )}
        <button
          onClick={() => {
            const f = simSitePreset();
            const id = ms.addArea(f, 'preset', { name: 'Remiza (symulacja)' });
            ms.setActiveArea(id);
            const c = areaCentroid(useMissionStore.getState().areas.find(a => a.id === id)!);
            ms.flyTo(c[0], c[1], 18.3);
          }}
          className="w-full text-xs py-1.5 rounded border border-dashed border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center gap-1"
        >
          <LocateFixed className="h-3.5 w-3.5" /> Zaznacz miejsce zdarzenia z danych symulacji (Warszawa)
        </button>
        {areas.length > 0 ? (
          <div className="space-y-1.5">
            {areas.map(a => (
              <div key={a.id} className={`flex items-center gap-2 p-2 rounded border text-sm cursor-pointer ${a.id === activeAreaId ? 'border-amber-500/70 bg-amber-500/10' : 'border-border/50 bg-muted/20 hover:bg-muted/40'}`} onClick={() => ms.setActiveArea(a.id)} data-testid="area-row">
                <input type="radio" readOnly checked={a.id === activeAreaId} className="accent-amber-500" />
                <span className="font-medium flex-1 truncate">{a.name}</span>
                <span className="text-xs text-muted-foreground">{a.areaM2 >= 10000 ? `${(a.areaM2 / 10000).toFixed(2)} ha` : `${a.areaM2.toFixed(0)} m²`}</span>
                <button title="Pokaż" onClick={e => { e.stopPropagation(); const c = areaCentroid(a); ms.flyTo(c[0], c[1], 18); }} className="p-1 hover:text-primary"><Crosshair className="h-3.5 w-3.5" /></button>
                <button title="Usuń" onClick={e => { e.stopPropagation(); ms.removeArea(a.id); }} className="p-1 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Narysuj mały obszar (0,1–1 ha) nad gruzowiskiem. Dane z symulacji zostaną przypisane do wybranego obszaru.</p>
        )}
      </section>

      {/* 2. Zwiad */}
      <section className="space-y-3 pt-4 border-t border-border/40">
        <h3 className="flex items-center gap-2 font-semibold"><span className="text-xs bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center">2</span>Faza 1 — zwiad i mapa 3D</h3>
        <div className="space-y-1">
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Wysokość lotu zwiadowcy</span><span className="font-medium">{flightAltitude} m</span></div>
          <input type="range" min={20} max={60} step={5} value={flightAltitude} disabled={phase === 'scouting'} onChange={e => ms.setFlightAltitude(parseFloat(e.target.value))} className="w-full accent-blue-500" data-testid="altitude" />
          {preview && (
            <div className="text-[11px] text-muted-foreground" data-testid="plan-preview">
              Plan: {preview.lines} {preview.lines === 1 ? 'linia' : preview.lines < 5 ? 'linie' : 'linii'} · pas termowizji {preview.swath.toFixed(0)} m · trasa {preview.lengthM.toFixed(0)} m · ~{fmtTime(preview.duration)}
            </div>
          )}
        </div>
        <div className="bg-muted/30 p-3 rounded border border-border/50 text-xs space-y-2">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-sm flex items-center gap-1"><Plane className="h-4 w-4 text-blue-400" />{scout.name}</span>
            <span className="text-muted-foreground">{STATUS_LABEL[scout.status]} · {scout.battery.toFixed(0)}%</span>
          </div>
          <div className="text-muted-foreground">{scout.sensors.join(' · ')}</div>
          {scoutTrack && (
            <div className="space-y-1">
              <div className="flex justify-between"><span>Lot nad obszarem ({scoutTrack.plan.lines} linii, {scoutTrack.plan.altitude} m)</span><span className="font-mono">{fmtTime(flightElapsed)} / {fmtTime(flightTotal)}</span></div>
              <Progress value={(flightElapsed / flightTotal) * 100} color="bg-blue-500" />
            </div>
          )}
          {processing.status !== 'idle' && (
            <div className="space-y-1" data-testid="processing">
              <div className="flex justify-between"><span>Przetwarzanie w stacji naziemnej</span><span className="font-mono">{processing.pct.toFixed(0)}%</span></div>
              <Progress value={processing.pct} color={processing.status === 'error' ? 'bg-destructive' : 'bg-emerald-500'} />
              <div className={processing.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{processing.message}</div>
            </div>
          )}
          {anchor && <div className="text-muted-foreground">Dane czujników: sesja z Gazebo {anchor.mode === 'gps' ? '(georeferencja z GPS drona)' : 'nałożona na wybrany obszar'} — skan 3D narasta na mapie w trakcie lotu.</div>}
        </div>
        {phase === 'scouting' ? (
          <button onClick={() => ms.skipScoutFlight()} className="w-full py-2 border border-blue-500/50 text-blue-300 rounded-md flex justify-center items-center gap-2 hover:bg-blue-500/10 text-sm font-medium">
            <SkipForward className="h-4 w-4" /> Przyspiesz — zakończ odtwarzanie lotu
          </button>
        ) : (
          <button
            disabled={!activeArea || radarBusy}
            onClick={() => ms.launchScout()}
            className="w-full py-2 bg-blue-600 disabled:opacity-40 text-white rounded-md flex justify-center items-center gap-2 hover:bg-blue-500 transition text-sm font-bold"
            data-testid="launch-scout"
          >
            <Play className="h-4 w-4" /> {hasResult ? 'Powtórz zwiad nad obszarem' : 'Wyślij zwiadowcę nad obszar'}
          </button>
        )}
        {phase === 'scouting' && hasResult && <p className="text-xs text-muted-foreground">Dane przetworzone — wyniki pojawią się po wylądowaniu zwiadowcy.</p>}
        {hasResult && phase !== 'scouting' && (
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-background/50 p-2 rounded border border-border/30"><div className="text-lg font-bold">{hotspots.length}</div>hot spotów</div>
            <div className="bg-background/50 p-2 rounded border border-border/30"><div className="text-lg font-bold">{candidates.length}</div>do radaru</div>
            <div className="bg-background/50 p-2 rounded border border-border/30"><div className="text-lg font-bold">{landingSites.filter(l => candSet.has(l.hotspotId)).length}</div>lądowisk</div>
          </div>
        )}
      </section>

      {/* 3. Radary */}
      <section className="space-y-3 pt-4 border-t border-border/40">
        <h3 className="flex items-center gap-2 font-semibold"><span className="text-xs bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center">3</span>Faza 2 — pomiar radarem SFCW</h3>
        <p className="text-xs text-muted-foreground">Drony lądują jak najbliżej hot spotu (zwykle 1–2,5 m), a na stromym gruzie opuszczają sondę radaru na lince (wariant T). 3 punkty na hot spot dają pozycję 3D i przedział głębokości.</p>
        <div className="space-y-1.5">{radars.map(d => <RadarDroneRow key={d.id} d={d} />)}</div>
        {radarBusy && (
          <div className="text-xs text-muted-foreground">W kolejce: {radarQueue.length} · zmierzono: {measurements.length} / {measurements.length + pendingSites}</div>
        )}
        <button
          disabled={!hasResult || phase === 'scouting' || pendingSites === 0}
          onClick={() => ms.launchRadar()}
          className="w-full py-2 bg-green-600 disabled:opacity-40 text-white rounded-md flex justify-center items-center gap-2 hover:bg-green-500 transition text-sm font-bold"
          data-testid="launch-radar"
        >
          <Radar className="h-4 w-4" /> {radarBusy ? `Dodaj do kolejki (${pendingSites} pkt)` : `Wyślij radary (${pendingSites} punktów pomiaru)`}
        </button>
      </section>

      {/* Czas */}
      <section className="space-y-2 pt-4 border-t border-border/40">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Upływ czasu symulacji</span>
          <div className="flex items-center gap-1">
            <button onClick={() => useDroneStore.getState().setPaused(!paused)} className="p-1 rounded hover:bg-muted" title={paused ? 'Wznów' : 'Pauza'}>{paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}</button>
            <div className="flex bg-muted/50 rounded overflow-hidden">
              {[1, 4, 10, 30, 60].map(m => (
                <button key={m} onClick={() => useDroneStore.getState().setTimeMultiplier(m)} className={`px-2 py-1 font-mono ${timeMultiplier === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{m}×</button>
              ))}
            </div>
          </div>
        </div>
        <button onClick={() => ms.resetMission(true)} className="w-full py-1.5 text-xs border border-destructive/40 text-destructive rounded hover:bg-destructive/10 flex items-center justify-center gap-1">
          <RotateCcw className="h-3.5 w-3.5" /> Resetuj misję (zachowaj obszary)
        </button>
      </section>
    </div>
  );
}
