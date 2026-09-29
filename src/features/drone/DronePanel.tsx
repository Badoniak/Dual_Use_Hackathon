import React from 'react';
import { Battery, Camera, Navigation, Radio, Play, Square, Video } from 'lucide-react';
import { useDroneStore } from '../../store/useDroneStore';
import { useMissionStore } from '../../store/useMissionStore';
import { useLogStore } from '../../store/useLogStore';
import * as turf from '@turf/turf';

export function DronePanel() {
  const { 
    drones, timeMultiplier, showPath, detections,
    launchDrones, deactivateAll, updateDrone, updateDroneTelemetry, addDetection, 
    setTimeMultiplier, togglePath
  } = useDroneStore();
  const { gridFeatures, lkps } = useMissionStore();

  const [selectedDrones, setSelectedDrones] = React.useState<string[]>([]);
  const activeDrones = drones.filter(d => d.isActive);
  const isAnyActive = activeDrones.length > 0;

  const toggleSelection = (id: string) => {
    setSelectedDrones(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // Symulacja ruchu drona
  React.useEffect(() => {
    if (!isAnyActive) return;

    const interval = setInterval(() => {
      drones.forEach(drone => {
        if (!drone.isActive || !drone.telemetry) return;
        
        let lat = drone.telemetry.lat;
        let lng = drone.telemetry.lng;
        let battery = Math.max(0, drone.telemetry.battery - (0.05 * timeMultiplier));
        let timer = drone.scanningTimer;
        let currentWp = drone.currentWaypoint;
        
        if (drone.route && drone.route.length > 0 && currentWp < drone.route.length) {
          const target = drone.route[currentWp];
          const dx = target[0] - lng;
          const dy = target[1] - lat;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          const speed = (drone.type === 'faza1' ? 0.0003 : 0.0002) * timeMultiplier;
          
          if (dist < speed) {
            lng = target[0];
            lat = target[1];
            
            if (drone.type === 'faza1') {
              currentWp++;
              updateDrone(drone.id, { currentWaypoint: currentWp });
              // Rzadsze, bardziej realistyczne wykrycia (4% szans na sektor zamiast 20%)
              if (Math.random() > 0.96) {
                const randomSensor = drone.sensors[Math.floor(Math.random() * drone.sensors.length)];
                const detId = addDetection({
                  lng: lng + (Math.random() - 0.5) * 0.01,
                  lat: lat + (Math.random() - 0.5) * 0.01,
                  confidence: Math.round(70 + Math.random() * 25),
                  type: 'anomaly',
                  droneId: drone.id,
                  sensor: randomSensor
                });
                useLogStore.getState().addLog(`[${drone.name}] Wykryto anomalię cieplną przez ${randomSensor}. Zarejestrowano jako HotSpot.`, 'warning', 'DRON');
              }
            } else {
              // Faza 2
              if (timer === 0) {
                updateDroneTelemetry(drone.id, { lat, lng, battery, alt: 0, speed: 0 });
                updateDrone(drone.id, { scanningTimer: 1 });
                return;
              } else if (timer < 30 / timeMultiplier) {
                updateDrone(drone.id, { scanningTimer: timer + 1 });
                return; 
              } else {
                updateDrone(drone.id, { scanningTimer: 0, currentWaypoint: currentWp + 1 });
                if (Math.random() > 0.5) {
                  const randomSensor = drone.sensors[Math.floor(Math.random() * drone.sensors.length)];
                  addDetection({
                    lng: lng + (Math.random() - 0.5) * 0.005, // Zwiększony rozrzut, żeby punkty się nie nakładały
                    lat: lat + (Math.random() - 0.5) * 0.005, // Zwiększony rozrzut, żeby punkty się nie nakładały
                    confidence: Math.round(80 + Math.random() * 15),
                    type: 'person',
                    droneId: drone.id,
                    sensor: randomSensor
                  });
                  useLogStore.getState().addLog(`[${drone.name}] Potwierdzono ślady życia (${randomSensor})!`, 'success', 'DRON');
                } else {
                  useLogStore.getState().addLog(`[${drone.name}] Fałszywy alarm w obszarze. Wznawianie trasy...`, 'info', 'DRON');
                }
                updateDroneTelemetry(drone.id, { lat, lng, battery, alt: 5, speed: 5 });
                return;
              }
            }
          } else {
            lng += (dx / dist) * speed;
            lat += (dy / dist) * speed;
          }
        } else if (!drone.route || drone.route.length === 0) {
          lat += 0.0001 * timeMultiplier;
          lng += Math.sin(Date.now() / 2000) * 0.0002 * timeMultiplier;
        }
        
        updateDroneTelemetry(drone.id, { lat, lng, battery });
      });
    }, 100);

    return () => clearInterval(interval);
  }, [isAnyActive, drones, timeMultiplier, updateDrone, updateDroneTelemetry, addDetection]);

  const handleStartMission = (startPhase: 'faza1' | 'faza2') => {
    let waypoints: [number, number][] = [];
    
    if (startPhase === 'faza1' && gridFeatures && gridFeatures.features.length > 0) {
      const points = gridFeatures.features.map(f => {
        const center = turf.centroid(f);
        return center.geometry.coordinates as [number, number];
      });
      
      const rows: { [lat: string]: [number, number][] } = {};
      points.forEach(p => {
        const latKey = p[1].toFixed(5);
        if (!rows[latKey]) rows[latKey] = [];
        rows[latKey].push(p);
      });
      
      const sortedLats = Object.keys(rows).sort((a, b) => parseFloat(a) - parseFloat(b));
      let leftToRight = true;
      sortedLats.forEach(lat => {
        const rowPoints = rows[lat].sort((a, b) => a[0] - b[0]);
        if (!leftToRight) rowPoints.reverse();
        waypoints.push(...rowPoints);
        leftToRight = !leftToRight;
      });

    } else if (startPhase === 'faza2') {
      if (detections.length > 0) {
        waypoints = detections.map(d => [d.lng, d.lat]);
      } else if (lkps.length > 0) {
        waypoints = lkps.map(p => [p.lng, p.lat]);
      }
    }
    
    let finalDrones = [...selectedDrones];

    if (startPhase === 'faza2' && waypoints.length > 0 && finalDrones.length > waypoints.length) {
      const reducedCount = finalDrones.length - waypoints.length;
      finalDrones = finalDrones.slice(0, waypoints.length);
      useLogStore.getState().addLog(`Uziemiono ${reducedCount} dron(ów) z powodu braku wystarczającej liczby celów (hotspotów).`, 'warning', 'SYSTEM');
    }
    
    const startLng = waypoints.length > 0 ? waypoints[0][0] - 0.001 : 21.9990;
    const startLat = waypoints.length > 0 ? waypoints[0][1] - 0.001 : 50.0412;

    launchDrones(finalDrones, startLng, startLat, waypoints);
    setSelectedDrones([]);
  };

  return (
    <div className="flex flex-col h-full bg-card/50 text-foreground overflow-y-auto p-4 space-y-6">
      
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <div className="flex items-center gap-2">
            <Navigation className="h-5 w-5 text-primary" />
            <h3 className="font-medium text-lg">Zarządzanie Flotą</h3>
          </div>
        </div>

        {!isAnyActive ? (
          <div className="space-y-6">
            
            {/* Sekcja Faza 1 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-muted-foreground">Faza 1: Zwiadowcy</p>
                <button 
                  onClick={() => setSelectedDrones(prev => {
                    const f1Ids = drones.filter(d => d.type === 'faza1').map(d => d.id);
                    const allSelected = f1Ids.every(id => prev.includes(id));
                    if (allSelected) return prev.filter(id => !f1Ids.includes(id));
                    return [...new Set([...prev, ...f1Ids])];
                  })}
                  className="text-xs text-primary hover:underline"
                >
                  Zaznacz wszystkich
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
                {drones.filter(d => d.type === 'faza1').map(d => (
                  <div 
                    key={d.id} 
                    onClick={() => toggleSelection(d.id)}
                    className={`p-2 rounded border cursor-pointer transition-all flex justify-between items-center ${
                      selectedDrones.includes(d.id) ? 'bg-primary/20 border-primary' : 'bg-muted/30 border-border/50 hover:bg-muted/50'
                    }`}
                  >
                    <span className="font-medium text-xs">{d.name}</span>
                    <div className={`w-3 h-3 rounded border flex items-center justify-center ${selectedDrones.includes(d.id) ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                      {selectedDrones.includes(d.id) && <div className="w-1.5 h-1.5 bg-background rounded-sm" />}
                    </div>
                  </div>
                ))}
              </div>
              <button 
                disabled={!selectedDrones.some(id => drones.find(d => d.id === id)?.type === 'faza1')}
                onClick={() => handleStartMission('faza1')} 
                className="w-full py-2 bg-primary disabled:opacity-50 text-primary-foreground rounded-md flex justify-center items-center gap-2 hover:bg-primary/90 transition text-sm font-bold"
              >
                <Play className="h-4 w-4" /> Wyślij Zwiadowców
              </button>
            </div>

            {/* Sekcja Faza 2 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-muted-foreground">Faza 2: Radary GPR-SAR</p>
                <button 
                  onClick={() => setSelectedDrones(prev => {
                    const f2Ids = drones.filter(d => d.type === 'faza2').map(d => d.id);
                    const allSelected = f2Ids.every(id => prev.includes(id));
                    if (allSelected) return prev.filter(id => !f2Ids.includes(id));
                    return [...new Set([...prev, ...f2Ids])];
                  })}
                  className="text-xs text-secondary hover:underline"
                >
                  Zaznacz wszystkie
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                {drones.filter(d => d.type === 'faza2').map(d => (
                  <div 
                    key={d.id} 
                    onClick={() => toggleSelection(d.id)}
                    className={`p-2 rounded border cursor-pointer transition-all flex justify-between items-center ${
                      selectedDrones.includes(d.id) ? 'bg-secondary/20 border-secondary' : 'bg-muted/30 border-border/50 hover:bg-muted/50'
                    }`}
                  >
                    <span className="font-medium text-xs">{d.name}</span>
                    <div className={`w-3 h-3 rounded border flex items-center justify-center ${selectedDrones.includes(d.id) ? 'bg-secondary border-secondary' : 'border-muted-foreground'}`}>
                      {selectedDrones.includes(d.id) && <div className="w-1.5 h-1.5 bg-background rounded-sm" />}
                    </div>
                  </div>
                ))}
              </div>
              <button 
                disabled={!selectedDrones.some(id => drones.find(d => d.id === id)?.type === 'faza2')}
                onClick={() => handleStartMission('faza2')} 
                className="w-full py-2 bg-secondary disabled:opacity-50 text-secondary-foreground rounded-md flex justify-center items-center gap-2 hover:bg-secondary/80 transition text-sm font-bold"
              >
                <Play className="h-4 w-4" /> Wyślij Radary
              </button>
            </div>
            
          </div>
        ) : (
          <div className="space-y-4">
            <button 
              onClick={deactivateAll}
              className="w-full py-2 bg-destructive text-destructive-foreground rounded-md flex justify-center items-center gap-2 hover:bg-destructive/90 transition font-bold"
            >
              <Square className="h-4 w-4" /> Przerwij Lot Wszystkich
            </button>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Upływ czasu:</span>
                <div className="flex bg-muted/50 rounded overflow-hidden">
                  {[1, 2, 5, 10].map(mul => (
                    <button
                      key={mul}
                      onClick={() => setTimeMultiplier(mul)}
                      className={`px-3 py-1 text-xs font-mono transition ${
                        timeMultiplier === mul ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                      }`}
                    >
                      {mul}x
                    </button>
                  ))}
                </div>
              </div>

              <button 
                onClick={togglePath}
                className={`w-full py-2 border rounded-md transition text-sm font-medium ${
                  showPath ? 'bg-primary/20 border-primary text-primary' : 'border-border/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                {showPath ? 'Ukryj trasę przelotu' : 'Pokaż trasy lotu'}
              </button>
            </div>

            <div className="space-y-2 mt-4">
              <h4 className="text-sm font-bold text-muted-foreground">Aktywne jednostki:</h4>
              {activeDrones.map(d => (
                <div key={d.id} className="bg-muted/30 p-3 rounded-lg border border-border/50 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-sm text-primary">{d.name}</span>
                    <span className="text-xs font-mono">{d.telemetry?.alt.toFixed(1)}m AGL</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Zasilanie: {d.telemetry?.battery.toFixed(0)}%</span>
                    <span>Prędkość: {(d.telemetry!.speed * timeMultiplier).toFixed(1)} m/s</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
