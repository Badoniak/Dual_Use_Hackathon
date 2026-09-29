import React from 'react';
import { PlayCircle, Building2, MountainSnow, RefreshCcw, Box, ImagePlus } from 'lucide-react';
import { useMissionStore } from '../../store/useMissionStore';
import { useDroneStore } from '../../store/useDroneStore';
import { useLogStore } from '../../store/useLogStore';

import sample1 from '../../assets/sample1.png';
import sample2 from '../../assets/sample2.jpg';
import sample3 from '../../assets/sample3.png';
import sample4 from '../../assets/sample4.png';
import sample5 from '../../assets/sample5.jpg';

const YOLO_SAMPLES = [sample1, sample2, sample3, sample4, sample5];

export function DemoPanel() {
  const { addLKP, clearSectors, updateConfig, updateLKP } = useMissionStore();
  const { deactivateAll } = useDroneStore();

  const handleYoloSimulate = () => {
    // Wybierz losowe zdjęcie z dostępnych sampli
    const randomSample = YOLO_SAMPLES[Math.floor(Math.random() * YOLO_SAMPLES.length)];
    const confidence = Math.round(60 + Math.random() * 35); // 60-95
    
    useLogStore.getState().addAnomaly(
      `Zidentyfikowano potencjalny cel w obszarze operacyjnym. Zbliżenie z kamery przekazane do weryfikacji.`,
      randomSample,
      confidence
    );

    // Znajdź pozycję dla tego wykrycia (najlepiej z pierwszego aktywnego drona)
    const activeDrones = useDroneStore.getState().drones.filter(d => d.isActive && d.telemetry);
    let lat = 52.2319; // Domyślnie Warszawa
    let lng = 21.0067;
    
    if (activeDrones.length > 0) {
      const drone = activeDrones[Math.floor(Math.random() * activeDrones.length)];
      lat = drone.telemetry!.lat;
      lng = drone.telemetry!.lng;
    } else if (useMissionStore.getState().lkps.length > 0) {
      lat = useMissionStore.getState().lkps[0].lat;
      lng = useMissionStore.getState().lkps[0].lng;
    }

    useMissionStore.getState().addYOLODetection({
      lat,
      lng,
      imageUrl: randomSample,
      confidence
    });
  };

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
        
        <button 
          onClick={() => useMissionStore.getState().openViewer('/session_20260929_191909/lidar_3d/')}
          className="w-full flex items-start gap-4 p-4 bg-muted/30 border border-border/50 hover:bg-muted/50 hover:border-primary/50 transition-all rounded-lg text-left group mt-4"
        >
          <div className="bg-primary/20 p-2 rounded-md group-hover:bg-primary/30 transition-colors">
            <Box className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h4 className="font-bold text-base mb-1">Podgląd z Symulacji (LIDAR)</h4>
            <p className="text-xs text-muted-foreground">Otwiera Wizualizator 3D z przykładową chmurą punktów (PCD) zebraną z drona podczas lotu testowego.</p>
          </div>
        </button>

        <div className="mt-4 pt-4 border-t border-border/50">
          <button 
            onClick={handleYoloSimulate}
            className="w-full flex items-start gap-4 p-4 bg-orange-500/10 border border-orange-500/20 hover:bg-orange-500/20 hover:border-orange-500/50 transition-all rounded-lg text-left group"
          >
            <div className="bg-orange-500/20 p-2 rounded-md group-hover:bg-orange-500/30 transition-colors">
              <ImagePlus className="h-6 w-6 text-orange-500" />
            </div>
            <div>
              <h4 className="font-bold text-base mb-1 text-orange-500">Symuluj Detekcję YOLO</h4>
              <p className="text-xs text-muted-foreground">Wysyła jedno z przykładowych zdjęć z folderu assets jako wykrytą anomalię, symulując raportowanie z drona w czasie rzeczywistym.</p>
            </div>
          </button>
        </div>
        
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
