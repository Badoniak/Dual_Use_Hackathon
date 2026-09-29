import React, { useState } from 'react';
import { Map } from './features/map/Map';
import { Activity, Clock, Crosshair, Map as MapIcon, Maximize, Satellite, ShieldAlert } from 'lucide-react';

import { LayersPanel } from './features/layers/LayersPanel';
import { SectorsPanel } from './features/sectors/SectorsPanel';
import { DronePanel } from './features/drone/DronePanel';
import { DetectionsPanel } from './features/drone/DetectionsPanel';

function App() {
  const [rightPanelTab, setRightPanelTab] = useState<'sektory'|'wykrycia'|'dron'>('sektory');

  return (
    <div 
      className="flex flex-col h-screen bg-background text-foreground overflow-hidden"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      {/* Top Bar */}
      <header className="h-14 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <Crosshair className="h-5 w-5 text-primary" />
          <h1 className="font-bold text-lg tracking-tight">SKYSAR Dashboard</h1>
          <div className="ml-4 flex items-center bg-muted/50 rounded-md p-1 border border-border/50 text-sm">
            <button className="px-3 py-1 rounded-sm bg-background shadow-sm text-foreground">Poszukiwania</button>
            <button className="px-3 py-1 rounded-sm text-muted-foreground hover:text-foreground">Monitoring strefy</button>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Rola:</span>
            <select className="bg-transparent font-medium focus:outline-none border-b border-dashed border-muted-foreground/50 pb-0.5">
              <option>Dowódca</option>
              <option>Operator drona</option>
              <option>Grupa naziemna</option>
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm text-green-500">
            <Satellite className="h-4 w-4" />
            <span>GNSS: Dobry</span>
          </div>
          <div className="flex items-center gap-2 font-mono text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>00:45:12</span>
          </div>
          <button className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ShieldAlert className="h-4 w-4" />
            Zasady użycia
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Panel */}
        <aside className="w-80 border-r border-border/40 flex flex-col shrink-0">
          <LayersPanel />
        </aside>

        {/* Center - Map */}
        <section className="flex-1 relative">
          <Map />
        </section>

        {/* Right Panel */}
        <aside className="w-[400px] border-l border-border/40 bg-card/50 flex flex-col shrink-0">
          <div className="p-4 border-b border-border/40 shrink-0">
            <div className="flex gap-4 text-sm font-medium border-b border-border/40 pb-2">
              <button 
                onClick={() => setRightPanelTab('sektory')}
                className={`pb-2 -mb-[9px] ${rightPanelTab === 'sektory' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >Sektory</button>
              <button 
                onClick={() => setRightPanelTab('wykrycia')}
                className={`pb-2 -mb-[9px] ${rightPanelTab === 'wykrycia' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >Wykrycia</button>
              <button 
                onClick={() => setRightPanelTab('dron')}
                className={`pb-2 -mb-[9px] ${rightPanelTab === 'dron' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >Dron</button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            {rightPanelTab === 'sektory' && <SectorsPanel />}
            {rightPanelTab === 'wykrycia' && <DetectionsPanel />}
            {rightPanelTab === 'dron' && <DronePanel />}
          </div>
        </aside>
      </main>

      {/* Bottom Bar - Timeline */}
      <footer className="h-16 border-t border-border/40 bg-card/50 flex items-center px-4 shrink-0">
        <div className="flex items-center gap-4 w-full">
           <Activity className="h-4 w-4 text-muted-foreground shrink-0" />
           <div className="h-1 flex-1 bg-muted rounded-full overflow-hidden relative">
              <div className="absolute left-0 top-0 bottom-0 w-1/3 bg-primary/50" />
              <div className="absolute left-1/3 w-2 h-full bg-primary -ml-1 rounded-full shadow" />
           </div>
           <span className="text-xs text-muted-foreground font-mono shrink-0">Oś czasu akcji</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
