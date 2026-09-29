import { useRef, useState } from 'react';
import { useMapStore } from '../../store/useMapStore';
import { Eye, EyeOff, GripVertical, Trash2, Maximize, FileUp, Box } from 'lucide-react';
import { kml } from '@tmcw/togeojson';
import bbox from '@turf/bbox';
import { featureCollection, feature } from '@turf/helpers';
import { useDroneStore } from '../../store/useDroneStore';
import { useMissionStore } from '../../store/useMissionStore';
import { PointCloudViewer } from '../viewer/PointCloudViewer';

export function LayersPanel() {
  const { layers, toggleLayerVisibility, setLayerOpacity, removeLayer, addLayer, setMapBounds } = useMapStore();
  const { drones, toggleDroneSensor } = useDroneStore();
  const { isViewerOpen, openViewer, closeViewer } = useMissionStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileUpload = async (file: File) => {
    // If filename has no extension, assume it's geojson as fallback, otherwise get ext
    const nameParts = file.name.split('.');
    const ext = nameParts.length > 1 ? nameParts.pop()?.toLowerCase() : 'geojson';
    
    if (ext === 'geojson' || ext === 'json') {
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        addLayer({ name: file.name, type: 'geojson', visible: true, opacity: 1, data });
        try {
           const bounds = bbox(data);
           setMapBounds(bounds as [number, number, number, number]);
        } catch (e) {
           console.log("Could not calculate bbox", e);
        }
      } catch (e) {
        alert('Błąd parsowania pliku GeoJSON.');
      }
    } else if (ext === 'kml') {
      const text = await file.text();
      const dom = new DOMParser().parseFromString(text, 'text/xml');
      const data = kml(dom);
      addLayer({ name: file.name, type: 'geojson', visible: true, opacity: 1, data });
      try {
           const bounds = bbox(data);
           setMapBounds(bounds as [number, number, number, number]);
      } catch (e) {}
    } else {
      alert(`Format ${ext} nie jest obecnie obsługiwany w prototypie.`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-card/50">
      <div className="p-4 border-b border-border/40 font-semibold flex justify-between items-center">
        <span>Lista warstw</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {layers.map(layer => (
          <div key={layer.id} className="bg-background border border-border/50 rounded-md p-2 flex flex-col gap-2 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                <span className="text-sm font-medium truncate w-40">{layer.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => toggleLayerVisibility(layer.id)} className="p-1 hover:bg-muted rounded">
                  {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </button>
                <button onClick={() => removeLayer(layer.id)} className="p-1 hover:bg-destructive/20 text-destructive rounded">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            {layer.visible && (
              <div className="flex items-center gap-2 px-6">
                <span className="text-xs text-muted-foreground">Krycie</span>
                <input 
                  type="range" 
                  min="0" max="1" step="0.1" 
                  value={layer.opacity}
                  onChange={(e) => setLayerOpacity(layer.id, parseFloat(e.target.value))}
                  className="flex-1 h-1 bg-muted rounded-lg appearance-none cursor-pointer"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <div 
        className={`p-4 m-2 border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${isDragging ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-muted/50'}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFileUpload(file);
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <FileUp className={`h-6 w-6 mb-2 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
        <span className="text-sm text-muted-foreground">Upuść plik GeoJSON/KML tutaj<br/>lub kliknij, aby wgrać</span>
        <input 
          type="file" 
          className="hidden" 
          ref={fileInputRef} 
          accept=".geojson,.json,.kml,.gpx" 
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
          }}
        />
      </div>

      {/* Warstwy Sensorów (Drony) */}
      <div className="mt-4 border-t border-border/40">
        <div className="p-4 font-semibold text-sm text-primary">
          Sensory Maszyn
        </div>
        <div className="px-2 space-y-4 max-h-[250px] overflow-y-auto custom-scrollbar pb-4">
          {drones.filter(d => d.telemetryHistory.length > 0 || d.isActive).map(drone => (
            <div key={drone.id} className="bg-black/20 border border-border/30 rounded-md p-3">
              <span className="text-sm font-bold text-muted-foreground">{drone.name}</span>
              <div className="mt-2 space-y-2">
                {drone.sensors.map(sensor => {
                  const isChecked = drone.activeSensors.includes(sensor);
                  return (
                    <label key={sensor} className="flex items-center gap-2 text-xs cursor-pointer hover:text-foreground transition-colors">
                      <input 
                        type="checkbox" 
                        checked={isChecked}
                        onChange={() => toggleDroneSensor(drone.id, sensor)}
                        className="accent-primary w-3 h-3"
                      />
                      <span className={isChecked ? 'text-primary font-medium' : 'text-muted-foreground'}>{sensor}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Wizualizator 3D LIDAR / GPR */}
      <div className="mt-auto border-t border-border/40 p-4">
        <button
          onClick={() => openViewer()}
          className="w-full py-2 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/50 rounded flex items-center justify-center gap-2 text-sm font-bold transition-colors"
        >
          <Box className="h-4 w-4" />
          Otwórz Wizualizator 3D (Lidar / Kamery Głębi)
        </button>
      </div>

      {isViewerOpen && <PointCloudViewer onClose={closeViewer} />}
    </div>
  );
}
