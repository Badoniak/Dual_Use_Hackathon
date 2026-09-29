import React from 'react';
import { Crosshair, MapPin, Settings2, Trash2, PenTool } from 'lucide-react';
import { useMissionStore } from '../../store/useMissionStore';

export function SectorsPanel() {
  const { 
    lkps, isSelectingLKP, config, setSelectingLKP, updateConfig, clearSectors, 
    updateLKP, removeLKP, gridFeatures,
    isDrawingPolygon, setDrawingPolygon, customAreas
  } = useMissionStore();

  return (
    <div className="flex flex-col h-full bg-card/50 text-foreground overflow-y-auto p-4 space-y-6">
      
      {/* LKP Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <div className="flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary" />
            <h3 className="font-medium text-lg">Punkty Ostatniej Pozycji (LKP)</h3>
          </div>
          {lkps.length > 0 && (
            <button 
              onClick={clearSectors}
              className="text-xs text-destructive hover:underline"
            >
              Wyczyść wszystkie
            </button>
          )}
        </div>
        
        {lkps.length > 0 ? (
          <div className="space-y-3">
            {lkps.map((p, i) => (
              <div key={p.id} className="bg-muted/30 p-3 rounded-md border border-border/50 text-sm space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-bold text-primary mr-2">LKP #{i + 1}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.lat.toFixed(5)} N, {p.lng.toFixed(5)} E
                    </span>
                  </div>
                  <button 
                    onClick={() => removeLKP(p.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="pt-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Obszar poszukiwań:</span>
                    <span className="font-medium">{Math.round(Math.PI * p.radiusKm * p.radiusKm * 100)} ha</span>
                  </div>
                  <input 
                    type="range" 
                    min="1" max="10000" step="1" 
                    value={Math.round(Math.PI * p.radiusKm * p.radiusKm * 100)}
                    onChange={(e) => {
                      const ha = parseFloat(e.target.value);
                      const r = Math.sqrt(ha / (Math.PI * 100));
                      updateLKP(p.id, r);
                    }}
                    className="w-full accent-primary"
                  />
                </div>
              </div>
            ))}
            
            <button
              onClick={() => setSelectingLKP(!isSelectingLKP)}
              className={`w-full py-2 mt-2 rounded flex items-center justify-center gap-2 text-sm font-medium transition-colors border border-border/50 ${
                isSelectingLKP 
                ? 'bg-primary text-primary-foreground animate-pulse' 
                : 'bg-background hover:bg-muted text-muted-foreground'
              }`}
            >
              <MapPin className="h-4 w-4" />
              {isSelectingLKP ? 'Kliknij na mapie...' : 'Dodaj kolejny LKP'}
            </button>
          </div>
        ) : (
          <div className="bg-muted/20 p-4 rounded-md border border-dashed border-border/60 text-center">
            <p className="text-sm text-muted-foreground mb-3">Nie zdefiniowano punktu startowego poszukiwań.</p>
            <button
              onClick={() => setSelectingLKP(!isSelectingLKP)}
              className={`w-full py-2 rounded flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
                isSelectingLKP 
                ? 'bg-primary text-primary-foreground animate-pulse' 
                : 'bg-secondary hover:bg-secondary/80'
              }`}
            >
              <MapPin className="h-4 w-4" />
              {isSelectingLKP ? 'Kliknij na mapie...' : 'Wyznacz LKP na mapie'}
            </button>
          </div>
        )}
        
        {/* Przycisk rysowania Custom Areas */}
        <div className="pt-2 mt-2 border-t border-border/40">
          <button
            onClick={() => setDrawingPolygon(!isDrawingPolygon)}
            className={`w-full py-2 rounded flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
              isDrawingPolygon 
              ? 'bg-primary text-primary-foreground animate-pulse' 
              : 'bg-secondary hover:bg-secondary/80 text-foreground'
            }`}
          >
            <PenTool className="h-4 w-4" />
            {isDrawingPolygon ? 'Rysuj na mapie (klikaj aby dodać punkty)...' : 'Narysuj własny obszar wielokątny'}
          </button>
          
          {customAreas.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Liczba narysowanych obszarów: {customAreas.length}
            </p>
          )}
        </div>
      </div>

      {/* Configuration Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border/40 pb-2">
          <Settings2 className="h-5 w-5 text-primary" />
          <h3 className="font-medium text-lg">Parametry Siatki</h3>
        </div>
        
        <div className="space-y-4 p-1">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <label className="text-muted-foreground">Bok pojedynczego sektora</label>
              <span className="font-medium">{config.sectorSizeKm * 1000} m</span>
            </div>
            <input 
              type="range" 
              min="0.01" max="1" step="0.01" 
              value={config.sectorSizeKm}
              onChange={(e) => updateConfig({ sectorSizeKm: parseFloat(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>
        </div>
      </div>

      {/* Stats Section */}
      {gridFeatures && (
        <div className="space-y-2 mt-4 pt-4 border-t border-border/40">
          <h4 className="text-sm font-medium text-muted-foreground">Podsumowanie siatki</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-background/50 p-2 rounded border border-border/30">
              <span className="block text-muted-foreground text-xs">Ilość sektorów</span>
              <span className="font-bold">{gridFeatures.features.length}</span>
            </div>
            <div className="bg-background/50 p-2 rounded border border-border/30">
              <span className="block text-muted-foreground text-xs">Pow. całkowita</span>
              <span className="font-bold">
                {Math.round(gridFeatures.features.length * (config.sectorSizeKm * config.sectorSizeKm * 100))} ha
              </span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
