import React from 'react';
import { PlayCircle, Building2, MountainSnow, RefreshCcw } from 'lucide-react';
import { useMissionStore } from '../../store/useMissionStore';
import { useDroneStore } from '../../store/useDroneStore';
import { useLogStore } from '../../store/useLogStore';

export function DemoPanel() {
  const { addLKP, clearSectors, updateConfig, updateLKP } = useMissionStore();
  const { deactivateAll } = useDroneStore();

  const loadDemoGruzowisko = () => {
    // 1. Reset
    clearSectors();
    deactivateAll();
    useLogStore.getState().addLog('Zainicjowano scenariusz: Gruzowisko (Warszawa Centrum).', 'info', 'SYSTEM');

    // 2. Konfiguracja pod mały teren zabudowany (np. wybuch gazu na Śląsku lub w Warszawie)
    updateConfig({ sectorSizeKm: 0.05 }); 

    // 3. Dodaj punkt zerowy (epicentrum)
    // Współrzędne: np. 52.2319, 21.0067 (Warszawa Centrum)
    // Z uwagi na to jak działa addLKP (dodaje i losuje ID), musimy to obejść lub po prostu użyć store.
    // Używamy dostępnego addLKP:
    
    // Używamy timeoutów żeby stan zdążył się zaktualizować przed zmianą promienia
    setTimeout(() => {
      useMissionStore.getState().addLKP(21.0067, 52.2319);
      setTimeout(() => {
        const lkps = useMissionStore.getState().lkps;
        if (lkps.length > 0) {
          updateLKP(lkps[0].id, 0.5); // Bardzo mały promień gruzowiska (500m)
        }
      }, 50);
    }, 50);
  };

  const loadDemoLawina = () => {
    clearSectors();
    deactivateAll();
    useLogStore.getState().addLog('Zainicjowano scenariusz: Złotnictwo lawinowe (Tatry).', 'info', 'SYSTEM');

    // Góry, duży teren, szybkie przeszukiwanie (np. Tatry, okolice Morskiego Oka)
    updateConfig({ sectorSizeKm: 0.2 }); 

    setTimeout(() => {
      // Punkt 1: Prawdopodobne miejsce porwania
      useMissionStore.getState().addLKP(20.0718, 49.1983);
      setTimeout(() => {
        // Punkt 2: Koniec czoła lawiny
        useMissionStore.getState().addLKP(20.0760, 49.2010);
        
        setTimeout(() => {
          const lkps = useMissionStore.getState().lkps;
          if (lkps.length >= 2) {
            updateLKP(lkps[0].id, 1);
            updateLKP(lkps[1].id, 1.5);
          }
        }, 50);
      }, 50);
    }, 50);
  };

  return (
    <div className="flex flex-col h-full bg-card/50 text-foreground overflow-y-auto p-4 space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border/40 pb-2">
          <PlayCircle className="h-5 w-5 text-primary" />
          <h3 className="font-medium text-lg">Scenariusze Prezentacyjne</h3>
        </div>
        
        <p className="text-sm text-muted-foreground mb-4">
          Kliknięcie w scenariusz przygotuje mapę, wygeneruje siatkę o odpowiedniej gęstości oraz ustawi punkty LKP gotowe do nalotu dronem.
        </p>

        <button 
          onClick={loadDemoGruzowisko}
          className="w-full flex items-start gap-4 p-4 bg-muted/30 border border-border/50 hover:bg-muted/50 hover:border-primary/50 transition-all rounded-lg text-left group"
        >
          <div className="bg-primary/20 p-2 rounded-md group-hover:bg-primary/30 transition-colors">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h4 className="font-bold text-base mb-1">Zawalony Budynek</h4>
            <p className="text-xs text-muted-foreground">Epicentrum w mieście. Bardzo gęsta siatka (50m), mały promień poszukiwań. Idealne pod precyzyjny radar w gruzie.</p>
          </div>
        </button>

        <button 
          onClick={loadDemoLawina}
          className="w-full flex items-start gap-4 p-4 bg-muted/30 border border-border/50 hover:bg-muted/50 hover:border-secondary/50 transition-all rounded-lg text-left group"
        >
          <div className="bg-secondary/20 p-2 rounded-md group-hover:bg-secondary/30 transition-colors">
            <MountainSnow className="h-6 w-6 text-secondary" />
          </div>
          <div>
            <h4 className="font-bold text-base mb-1">Lawina w Tatrach</h4>
            <p className="text-xs text-muted-foreground">Wiele punktów LKP (początek i koniec lawiny). Większa siatka, duży obszar. Test dla GPR-SAR z powietrza.</p>
          </div>
        </button>
        
        <div className="pt-8">
          <button 
            onClick={() => { clearSectors(); deactivateAll(); useLogStore.getState().addLog('Zresetowano środowisko symulacyjne.', 'info', 'SYSTEM'); }}
            className="w-full py-2 bg-destructive/10 text-destructive border border-destructive/30 rounded-md hover:bg-destructive/20 transition flex items-center justify-center gap-2 text-sm font-medium"
          >
            <RefreshCcw className="h-4 w-4" /> Resetuj Środowisko
          </button>
        </div>
      </div>
    </div>
  );
}
