import React from 'react';
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { useDroneStore } from '../../store/useDroneStore';

export function DetectionsPanel() {
  const { detections, updateDetectionStatus } = useDroneStore();

  const pending = detections.filter(d => d.status === 'pending');
  const resolved = detections.filter(d => d.status !== 'pending');

  return (
    <div className="flex flex-col h-full bg-card/50 text-foreground overflow-y-auto p-4 space-y-6">
      
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-border/40 pb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            <h3 className="font-medium text-lg">Wykrycia z drona</h3>
          </div>
          <span className="text-xs bg-orange-500/20 text-orange-500 px-2 py-1 rounded-full font-bold">
            {pending.length} Oczekujących
          </span>
        </div>

        {pending.length === 0 && resolved.length === 0 && (
          <p className="text-sm text-muted-foreground text-center mt-8">
            Brak zarejestrowanych wykryć.
          </p>
        )}

        {/* Pending list */}
        {pending.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Do weryfikacji</h4>
            {pending.map(d => (
              <div key={d.id} className="bg-orange-500/10 border border-orange-500/30 p-3 rounded-lg flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-orange-500">Prawdopodobieństwo: {d.confidence}%</p>
                    <p className="text-xs font-mono text-muted-foreground mt-1">ID: {d.id.toUpperCase()} • {new Date(d.timestamp).toLocaleTimeString()}</p>
                    <p className="text-xs font-mono text-muted-foreground">{d.lat.toFixed(5)} N, {d.lng.toFixed(5)} E</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => updateDetectionStatus(d.id, 'confirmed')}
                    className="flex-1 bg-green-600/20 text-green-500 hover:bg-green-600/30 border border-green-600/50 py-1.5 rounded flex justify-center items-center gap-1 text-sm transition"
                  >
                    <CheckCircle className="h-4 w-4" /> Zatwierdź
                  </button>
                  <button 
                    onClick={() => updateDetectionStatus(d.id, 'rejected')}
                    className="flex-1 bg-red-600/20 text-red-500 hover:bg-red-600/30 border border-red-600/50 py-1.5 rounded flex justify-center items-center gap-1 text-sm transition"
                  >
                    <XCircle className="h-4 w-4" /> Odrzuć
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Resolved list */}
        {resolved.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-border/20">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Zweryfikowane</h4>
            {resolved.map(d => (
              <div 
                key={d.id} 
                className={`p-3 rounded-lg border flex justify-between items-center ${
                  d.status === 'confirmed' ? 'bg-green-500/10 border-green-500/30' : 'bg-muted/30 border-border/40 opacity-70'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    {d.status === 'confirmed' ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className={`text-sm font-bold ${d.status === 'confirmed' ? 'text-green-500' : 'text-muted-foreground'}`}>
                      {d.status === 'confirmed' ? 'Pozytywne' : 'Fałszywy alarm'}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground mt-1">ID: {d.id.toUpperCase()}</p>
                </div>
                <span className="text-xs font-bold">{d.confidence}%</span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
