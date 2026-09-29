import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';
import { Box, Layers, Upload, X } from 'lucide-react';
import { useMissionStore, sourceRange, type CloudSource } from '../../store/useMissionStore';
import { SourceToggle } from '../layers/SourceToggle';
import { useDroneStore } from '../../store/useDroneStore';
import { ironbow } from '../../sim/thermal';
import { sampleHeight } from '../../sim/grid';
import type { Vec3 } from '../../sim/types';
import { HOTSPOT_COLORS } from '../map/constants';

type ColorMode = 'rgb' | 'height' | 'thermal';

/** ENU (x wschód, y północ, z góra) → Three.js (Y w górę). */
const toThree = (p: Vec3 | [number, number, number]) => new THREE.Vector3(p[0], p[2], -p[1]);

function makeLabel(text: string, color = '#ffffff', bg = 'rgba(0,0,0,0.7)'): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 28px system-ui, sans-serif';
  const w = Math.ceil(ctx.measureText(text).width) + 20;
  c.width = w;
  c.height = 40;
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, 40);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, 21);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // stały rozmiar na ekranie (niezależnie od odległości kamery)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set((w / 40) * 0.032, 0.032, 1);
  s.renderOrder = 10;
  return s;
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse(o => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(x => x.dispose());
    else if (mat) {
      (mat as THREE.SpriteMaterial).map?.dispose();
      mat.dispose();
    }
  });
  g.clear();
}

export function PointCloudViewer() {
  const result = useMissionStore(s => s.result);
  const hotspots = useMissionStore(s => s.hotspots);
  const landingSites = useMissionStore(s => s.landingSites);
  const measurements = useMissionStore(s => s.measurements);
  const detections = useMissionStore(s => s.detections);
  const simVictims = useMissionStore(s => s.simVictims);
  const showTruth = useMissionStore(s => s.mapLayers.victimsTruth);
  const focus = useMissionStore(s => s.viewerFocus);
  const selectedHotspotId = useMissionStore(s => s.selectedHotspotId);
  const closeViewer = useMissionStore(s => s.closeViewer);

  const mountRef = useRef<HTMLDivElement>(null);
  const three = useRef<{
    scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; controls: OrbitControls;
    cloud: THREE.Points | null; overlays: THREE.Group; drones: THREE.Group; pulses: THREE.Object3D[]; clip: THREE.Plane; pickables: THREE.Object3D[];
  } | null>(null);
  const [mode, setMode] = useState<ColorMode>('rgb');
  const [source, setSource] = useState<CloudSource>(() => useMissionStore.getState().mapLayers.cloudSource);
  const [pointSize, setPointSize] = useState(0.09);
  const [clipZ, setClipZ] = useState(30);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState({ hotspots: true, landing: true, radar: true, path: true, drones: true });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const zRange = useMemo(() => {
    if (!result) return { min: 0, max: 15 };
    return { min: Math.floor(result.crop.minZ), max: Math.ceil(Math.min(result.crop.maxZ, 30)) };
  }, [result]);

  // --- scena
  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 2000);
    camera.position.set(0, 60, 60);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.localClippingEnabled = true;
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    const grid = new THREE.GridHelper(200, 40, 0x334155, 0x1e293b);
    grid.position.y = -0.02;
    scene.add(grid);
    const overlays = new THREE.Group();
    const drones = new THREE.Group();
    scene.add(overlays, drones);
    three.current = { scene, camera, renderer, controls, cloud: null, overlays, drones, pulses: [], clip: new THREE.Plane(new THREE.Vector3(0, -1, 0), 30), pickables: [] };

    let raf = 0;
    const clock = new THREE.Clock();
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      for (const p of three.current?.pulses ?? []) p.scale.setScalar(1 + 0.25 * Math.sin(t * 4));
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    const ro = new ResizeObserver(() => {
      camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    });
    ro.observe(mount);

    // wybór hotspotu kliknięciem
    const ray = new THREE.Raycaster();
    const onClick = (e: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(three.current?.pickables ?? [], false)[0];
      const id = hit?.object.userData.hotspotId as string | undefined;
      if (id) useMissionStore.getState().selectHotspot(id);
    };
    renderer.domElement.addEventListener('click', onClick);
    (window as unknown as { __viewer?: unknown }).__viewer = three.current;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      disposeGroup(scene);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      three.current = null;
    };
  }, []);

  // --- chmura punktów z misji
  useEffect(() => {
    const T = three.current;
    if (!T || !result || fileName) return;
    const { positions, count } = result.cloud;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[3 * i] = positions[3 * i];
      pos[3 * i + 1] = positions[3 * i + 2];
      pos[3 * i + 2] = -positions[3 * i + 1];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const mat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, clippingPlanes: [T.clip] });
    const pts = new THREE.Points(geo, mat);
    if (T.cloud) { T.scene.remove(T.cloud); T.cloud.geometry.dispose(); (T.cloud.material as THREE.Material).dispose(); }
    T.cloud = pts;
    T.scene.add(pts);
    // kamera nad trajektorią
    const c = result.crop;
    const center = toThree([(c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, 0]);
    T.controls.target.copy(center);
    T.camera.position.set(center.x - 10, 45, center.z + 55);
    return () => {
      T.scene.remove(pts);
      geo.dispose();
      mat.dispose();
      if (T.cloud === pts) T.cloud = null;
    };
  }, [result, fileName]);

  // --- kolory punktów
  useEffect(() => {
    const T = three.current;
    if (!T?.cloud || !result || fileName) return;
    const attr = T.cloud.geometry.getAttribute('color') as THREE.BufferAttribute;
    const col = attr.array as Float32Array;
    const { colors, temps, positions, count } = result.cloud;
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      if (mode === 'rgb') {
        col[3 * i] = colors[3 * i] / 255; col[3 * i + 1] = colors[3 * i + 1] / 255; col[3 * i + 2] = colors[3 * i + 2] / 255;
      } else if (mode === 'height') {
        const f = Math.min(1, Math.max(0, positions[3 * i + 2] / 12));
        tmp.setHSL(0.66 - 0.66 * f, 0.9, 0.5);
        col[3 * i] = tmp.r; col[3 * i + 1] = tmp.g; col[3 * i + 2] = tmp.b;
      } else {
        const Tk = temps[i];
        if (Number.isNaN(Tk)) { col[3 * i] = col[3 * i + 1] = col[3 * i + 2] = 0.16; continue; }
        const [r, g, b] = Tk >= 330 ? [255, 255, 255] : ironbow((Tk - 285) / 35);
        col[3 * i] = r / 255; col[3 * i + 1] = g / 255; col[3 * i + 2] = b / 255;
      }
    }
    attr.needsUpdate = true;
  }, [mode, result, fileName]);

  useEffect(() => {
    const T = three.current;
    if (T?.cloud) (T.cloud.material as THREE.PointsMaterial).size = pointSize;
  }, [pointSize, result, fileName]);

  // --- czujnik: lidar / kamera RGB-D / oba (chmura ułożona blokami [lidar][RGB-D])
  useEffect(() => {
    const T = three.current;
    if (!T?.cloud || !result || fileName) return;
    T.cloud.geometry.setDrawRange(...sourceRange(source, result.cloud.count, result.cloud.nLidar));
  }, [source, result, fileName]);

  useEffect(() => {
    if (three.current) three.current.clip.constant = clipZ;
  }, [clipZ]);

  // --- nakładki: hotspoty, lądowiska, radar, trajektoria, prawda scenariusza
  useEffect(() => {
    const T = three.current;
    if (!T) return;
    disposeGroup(T.overlays);
    T.pulses = [];
    T.pickables = [];
    if (!result || fileName) return;
    const hm = result.heightmap;
    if (show.path) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < result.trajectory.t.length; i += 3) pts.push(toThree([result.trajectory.pos[3 * i], result.trajectory.pos[3 * i + 1], result.trajectory.pos[3 * i + 2]]));
      T.overlays.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.8 })));
    }
    if (show.hotspots) {
      for (const h of hotspots) {
        const z = h.sourceZ ?? h.position[2];
        const color = new THREE.Color(HOTSPOT_COLORS[h.kind]);
        const sel = h.id === selectedHotspotId || h.id === focus;
        const s = new THREE.Mesh(new THREE.SphereGeometry(sel ? 0.5 : 0.35, 20, 14), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: h.confidence < 0.5 ? 0.5 : 0.95, depthTest: false }));
        s.position.copy(toThree([h.position[0], h.position[1], z]));
        s.renderOrder = 5;
        s.userData.hotspotId = h.id;
        T.pickables.push(s);
        T.overlays.add(s);
        const top = Math.max(z, h.position[2]) + 1.6;
        T.overlays.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toThree([h.position[0], h.position[1], z]), toThree([h.position[0], h.position[1], top])]), new THREE.LineBasicMaterial({ color })));
        const lbl = makeLabel(`${h.id} ${(h.confidence * 100).toFixed(0)}%`, '#fff', sel ? 'rgba(245,158,11,0.9)' : 'rgba(0,0,0,0.7)');
        lbl.position.copy(toThree([h.position[0], h.position[1], top + 0.35]));
        T.overlays.add(lbl);
      }
    }
    if (show.landing) {
      const active = new Set(hotspots.filter(h => h.radarCandidate).map(h => h.id));
      for (const l of landingSites.filter(x => active.has(x.hotspotId))) {
        const m = measurements.find(x => x.siteId === l.id);
        const color = m ? (m.detection.detected ? 0x22c55e : 0x64748b) : 0x0ea5e9;
        if (l.method === 'probe') {
          // wariant T: sonda na lince — stożek + linka do drona w zawisie
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 16), new THREE.MeshBasicMaterial({ color: 0xf59e0b }));
          cone.position.copy(toThree([l.position[0], l.position[1], l.position[2] + 0.25]));
          cone.rotation.x = Math.PI;
          T.overlays.add(cone);
          T.overlays.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toThree([l.position[0], l.position[1], l.position[2] + 0.5]), toThree([l.position[0], l.position[1], l.position[2] + 6])]), new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.7 })));
        } else {
          const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }));
          disc.position.copy(toThree([l.position[0], l.position[1], l.position[2] + 0.05]));
          T.overlays.add(disc);
        }
        const lbl = makeLabel(l.id.split('-').pop()!, '#e0f2fe', 'rgba(3,105,161,0.8)');
        lbl.scale.multiplyScalar(0.7);
        lbl.position.copy(toThree([l.position[0], l.position[1], l.position[2] + 0.6]));
        T.overlays.add(lbl);
      }
    }
    if (show.radar) {
      for (const d of detections.filter(x => x.vital)) {
        const e = d.estimate;
        const p = e ? e.position : d.local;
        const surf = e ? e.surfaceZ : sampleHeight(hm, p[0], p[1]);
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 14), new THREE.MeshBasicMaterial({ color: d.status === 'confirmed' ? 0x16a34a : 0xdc2626, depthTest: false, transparent: true }));
        core.position.copy(toThree(p));
        core.renderOrder = 6;
        T.overlays.add(core);
        T.pulses.push(core);
        if (e) {
          // przedział głębokości jako pionowy słupek pod powierzchnią
          const zTop = surf - e.depthMin, zBot = surf - e.depthMax;
          const bar = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.15, e.horizontalErr), Math.max(0.15, e.horizontalErr), Math.max(0.05, zTop - zBot), 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthTest: false }));
          bar.position.copy(toThree([p[0], p[1], (zTop + zBot) / 2]));
          T.overlays.add(bar);
          T.overlays.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toThree([p[0], p[1], surf]), toThree(p)]), new THREE.LineDashedMaterial({ color: 0xef4444, dashSize: 0.15, gapSize: 0.1 })).computeLineDistances());
          for (const m of measurements.filter(x => d.siteIds.includes(x.siteId))) {
            T.overlays.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([toThree(m.sitePos), toThree(p)]), new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.6 })));
          }
        }
        const lbl = makeLabel(e ? `♥ ${d.hotspotId}: ${e.depthMin.toFixed(1)}–${e.depthMax.toFixed(1)} m` : `♥ ${d.hotspotId}: głęb. ?`, '#fff', 'rgba(185,28,28,0.9)');
        lbl.position.copy(toThree([p[0], p[1], surf + 2.6]));
        T.overlays.add(lbl);
      }
    }
    if (showTruth) {
      for (const v of simVictims) {
        const w = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: 0xf472b6, wireframe: true, depthTest: false }));
        w.position.copy(toThree(v.position));
        T.overlays.add(w);
        const lbl = makeLabel(`prawda: ${v.id}`, '#fce7f3', 'rgba(131,24,67,0.85)');
        lbl.scale.multiplyScalar(0.7);
        lbl.position.copy(toThree([v.position[0], v.position[1], v.position[2] - 0.8]));
        T.overlays.add(lbl);
      }
    }
  }, [result, hotspots, landingSites, measurements, detections, simVictims, showTruth, show, selectedHotspotId, focus, fileName]);

  // --- skupienie kamery na hotspocie
  useEffect(() => {
    const T = three.current;
    const id = focus ?? selectedHotspotId;
    if (!T || !id || !result) return;
    const h = hotspots.find(x => x.id === id);
    if (!h) return;
    const target = toThree([h.position[0], h.position[1], h.sourceZ ?? h.position[2]]);
    T.controls.target.copy(target);
    T.camera.position.set(target.x + 9, target.y + 9, target.z + 11);
  }, [focus, selectedHotspotId, result, hotspots]);

  // --- drony na żywo
  useEffect(() => {
    const apply = () => {
      const T = three.current;
      if (!T) return;
      T.drones.visible = show.drones && !fileName;
      const ds = useDroneStore.getState().drones.filter(d => d.pos && (d.role === 'radar' || d.status === 'scanning'));
      while (T.drones.children.length < ds.length) {
        const g = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshBasicMaterial({ color: 0x22c55e }));
        T.drones.add(g);
      }
      T.drones.children.forEach((o, i) => {
        const d = ds[i];
        o.visible = !!d;
        if (!d) return;
        o.position.copy(toThree([d.pos![0], d.pos![1], d.pos![2] + 0.4]));
        ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(d.role === 'scout' ? 0x3b82f6 : d.status === 'measuring' ? 0xfacc15 : 0x22c55e);
      });
    };
    apply();
    return useDroneStore.subscribe(apply);
  }, [show.drones, fileName]);

  // --- plik z dysku (PCD / PLY)
  const handleFile = (file: File) => {
    const T = three.current;
    if (!T) return;
    setError(null);
    file.arrayBuffer().then(buf => {
      try {
        const ext = file.name.split('.').pop()?.toLowerCase();
        let pts: THREE.Points;
        if (ext === 'pcd') pts = new PCDLoader().parse(buf);
        else if (ext === 'ply') {
          const geo = new PLYLoader().parse(buf);
          pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: pointSize, vertexColors: geo.hasAttribute('color') }));
        } else throw new Error('Wybierz plik .pcd lub .ply');
        const geo = pts.geometry;
        if (!geo.hasAttribute('color')) {
          geo.computeBoundingBox();
          const bb = geo.boundingBox!;
          const p = geo.getAttribute('position');
          const col = new Float32Array(p.count * 3);
          const c = new THREE.Color();
          for (let i = 0; i < p.count; i++) {
            c.setHSL(0.66 - 0.66 * ((p.getZ(i) - bb.min.z) / (bb.max.z - bb.min.z || 1)), 0.9, 0.5);
            col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
          }
          geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
          (pts.material as THREE.PointsMaterial).vertexColors = true;
        }
        pts.rotation.x = -Math.PI / 2; // ROS: z w górę
        (pts.material as THREE.PointsMaterial).size = pointSize;
        (pts.material as THREE.PointsMaterial).clippingPlanes = [T.clip];
        if (T.cloud) { T.scene.remove(T.cloud); T.cloud.geometry.dispose(); }
        T.cloud = pts;
        T.scene.add(pts);
        geo.computeBoundingSphere();
        const bs = geo.boundingSphere!;
        const center = bs.center.clone().applyEuler(pts.rotation);
        T.controls.target.copy(center);
        T.camera.position.set(center.x, center.y + bs.radius * 0.8, center.z + bs.radius * 1.4);
        setFileName(file.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Błąd parsowania pliku 3D');
      }
    });
  };

  const selected = hotspots.find(h => h.id === (selectedHotspotId ?? focus));

  return (
    <div className="fixed inset-0 z-[9999] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4" data-testid="viewer">
      <div className="bg-card w-full h-full rounded-xl border border-border shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/30 gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Box className="h-5 w-5 text-primary shrink-0" />
            <h2 className="font-bold text-lg truncate">Mapa 3D miejsca zdarzenia</h2>
            <span className="text-xs text-muted-foreground truncate">
              {fileName ? `plik: ${fileName}` : result ? `${result.session} · lidar ${result.stats.lidarPoints.toLocaleString('pl-PL')} pkt + RGB-D ${result.stats.rgbdPoints.toLocaleString('pl-PL')} pkt + termowizja` : 'brak danych z misji'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input type="file" accept=".pcd,.ply" ref={fileInputRef} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
            {fileName && result && <button onClick={() => setFileName(null)} className="text-xs px-2 py-1.5 border border-border/60 rounded hover:bg-muted">Wróć do mapy misji</button>}
            <button onClick={() => fileInputRef.current?.click()} className="text-xs px-2 py-1.5 border border-border/60 rounded hover:bg-muted flex items-center gap-1"><Upload className="h-3.5 w-3.5" /> Plik PCD/PLY</button>
            <button onClick={closeViewer} className="p-2 rounded-md hover:bg-muted/50" data-testid="close-viewer"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 relative bg-black">
            <div ref={mountRef} className="absolute inset-0" />
            {!result && !fileName && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-center">
                <div>
                  <Box className="h-14 w-14 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground font-medium">Brak mapy 3D — wyślij zwiadowcę nad obszar albo wczytaj plik PCD/PLY.</p>
                </div>
              </div>
            )}
            {error && <div className="absolute top-3 left-3 bg-destructive text-destructive-foreground text-sm px-3 py-1.5 rounded">{error}</div>}
            <div className="absolute bottom-3 left-3 bg-black/60 text-white/80 p-2.5 rounded-md text-[11px] pointer-events-none border border-white/10 space-y-0.5">
              <div><b className="text-white">LPM</b> obrót · <b className="text-white">PPM</b> przesuwanie · <b className="text-white">kółko</b> zoom · klik w kulę = hot spot</div>
            </div>
          </div>

          <aside className="w-72 border-l border-border/50 p-3 space-y-4 overflow-y-auto text-sm custom-scrollbar">
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1"><Layers className="h-3.5 w-3.5" /> Kolor punktów</div>
              <div className="flex bg-muted/50 rounded overflow-hidden text-xs">
                {(['rgb', 'height', 'thermal'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)} className={`flex-1 py-1 ${mode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`} data-testid={`color-${m}`}>{m === 'rgb' ? 'RGB' : m === 'height' ? 'Wysokość' : 'Termowizja'}</button>
                ))}
              </div>
              {mode === 'thermal' && <div className="h-2 rounded" style={{ background: 'linear-gradient(90deg,#1a0a3a,#7a1a8a,#e0402a,#f5a623,#fff7a0,#ffffff)' }} />}
              {mode === 'thermal' && <div className="flex justify-between text-[10px] text-muted-foreground"><span>12 °C</span><span>37 °C</span><span>&gt; 57 °C</span></div>}
            </div>
            {result && !fileName && (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-muted-foreground">Czujnik</div>
                <SourceToggle value={source} onChange={setSource} counts={{ lidar: result.cloud.nLidar, rgbd: result.cloud.count - result.cloud.nLidar }} testId="viewer-source" />
                <div className="text-[10px] text-muted-foreground leading-tight">
                  {source === 'lidar' && 'Lidar 3D: szeroki zasięg, kolor z kamery tylko tam, gdzie ją widział (reszta — rampa wysokości).'}
                  {source === 'rgbd' && 'Kamera RGB-D: chmura odtworzona z map głębi i klatek koloru (woksel 5 cm), tylko to, co kamera widziała z bliska.'}
                  {source === 'both' && 'Obie warstwy razem — scalona mapa 3D obszaru.'}
                </div>
              </div>
            )}
            <div className="space-y-1">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Rozmiar punktu</span><span>{pointSize.toFixed(2)}</span></div>
              <input type="range" min={0.02} max={0.3} step={0.01} value={pointSize} onChange={e => setPointSize(parseFloat(e.target.value))} className="w-full accent-primary" />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs"><span className="text-muted-foreground">Przekrój: ukryj powyżej</span><span>{clipZ >= zRange.max ? 'wył.' : `${clipZ.toFixed(1)} m`}</span></div>
              <input type="range" min={zRange.min} max={zRange.max} step={0.25} value={Math.min(clipZ, zRange.max)} onChange={e => setClipZ(parseFloat(e.target.value) >= zRange.max ? 30 : parseFloat(e.target.value))} className="w-full accent-primary" />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">Nakładki</div>
              {([['hotspots', 'Hot spoty'], ['landing', 'Miejsca lądowania'], ['radar', 'Wyniki radaru (głębokość)'], ['path', 'Trajektoria zwiadowcy'], ['drones', 'Drony']] as const).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={show[k]} onChange={() => setShow(s => ({ ...s, [k]: !s[k] }))} className="accent-primary w-3 h-3" />{l}
                </label>
              ))}
            </div>
            {hotspots.length > 0 && !fileName && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground">Hot spoty</div>
                <div className="flex flex-wrap gap-1">
                  {hotspots.filter(h => h.confidence >= 0.5 || h.kind === 'manual').map(h => (
                    <button key={h.id} onClick={() => useMissionStore.getState().selectHotspot(h.id)} className={`text-[11px] px-1.5 py-0.5 rounded border ${h.id === selected?.id ? 'border-amber-500 text-amber-300' : 'border-border/60'}`} style={{ color: h.id === selected?.id ? undefined : HOTSPOT_COLORS[h.kind] }}>{h.id}</button>
                  ))}
                </div>
              </div>
            )}
            {selected && !fileName && (
              <div className="text-xs space-y-1 bg-muted/30 rounded p-2 border border-border/50">
                <div className="font-bold" style={{ color: HOTSPOT_COLORS[selected.kind] }}>{selected.id} · {selected.label}</div>
                <div>Ufność: {(selected.confidence * 100).toFixed(0)}%</div>
                <ul className="list-disc ml-4 text-muted-foreground space-y-0.5">{selected.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                {detections.filter(d => d.hotspotIds.includes(selected.id)).map(d => <div key={d.id} className={d.vital ? 'text-red-300' : 'text-muted-foreground'}>{d.note}</div>)}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
