import { useEffect, useState } from 'react';
import { Check, Clock, Crosshair, Satellite, ShieldAlert, X } from 'lucide-react';

import { Map } from './features/map/Map';
import { LayersPanel } from './features/layers/LayersPanel';
import { MissionPanel } from './features/mission/MissionPanel';
import { HotspotsPanel } from './features/hotspots/HotspotsPanel';
import { DetectionsPanel } from './features/detections/DetectionsPanel';
import { ScenarioPanel } from './features/scenario/ScenarioPanel';
import { LogsPanel } from './features/logs/LogsPanel';
import { PointCloudViewer } from './features/viewer/PointCloudViewer';
import { startEngine } from './engine/engine';
import { useMissionStore, type MissionPhase } from './store/useMissionStore';
import { useDroneStore } from './store/useDroneStore';
import { useLogStore } from './store/useLogStore';
import { useMapStore } from './store/useMapStore';

type Tab = 'misja' | 'hotspoty' | 'wykrycia' | 'scenariusz';

const STEPS: { phase: MissionPhase[]; label: string }[] = [
  { phase: ['planning'], label: 'Obszar' },
  { phase: ['scouting'], label: 'Zwiad' },
  { phase: ['analysis'], label: 'Hot spoty' },
  { phase: ['radar'], label: 'Radar' },
  { phase: ['complete'], label: 'Decyzje' },
];

function MissionClock() {
  const t = useDroneStore(s => s.simTime);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return <span className="font-mono">T+{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>;
}

function PhaseStepper() {
  const phase = useMissionStore(s => s.phase);
  const idx = STEPS.findIndex(s => s.phase.includes(phase));
  return (
    <div className="flex items-center gap-1 text-xs" data-testid="phase">
      {STEPS.map((s, i) => (
        <div key={s.label} className="flex items-center gap-1">
          <span className={`flex items-center gap-1 px-2 py-1 rounded ${i === idx ? 'bg-primary text-primary-foreground font-semibold' : i < idx ? 'text-green-400' : 'text-muted-foreground'}`}>
            {i < idx && <Check className="h-3 w-3" />}{s.label}
          </span>
          {i < STEPS.length - 1 && <span className="text-muted-foreground/50">›</span>}
        </div>
      ))}
    </div>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[10000] bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl max-w-2xl w-full p-6 space-y-3 text-sm" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-lg flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-400" /> Zasady użycia systemu</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-5 w-5" /></button>
        </div>
        <ul className="list-disc ml-5 space-y-1.5 text-muted-foreground">
          <li><b className="text-foreground">System wspiera decyzje, nie zastępuje ratownika.</b> Każde trafienie zatwierdza ratownik; pełny zapis danych i decyzji trafia do dziennika.</li>
          <li><b className="text-foreground">Brak trafienia nigdy nie oznacza braku ludzi</b> — strefa bez detekcji pozostaje otwarta.</li>
          <li><b className="text-foreground">Cisza radarowa:</b> podczas pomiaru (60–120 s) ratownicy odsuwają się lub zamierają w bezruchu. Ruch w wiązce = fałszywy alarm.</li>
          <li>Głębokość podawana jest jako <b className="text-foreground">przedział</b> — przenikalność gruzu (εr ≈ 4–9) jest nieznana.</li>
          <li>Loty zgłaszane do PAŻP (DroneTower); przy zbliżaniu się śmigłowca LPR/Policji drony schodzą do lądowania.</li>
          <li>Radar fazy 2 nadaje dopiero po wykryciu kontaktu z gruntem (georadar wg ETSI EN 302 066). GPR-SAR w powietrzu wymaga pozwolenia UKE.</li>
          <li>Dane osobowe (obrazy, termowizja, pozycje ludzi) — przetwarzanie lokalne, usuwanie po akcji (RODO).</li>
          <li>W tej wersji radar fazy 2 jest <b className="text-foreground">syntetyczny</b> (plan hackathonu), dane fazy 1 pochodzą z symulacji Gazebo.</li>
        </ul>
      </div>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>('misja');
  const [rules, setRules] = useState(false);
  const phase = useMissionStore(s => s.phase);
  const hotspots = useMissionStore(s => s.hotspots);
  const detections = useMissionStore(s => s.detections);
  const viewerOpen = useMissionStore(s => s.viewerOpen);
  const result = useMissionStore(s => s.result);
  const anchor = useMissionStore(s => s.anchor);

  useEffect(() => startEngine(), []);

  // wygodne przejścia między etapami misji
  useEffect(() => useMissionStore.subscribe((s, prev) => {
    if (s.phase === prev.phase) return;
    if (s.phase === 'analysis') setTab('hotspoty');
    if (s.phase === 'complete') setTab('wykrycia');
  }), []);

  // uchwyty dla testów e2e (tylko w trybie deweloperskim)
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__stores = { mission: useMissionStore, drones: useDroneStore, logs: useLogStore, map: useMapStore };
  }, []);

  const strong = phase === 'scouting' ? 0 : hotspots.filter(h => h.confidence >= 0.5 || h.kind === 'manual').length;
  const pending = detections.filter(d => d.status === 'pending' && d.vital).length;
  const gnss = result ? `GNSS: ±${result.stats.gpsResidualM.toFixed(1)} m${anchor?.mode === 'anchored' ? ' (demo)' : ''}` : 'GNSS: brak danych';

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'misja', label: 'Misja' },
    { id: 'hotspoty', label: 'Hot spoty', badge: strong || undefined },
    { id: 'wykrycia', label: 'Wykrycia', badge: pending || undefined },
    { id: 'scenariusz', label: 'Scenariusz' },
  ];

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden" onDragOver={e => e.preventDefault()} onDrop={e => e.preventDefault()}>
      <header className="h-14 border-b border-border/40 bg-background/95 flex items-center justify-between px-4 shrink-0 gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <Crosshair className="h-5 w-5 text-primary" />
          <h1 className="font-bold text-lg tracking-tight">SKYSAR</h1>
          <span className="text-xs text-muted-foreground hidden xl:inline">rojowy system dronów ratowniczych z radarem</span>
        </div>
        <PhaseStepper />
        <div className="flex items-center gap-5 text-sm shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Rola:</span>
            <select className="bg-transparent font-medium focus:outline-none border-b border-dashed border-muted-foreground/50 pb-0.5">
              <option className="bg-background">Dowódca</option>
              <option className="bg-background">Operator drona</option>
              <option className="bg-background">Grupa naziemna</option>
            </select>
          </div>
          <div className={`flex items-center gap-2 ${result ? 'text-green-500' : 'text-muted-foreground'}`}><Satellite className="h-4 w-4" /><span>{gnss}</span></div>
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /><MissionClock /></div>
          <button onClick={() => setRules(true)} className="text-muted-foreground hover:text-foreground flex items-center gap-1"><ShieldAlert className="h-4 w-4" />Zasady użycia</button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <aside className="w-72 border-r border-border/40 flex flex-col shrink-0">
          <LayersPanel />
        </aside>

        <section className="flex-1 relative flex flex-col min-w-0">
          <div className="flex-1 relative"><Map /></div>
          <div className="h-44 shrink-0 border-t border-border"><LogsPanel /></div>
        </section>

        <aside className="w-[410px] border-l border-border/40 bg-card/50 flex flex-col shrink-0">
          <div className="px-4 pt-3 border-b border-border/40 shrink-0">
            <div className="flex gap-4 text-sm font-medium">
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`} className={`pb-2 flex items-center gap-1.5 border-b-2 ${tab === t.id ? 'text-primary border-primary' : 'text-muted-foreground border-transparent hover:text-foreground'}`}>
                  {t.label}
                  {t.badge !== undefined && <span className={`text-[10px] px-1.5 rounded-full ${t.id === 'wykrycia' ? 'bg-red-500 text-white' : 'bg-muted text-foreground'}`}>{t.badge}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            {tab === 'misja' && <MissionPanel />}
            {tab === 'hotspoty' && <HotspotsPanel />}
            {tab === 'wykrycia' && <DetectionsPanel />}
            {tab === 'scenariusz' && <ScenarioPanel />}
          </div>
        </aside>
      </main>

      {viewerOpen && <PointCloudViewer />}
      {rules && <RulesModal onClose={() => setRules(false)} />}
    </div>
  );
}

export default App;
