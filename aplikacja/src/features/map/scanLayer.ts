// Chmura punktów 3D ze skanu zwiadowcy rysowana bezpośrednio na mapie (warstwa własna MapLibre + three.js).
// Punkt pojawia się w chwili, gdy dron obejmie go pasem widzenia (atrybut aScan vs uniform uTime),
// więc mapa 3D "narasta" w trakcie lotu nad wybranym obszarem.
import * as THREE from 'three';
import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MLMap } from 'maplibre-gl';
import type { GeoAnchor } from '../../sim/types';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uSize;
attribute vec3 aColor;
attribute float aScan;
varying vec3 vColor;
void main() {
  if (aScan > uTime) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float age = uTime - aScan;
  vColor = mix(vec3(0.55, 0.95, 1.0), aColor, clamp(age / 3.0, 0.0, 1.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
  gl_FragColor = vec4(vColor, 1.0);
}`;

export class ScanLayer implements CustomLayerInterface {
  readonly id = 'scan-3d';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map: MLMap | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private points: THREE.Points | null = null;
  private model = new THREE.Matrix4();
  private material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 1e9 }, uSize: { value: 2.5 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
  visible = true;

  onAdd(map: MLMap, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
  }

  onRemove(): void {
    this.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  }

  /** Dane w układzie lokalnym ENU [m] zakotwiczonym w (lat0, lon0). */
  setData(anchor: GeoAnchor, positions: Float32Array, colors: Float32Array, scanTimes: Float32Array): void {
    this.clear();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aScan', new THREE.BufferAttribute(scanTimes, 1));
    const pts = new THREE.Points(geo, this.material);
    pts.frustumCulled = false;
    pts.matrixAutoUpdate = false;
    this.scene.add(pts);
    this.points = pts;
    // ENU [m] → współrzędne Mercatora: przesunięcie do kotwicy, skala m→Mercator, oś y na południe
    const mc = MercatorCoordinate.fromLngLat([anchor.lon0, anchor.lat0], 0);
    const s = mc.meterInMercatorCoordinateUnits();
    this.model = new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z).scale(new THREE.Vector3(s, -s, s));
    this.map?.triggerRepaint();
  }

  setColors(colors: Float32Array): void {
    if (!this.points) return;
    this.points.geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.map?.triggerRepaint();
  }

  setTime(t: number): void {
    if (this.material.uniforms.uTime.value === t) return;
    this.material.uniforms.uTime.value = t;
    this.map?.triggerRepaint();
  }

  /** Zakres rysowanych punktów (np. tylko lidar albo tylko kamera RGB-D). */
  setRange(start: number, count: number): void {
    if (!this.points) return;
    this.points.geometry.setDrawRange(start, count);
    this.map?.triggerRepaint();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.map?.triggerRepaint();
  }

  hasData(): boolean {
    return this.points !== null;
  }

  clear(): void {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points = null;
      this.map?.triggerRepaint();
    }
  }

  render(_gl: WebGL2RenderingContext, args: CustomRenderMethodInput): void {
    if (!this.points || !this.renderer || !this.map || !this.visible) return;
    const zoom = this.map.getZoom();
    this.material.uniforms.uSize.value = Math.min(8, Math.max(1.5, 2.2 * Math.pow(2, zoom - 18))) * (window.devicePixelRatio || 1);
    const proj = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[]);
    this.camera.projectionMatrix = proj.multiply(this.model);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }
}

/** Kolory punktów dla trybów wyświetlania (RGB, wysokość, termowizja). */
export function cloudColors(mode: 'rgb' | 'height' | 'thermal', positions: Float32Array, colors: Uint8Array, temps: Float32Array | null, ironbow: (t: number) => [number, number, number]): Float32Array {
  const n = positions.length / 3;
  const out = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    if (mode === 'rgb') {
      out[3 * i] = colors[3 * i] / 255; out[3 * i + 1] = colors[3 * i + 1] / 255; out[3 * i + 2] = colors[3 * i + 2] / 255;
    } else if (mode === 'height') {
      c.setHSL(0.66 - 0.66 * Math.min(1, Math.max(0, positions[3 * i + 2] / 12)), 0.9, 0.5);
      out[3 * i] = c.r; out[3 * i + 1] = c.g; out[3 * i + 2] = c.b;
    } else {
      const T = temps ? temps[i] : NaN;
      if (Number.isNaN(T)) { out[3 * i] = out[3 * i + 1] = out[3 * i + 2] = 0.18; continue; }
      const [r, g, b] = T >= 330 ? [255, 255, 255] : ironbow((T - 285) / 35);
      out[3 * i] = r / 255; out[3 * i + 1] = g / 255; out[3 * i + 2] = b / 255;
    }
  }
  return out;
}
