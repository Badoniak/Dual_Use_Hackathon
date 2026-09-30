import { useRef, useState } from 'react';
import { Box, Eye, EyeOff, FileUp, Trash2 } from 'lucide-react';
import { gpx, kml } from '@tmcw/togeojson';
import bbox from '@turf/bbox';
import type { AllGeoJSON } from '@turf/helpers';
import { useMapStore } from '../../store/useMapStore';
import { useMissionStore, type MapLayerToggles } from '../../store/useMissionStore';
import { useLogStore } from '../../store/useLogStore';
import { HOTSPOT_COLORS } from '../map/constants';
import { SourceToggle } from './SourceToggle';

function Toggle({ k, label }: { k: Exclude<keyof MapLayerToggles, 'ortho' | 'cloud' | 'cloudSource'>; label: string }) {
  const on = useMissionStore(s => s.mapLayers[k]);
  return (
    <label className="flex items-center gap-2 text-xs cursor-pointer hover:text-foreground">
      <input type="checkbox" checked={on} onChange={() => useMissionStore.getState().setMapLayers({ [k]: !on })} className="accent-primary w-3 h-3" />
      <span className={on ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
    </label>
  );
}

export function LayersPanel() {
  const { layers, toggleLayerVisibility, setLayerOpacity, removeLayer, addLayer, setMapBounds } = useMapStore();
  const ortho = useMissionStore(s => s.mapLayers.ortho);
  const cloud = useMissionStore(s => s.mapLayers.cloud);
  const cloudSource = useMissionStore(s => s.mapLayers.cloudSource);
  const scan = useMissionStore(s => s.scan);
  const result = useMissionStore(s => s.result);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileUpload = async (file: File) => {
    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'geojson';
    try {
      const text = await file.text();
      let data: GeoJSON.FeatureCollection;
      if (ext === 'geojson' || ext === 'json') data = JSON.parse(text);
      else if (ext === 'kml' || ext === 'gpx') {
        const dom = new DOMParser().parseFromString(text, 'text/xml');
        data = (ext === 'kml' ? kml(dom) : gpx(dom)) as GeoJSON.FeatureCollection;
        data = { ...data, features: data.features.filter(f => f.geometry) };
      } else {
        useLogStore.getState().addLog(`Format .${ext} nie jest obsługiwany (GeoJSON, KML, GPX).`, 'warning');
        return;
      }
      addLayer({ name: file.name, type: 'geojson', visible: true, opacity: 1, data });
      const b = bbox(data as AllGeoJSON);
      if (b.every(Number.isFinite)) setMapBounds(b as [number, number, number, number]);
      useLogStore.getState().addLog(`Wczytano warstwę ${file.name} (${data.features.length} obiektów).`, 'info');
    } catch (e) {
      useLogStore.getState().addLog(`Błąd wczytywania ${file.name}: ${e instanceof Error ? e.message : e}`, 'error');
    }
  };

  return (
    <div className="flex flex-col h-full bg-card/50 overflow-y-auto custom-scrollbar">
      <div className="p-4 pb-2 font-semibold text-sm">Warstwy bazowe</div>
      <div className="px-2 space-y-2">
        {layers.map(layer => (
          <div key={layer.id} className="bg-background border border-border/50 rounded-md p-2 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{layer.name}</span>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => toggleLayerVisibility(layer.id)} className="p-1 hover:bg-muted rounded" title={layer.visible ? 'Ukryj' : 'Pokaż'}>
                  {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </button>
                <button onClick={() => removeLayer(layer.id)} className="p-1 hover:bg-destructive/20 text-destructive rounded" title="Usuń"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
            {layer.visible && (
              <div className="flex items-center gap-2 px-1">
                <span className="text-xs text-muted-foreground">Krycie</span>
                <input type="range" min="0" max="1" step="0.1" value={layer.opacity} onChange={e => setLayerOpacity(layer.id, parseFloat(e.target.value))} className="flex-1 accent-primary" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        className={`p-3 m-2 border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${isDragging ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-muted/50'}`}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFileUpload(f); }}
        onClick={() => fileInputRef.current?.click()}
      >
        <FileUp className={`h-5 w-5 mb-1 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
        <span className="text-xs text-muted-foreground">Upuść GeoJSON / KML / GPX<br />lub kliknij, aby wgrać</span>
        <input type="file" className="hidden" ref={fileInputRef} accept=".geojson,.json,.kml,.gpx" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ''; }} />
      </div>

      <div className="mt-2 border-t border-border/40 p-4 space-y-2">
        <div className="font-semibold text-sm">Warstwy misji</div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Skan 3D na mapie (chmura punktów)</div>
          <div className="flex bg-muted/50 rounded overflow-hidden text-xs">
            {(['rgb', 'height', 'thermal', 'none'] as const).map(m => (
              <button key={m} disabled={!scan || (m === 'thermal' && !scan.temps)} onClick={() => useMissionStore.getState().setMapLayers({ cloud: m })} className={`flex-1 py-1 disabled:opacity-40 ${cloud === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} data-testid={`cloud-${m}`}>
                {m === 'rgb' ? 'RGB' : m === 'height' ? 'Wysok.' : m === 'thermal' ? 'Termo' : 'Ukryj'}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Czujnik chmury 3D</div>
          <SourceToggle
            value={cloudSource}
            onChange={v => useMissionStore.getState().setMapLayers({ cloudSource: v })}
            disabled={!scan}
            counts={scan ? { lidar: scan.nLidar, rgbd: scan.count - scan.nLidar } : null}
            testId="map-source"
          />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Ortofoto 2D (widok z góry)</div>
          <div className="flex bg-muted/50 rounded overflow-hidden text-xs">
            {(['rgb', 'thermal', 'none'] as const).map(m => (
              <button key={m} disabled={!result} onClick={() => useMissionStore.getState().setMapLayers({ ortho: m })} className={`flex-1 py-1 disabled:opacity-40 ${ortho === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                {m === 'rgb' ? 'Lidar RGB' : m === 'thermal' ? 'Termowizja' : 'Wył.'}
              </button>
            ))}
          </div>
        </div>
        <Toggle k="landing" label="Miejsca lądowania (faza 2)" />
        <Toggle k="zones" label="Strefy sygnałów z mikrofonu" />
        <Toggle k="audibility" label="Mapa słyszalności (mikrofon)" />
        <Toggle k="trails" label="Trasy dronów" />
      </div>

      <div className="border-t border-border/40 p-4 space-y-1.5 text-xs">
        <div className="font-semibold text-sm mb-1">Legenda</div>
        {([['fused', 'Potencjalne miejsce osoby (hot spot)'], ['manual', 'Hot spot wskazany przez ratownika']] as const).map(([k, l]) => (
          <div key={k} className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border border-white" style={{ background: HOTSPOT_COLORS[k] }} />{l}</div>
        ))}
        <div className="flex items-center gap-2"><span className="w-3 flex flex-col gap-px"><span className="h-0.5 bg-red-400" /><span className="h-0.5 bg-purple-400" /></span>Paski pod hot spotem: termowizja / mikrofon</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border border-white bg-sky-500" />Lądowisko (do pomiaru)</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border-2 border-amber-500 bg-sky-500" />Punkt sondy na lince (wariant T)</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border border-white bg-green-500" />Lądowisko: wykryto oddech</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full border border-white bg-slate-500" />Lądowisko: brak oznak życia</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-600 border border-white" />Oznaki życia (radar) + głębokość</div>
      </div>

      <div className="mt-auto border-t border-border/40 p-4">
        <button
          onClick={() => useMissionStore.getState().openViewer()}
          className="w-full py-2 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/50 rounded flex items-center justify-center gap-2 text-sm font-bold transition-colors"
          data-testid="open-viewer"
        >
          <Box className="h-4 w-4" /> Otwórz wizualizator 3D
        </button>
      </div>
    </div>
  );
}
