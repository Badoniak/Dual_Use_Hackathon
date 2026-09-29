import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';
import { X, Upload, Box, Play, Pause, SkipBack, SkipForward } from 'lucide-react';

import { useMissionStore } from '../../store/useMissionStore';

interface PointCloudViewerProps {
  onClose: () => void;
}

export function PointCloudViewer({ onClose }: PointCloudViewerProps) {
  const { viewerUrl } = useMissionStore();
  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  
  const [playlist, setPlaylist] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);

  const loadPointCloud = (buffer: ArrayBuffer, name: string) => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    // Clear previous point clouds
    const objectsToRemove: THREE.Object3D[] = [];
    scene.children.forEach(child => {
      if (child instanceof THREE.Points) {
        objectsToRemove.push(child);
      }
    });
    objectsToRemove.forEach(obj => scene.remove(obj));

    try {
      const extension = name.split('.').pop()?.toLowerCase();
      
      if (extension === 'pcd') {
        const loader = new PCDLoader();
        const pcd = loader.parse(buffer);
        
        if (pcd.material instanceof THREE.PointsMaterial) {
          pcd.material.size = 0.2; // Zwiększony rozmiar
          
          if (!pcd.geometry.hasAttribute('color')) {
            // Generowanie kolorów na podstawie wysokości (osi Z przed rotacją, a Y po rotacji)
            // Z osią z z ROS (przed rotacją) jest w geometry.attributes.position.z
            const positions = pcd.geometry.attributes.position.array;
            const colors = new Float32Array(positions.length);
            const color = new THREE.Color();
            
            pcd.geometry.computeBoundingBox();
            const minZ = pcd.geometry.boundingBox ? pcd.geometry.boundingBox.min.z : -10;
            const maxZ = pcd.geometry.boundingBox ? pcd.geometry.boundingBox.max.z : 10;
            const rangeZ = maxZ - minZ || 1;

            for (let i = 0; i < positions.length; i += 3) {
              const z = positions[i + 2];
              const normalizedZ = (z - minZ) / rangeZ;
              // Używamy palety HSL: od niebieskiego (0.6) dla nizin, do czerwonego (0.0) dla wyżyn
              color.setHSL(0.6 - (normalizedZ * 0.6), 1.0, 0.5);
              colors[i] = color.r;
              colors[i + 1] = color.g;
              colors[i + 2] = color.b;
            }
            
            pcd.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            pcd.material.vertexColors = true;
          }
        }
        
        // Z ROS Lidar z jest zazwyczaj w górę, a w Three.js y jest w górę
        pcd.rotation.x = -Math.PI / 2;
        pcd.updateMatrixWorld();
        
        pcd.geometry.computeBoundingSphere();
        pcd.geometry.computeBoundingBox();
        
        scene.add(pcd);
        
        // Adjust camera only if it's the first time (e.g. if we haven't moved far)
        // Or better: just point the camera at the center of the bounding box but don't move the geometry!
        if (cameraRef.current && controlsRef.current && pcd.geometry.boundingSphere && pcd.geometry.boundingBox) {
          const radius = pcd.geometry.boundingSphere.radius;
          const center = new THREE.Vector3();
          pcd.geometry.boundingBox.getCenter(center);
          
          // Apply the rotation to the center point to find where the object actually is in world space
          center.applyEuler(pcd.rotation);
          
          // Only adjust if the camera is currently at the default 0,0,10 or if we specifically want to frame it
          // We can just check if this is the first load by looking at camera position
          if (cameraRef.current.position.z === 10 && cameraRef.current.position.y === 0) {
            cameraRef.current.position.set(center.x, center.y + radius * 0.8, center.z + radius * 1.5);
            controlsRef.current.target.copy(center);
            controlsRef.current.maxDistance = radius * 10;
          }
        }

      } else if (extension === 'ply') {
        const loader = new PLYLoader();
        const geometry = loader.parse(buffer);
        
        let useColors = geometry.hasAttribute('color');
        
        if (!useColors) {
          const positions = geometry.attributes.position.array;
          const colors = new Float32Array(positions.length);
          const color = new THREE.Color();
          
          geometry.computeBoundingBox();
          const minZ = geometry.boundingBox ? geometry.boundingBox.min.z : -10;
          const maxZ = geometry.boundingBox ? geometry.boundingBox.max.z : 10;
          const rangeZ = maxZ - minZ || 1;

          for (let i = 0; i < positions.length; i += 3) {
            const z = positions[i + 2];
            const normalizedZ = (z - minZ) / rangeZ;
            color.setHSL(0.6 - (normalizedZ * 0.6), 1.0, 0.5);
            colors[i] = color.r;
            colors[i + 1] = color.g;
            colors[i + 2] = color.b;
          }
          
          geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
          useColors = true;
        }

        const material = new THREE.PointsMaterial({ size: 0.2, vertexColors: useColors });
        
        const points = new THREE.Points(geometry, material);
        
        points.rotation.x = -Math.PI / 2;
        points.updateMatrixWorld();

        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        
        scene.add(points);
        
        if (cameraRef.current && controlsRef.current && geometry.boundingSphere && geometry.boundingBox) {
          const radius = geometry.boundingSphere.radius;
          const center = new THREE.Vector3();
          geometry.boundingBox.getCenter(center);
          center.applyEuler(points.rotation);
          
          if (cameraRef.current.position.z === 10 && cameraRef.current.position.y === 0) {
            cameraRef.current.position.set(center.x, center.y + radius * 0.8, center.z + radius * 1.5);
            controlsRef.current.target.copy(center);
            controlsRef.current.maxDistance = radius * 10;
          }
        }
      } else {
        setError('Nieobsługiwany format pliku. Wybierz plik .pcd lub .ply');
      }
    } catch (err) {
      console.error(err);
      setError('Błąd podczas parsowania pliku 3D.');
    }
    
    setLoading(false);
  };

  useEffect(() => {
    if (!viewerUrl) return;
    
    const fetchFile = async () => {
      setLoading(true);
      setError(null);
      
      try {
        if (viewerUrl.endsWith('/')) {
          // Folder mode, fetch manifest
          const res = await fetch(viewerUrl + 'manifest.json');
          if (!res.ok) throw new Error('Brak pliku manifest.json w podanym folderze.');
          const files: string[] = await res.json();
          if (files.length === 0) throw new Error('Brak plików w manifest.json');
          
          setPlaylist(files);
          setCurrentIndex(0);
          
          const firstFileUrl = viewerUrl + files[0];
          setFileName(files[0]);
          const fileRes = await fetch(firstFileUrl);
          if (!fileRes.ok) throw new Error('Błąd pobierania pierwszego pliku.');
          loadPointCloud(await fileRes.arrayBuffer(), files[0]);
        } else {
          // Single file mode
          const urlParts = viewerUrl.split('/');
          setFileName(urlParts[urlParts.length - 1]);
          const res = await fetch(viewerUrl);
          if (!res.ok) throw new Error('Błąd pobierania pliku.');
          loadPointCloud(await res.arrayBuffer(), viewerUrl);
        }
      } catch (err) {
        console.error(err);
        setError('Nie udało się załadować danych z serwera symulacji.');
        setLoading(false);
      }
    };
    
    fetchFile();
  }, [viewerUrl]);

  const loadFrame = async (index: number) => {
    if (!viewerUrl || playlist.length === 0) return;
    try {
      setFileName(playlist[index]);
      const res = await fetch(viewerUrl + playlist[index]);
      if (res.ok) {
        loadPointCloud(await res.arrayBuffer(), playlist[index]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (!isPlaying) return;

    let timerId: any;
    const playNext = async () => {
      if (!isPlayingRef.current) return;
      
      setCurrentIndex((prev) => {
        const next = (prev + 1) % playlist.length;
        loadFrame(next);
        return next;
      });
      
      timerId = setTimeout(playNext, 150);
    };
    
    playNext();
    return () => clearTimeout(timerId);
  }, [isPlaying, playlist, viewerUrl]);

  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111827); // tailwind gray-900
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(0, 0, 10);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls setup
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // Helper grid and axes
    const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x222222);
    scene.add(gridHelper);
    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    // Animation loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!mountRef.current || !cameraRef.current || !rendererRef.current) return;
      const newWidth = mountRef.current.clientWidth;
      const newHeight = mountRef.current.clientHeight;
      cameraRef.current.aspect = newWidth / newHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const contents = e.target?.result;
      if (!contents) return;
      loadPointCloud(contents as ArrayBuffer, file.name);
    };

    reader.onerror = () => {
      setError('Błąd wczytywania pliku.');
      setLoading(false);
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-background/95 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="bg-card w-full h-full max-w-7xl max-h-[90vh] rounded-xl border border-border shadow-2xl flex flex-col overflow-hidden relative">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50 bg-muted/30">
          <div className="flex items-center gap-2">
            <Box className="h-5 w-5 text-primary" />
            <h2 className="font-bold text-lg">Wizualizator Chmur Punktów (LIDAR / GPR)</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-4 flex flex-col gap-4 bg-background border-b border-border/50">
          <div className="flex items-center gap-4">
            <input 
              type="file" 
              accept=".pcd,.ply"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload"
            />
            <label 
              htmlFor="file-upload"
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md cursor-pointer hover:bg-primary/90 transition-colors font-medium text-sm whitespace-nowrap"
            >
              <Upload className="h-4 w-4" />
              Wgraj plik z logów (PCD / PLY)
            </label>
            
            {fileName && (
              <span className="text-sm font-medium text-muted-foreground truncate max-w-md">
                Aktualny plik: <span className="text-foreground">{fileName}</span>
              </span>
            )}

            {loading && <span className="text-sm text-primary animate-pulse whitespace-nowrap">Ładowanie i przetwarzanie chmury...</span>}
            {error && <span className="text-sm text-destructive font-medium">{error}</span>}
          </div>

          {playlist.length > 0 && (
            <div className="flex items-center gap-4 w-full bg-muted/20 p-2 rounded-md">
              <button
                onClick={() => {
                  setIsPlaying(false);
                  const prev = currentIndex === 0 ? playlist.length - 1 : currentIndex - 1;
                  setCurrentIndex(prev);
                  loadFrame(prev);
                }}
                className="p-1 hover:text-primary transition-colors"
              >
                <SkipBack className="h-5 w-5" />
              </button>
              
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-2 bg-primary/20 hover:bg-primary/40 text-primary rounded-full transition-colors"
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </button>
              
              <button
                onClick={() => {
                  setIsPlaying(false);
                  const next = (currentIndex + 1) % playlist.length;
                  setCurrentIndex(next);
                  loadFrame(next);
                }}
                className="p-1 hover:text-primary transition-colors"
              >
                <SkipForward className="h-5 w-5" />
              </button>

              <input 
                type="range"
                min={0}
                max={playlist.length - 1}
                value={currentIndex}
                onChange={(e) => {
                  setIsPlaying(false);
                  const idx = parseInt(e.target.value);
                  setCurrentIndex(idx);
                  loadFrame(idx);
                }}
                className="flex-1 accent-primary"
              />
              
              <span className="text-xs font-mono w-16 text-right">
                {currentIndex + 1} / {playlist.length}
              </span>
            </div>
          )}
        </div>

        {/* 3D Canvas Container */}
        <div className="flex-1 relative bg-black">
          <div ref={mountRef} className="absolute inset-0" />
          
          {!fileName && !loading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <Box className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
                <p className="text-muted-foreground font-medium text-lg">Brak załadowanego modelu.</p>
                <p className="text-muted-foreground/60 text-sm mt-1">Użyj przycisku powyżej, aby załadować chmurę punktów.</p>
              </div>
            </div>
          )}
          
          {/* Controls hint */}
          <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur text-white/80 p-3 rounded-md text-xs pointer-events-none border border-white/10">
            <ul className="space-y-1">
              <li><strong className="text-white">Lewy Przycisk Myszy</strong> - Obrót (Orbit)</li>
              <li><strong className="text-white">Prawy Przycisk Myszy</strong> - Przesuwanie (Pan)</li>
              <li><strong className="text-white">Scroll Myszy</strong> - Przybliżanie (Zoom)</li>
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}
