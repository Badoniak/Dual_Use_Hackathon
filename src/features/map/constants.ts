import type { Hotspot } from '../../sim/types';

/** Miejsce zdarzenia z danych symulacji (świat Gazebo, punkt (0,0) ≈ 52.2297 N, 21.0122 E). */
export const SIM_SITE: [number, number] = [21.0124, 52.2297];

export const HOTSPOT_COLORS: Record<Hotspot['kind'], string> = {
  fused: '#ef4444',
  manual: '#3b82f6',
};
