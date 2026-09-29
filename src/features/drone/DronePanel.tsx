import React from 'react';
import { Battery, Camera, Navigation, Radio, Play, Square, Video } from 'lucide-react';
import { useDroneStore } from '../../store/useDroneStore';

export function DronePanel() {
  const { isActive, telemetry, activateDrone, deactivateDrone, updateTelemetry, addDetection } = useDroneStore();

  // Symulacja ruchu drona
  React.useEffect(() => {
    if (!isActive || !telemetry) return;

    const interval = setInterval(() => {
      // Prosty ruch na północ (lawnmower type movement could be added later, basic move for now)
      updateTelemetry({
        lat: telemetry.lat + 0.0001,
        lng: telemetry.lng + Math.sin(Date.now() / 2000) * 0.0002, // lekki zygzak
        battery: Math.max(0, telemetry.battery - 0.05)
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive, telemetry?.lat, telemetry?.lng, updateTelemetry]);

  const handleSimulateDetection = () => {
    if (!telemetry) return;
    // Symuluj wykrycie w pobliżu drona
    addDetection({
      lng: telemetry.lng + (Math.random() - 0.5) * 0.005,
      lat: telemetry.lat + (Math.random() - 0.5) * 0.005,
      confidence: Math.round(70 + Math.random() * 25), // 70-95%
      type: 'person'
    });
  };

  return (
    <div className="flex flex-col h-full bg-card/50 text-foreground overflow-y-auto p-4 space-y-6">
      
      {/* Video Feed Placeholder */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 border-b border-border/40 pb-2">
          <Camera className="h-5 w-5 text-primary" />
          <h3 className="font-medium text-lg">Podgląd z kamery</h3>
        </div>
        
        <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-border flex items-center justify-center group">
          {isActive ? (
            <>
              {/* Fake video feed / noise */}
              <div className="absolute inset-0 bg-blue-900/20 animate-pulse" />
              <div className="absolute top-2 left-2 flex items-center gap-2 text-xs font-mono bg-black/50 px-2 py-1 rounded text-red-500">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                REC
              </div>
              <div className="absolute bottom-2 left-2 text-xs font-mono text-white/70">
                ALT: {telemetry?.alt.toFixed(1)}m
              </div>
              <div className="absolute bottom-2 right-2 text-xs font-mono text-white/70">
                SPD: {telemetry?.speed.toFixed(1)}m/s
              </div>
            </>
          ) : (
            <div className="text-muted-foreground flex flex-col items-center gap-2">
              <Video className="h-8 w-8 opacity-50" />
              <span className="text-sm">Brak sygnału (Dron w bazie)</span>
            </div>
          )}
        </div>
      </div>

      {/* Drone Controls */}
      <div className="space-y-4">
        <div className="flex gap-2">
          {!isActive ? (
            <button 
              onClick={() => activateDrone(21.9990, 50.0412)} // default start pos
              className="flex-1 py-2 bg-primary text-primary-foreground rounded-md flex justify-center items-center gap-2 hover:bg-primary/90 transition"
            >
              <Play className="h-4 w-4" /> Start Misji (Demo)
            </button>
          ) : (
            <button 
              onClick={deactivateDrone}
              className="flex-1 py-2 bg-destructive text-destructive-foreground rounded-md flex justify-center items-center gap-2 hover:bg-destructive/90 transition"
            >
              <Square className="h-4 w-4" /> Przerwij Lot
            </button>
          )}
        </div>
        
        {isActive && (
          <button 
            onClick={handleSimulateDetection}
            className="w-full py-2 bg-orange-500/20 text-orange-500 border border-orange-500/50 rounded-md hover:bg-orange-500/30 transition text-sm font-medium"
          >
            [DEV] Symuluj Wykrycie Anomalii
          </button>
        )}
      </div>

      {/* Telemetry */}
      {isActive && telemetry && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border/40 pb-2">
            <Radio className="h-5 w-5 text-primary" />
            <h3 className="font-medium text-lg">Telemetria na żywo</h3>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted/30 p-3 rounded-md border border-border/50">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Navigation className="h-4 w-4" />
                <span className="text-xs">Wysokość (AGL)</span>
              </div>
              <p className="font-mono text-lg">{telemetry.alt.toFixed(1)} m</p>
            </div>
            <div className="bg-muted/30 p-3 rounded-md border border-border/50">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Battery className="h-4 w-4" />
                <span className="text-xs">Bateria</span>
              </div>
              <p className={`font-mono text-lg ${telemetry.battery < 20 ? 'text-destructive' : 'text-green-500'}`}>
                {telemetry.battery.toFixed(0)}%
              </p>
            </div>
            <div className="col-span-2 bg-muted/30 p-3 rounded-md border border-border/50">
              <span className="text-xs text-muted-foreground block mb-1">Pozycja drona</span>
              <p className="font-mono text-sm">{telemetry.lat.toFixed(5)} N, {telemetry.lng.toFixed(5)} E</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
