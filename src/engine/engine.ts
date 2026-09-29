// Silnik symulacji misji: jeden zegar dla całej aplikacji (niezależny od otwartej zakładki).
// Zwiadowca odtwarza zarejestrowaną trajektorię, drony radarowe realizują kolejkę punktów pomiaru:
// start → przelot → lądowanie → pomiar (silniki wyłączone) → kolejny punkt lub powrót i wymiana baterii.
import { planPositionAt } from '../sim/flightPlan';
import { measureAtSite } from '../sim/scenario';
import type { Vec3 } from '../sim/types';
import { useDroneStore, type Drone } from '../store/useDroneStore';
import { useMissionStore } from '../store/useMissionStore';
import { useLogStore } from '../store/useLogStore';

export const TIMING = {
  takeoffS: 15,
  landingS: 20,
  cruiseMs: 8,
  cruiseAlt: 15,
  swapS: 120,
  /** 875 W zawisu / 355 Wh baterii → %/s */
  flightDrainPct: (875 / 355 / 3600) * 100,
  /** radar + komputer na ziemi: 20 W */
  groundDrainPct: (20 / 355 / 3600) * 100,
  reservePct: 20,
  /** wysokość zawisu nad gruzem przy opuszczaniu sondy (wariant T) */
  probeHoverM: 6,
};

const log = (m: string, t: 'info' | 'success' | 'warning' | 'error' = 'info') => useLogStore.getState().addLog(m, t, 'DRON');

/** Miejsce startu drona radarowego nr i — przy bazie obok wybranego obszaru. */
export function baseSlot(i: number): Vec3 {
  const b = useMissionStore.getState().baseLocal ?? [0, 0, 0];
  return [b[0] - 4.5 + i * 3, b[1] - 3, 0];
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pushTrail(d: Drone, p: Vec3) {
  const last = d.trail[d.trail.length - 1];
  if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.5) {
    d.trail = d.trail.length > 3000 ? [...d.trail.slice(-2000), p] : [...d.trail, p];
  }
}

function moveTowards(d: Drone, target: Vec3, dist: number): boolean {
  const p = d.pos ?? target;
  const dx = target[0] - p[0], dy = target[1] - p[1];
  const L = Math.hypot(dx, dy);
  if (L <= dist) {
    d.pos = [target[0], target[1], p[2]];
    return true;
  }
  d.heading = (Math.atan2(dx, dy) * 180) / Math.PI;
  d.pos = [p[0] + (dx / L) * dist, p[1] + (dy / L) * dist, p[2]];
  return false;
}

function updateScout(d: Drone, t: number) {
  const ms = useMissionStore.getState();
  const tr = ms.scoutTrack;
  if (d.status !== 'scanning' || !tr) return;
  const el = t - tr.startSim;
  const prev = d.pos;
  const p = planPositionAt(tr.plan, Math.min(el, tr.plan.duration));
  d.pos = p;
  if (prev) {
    const dx = p[0] - prev[0], dy = p[1] - prev[1];
    if (Math.hypot(dx, dy) > 0.01) d.heading = (Math.atan2(dx, dy) * 180) / Math.PI;
    d.speed = Math.hypot(dx, dy, p[2] - prev[2]);
  }
  d.battery = Math.max(0, 100 - Math.min(el, tr.plan.duration) * TIMING.flightDrainPct);
  pushTrail(d, p);
  ms.revealHotspots(el);
  if (el >= tr.plan.duration) {
    d.status = 'base';
    d.speed = 0;
    log('Zwiadowca-1 wylądował — skan obszaru przesłany do stacji naziemnej.', 'success');
    queueMicrotask(() => useMissionStore.getState().onScoutFlightDone());
  }
}

function updateRadar(d: Drone, idx: number, t: number, dt: number) {
  const ms = useMissionStore.getState();
  if (!ms.anchor) return;
  const home = baseSlot(idx);
  if (!d.pos) d.pos = home;
  const airborne = d.status === 'takeoff' || d.status === 'transit' || d.status === 'landing' || d.status === 'returning';
  const site = d.taskSiteId ? ms.landingSites.find(l => l.id === d.taskSiteId) ?? null : null;
  // wariant T: pomiar z zawisu (sonda na lince) kosztuje tyle energii co lot
  const hovering = d.status === 'measuring' && site?.method === 'probe';
  d.battery = Math.max(0, d.battery - dt * (airborne || hovering ? TIMING.flightDrainPct : d.status === 'measuring' ? TIMING.groundDrainPct : 0));

  switch (d.status) {
    case 'base': {
      d.speed = 0;
      if (d.enabled && ms.phase === 'radar' && ms.radarQueue.length > 0 && d.battery > 40) {
        const task = ms.takeRadarTask(d.pos);
        if (task) {
          d.taskSiteId = task.id;
          d.status = 'takeoff';
          d.phaseStartedAt = t;
          d.phaseEndsAt = t + TIMING.takeoffS;
          log(`${d.name}: start do punktu ${task.id}${task.method === 'probe' ? ' (sonda na lince — wariant T)' : ''}.`);
        }
      }
      break;
    }
    case 'takeoff': {
      const f = Math.min(1, (t - d.phaseStartedAt) / TIMING.takeoffS);
      d.pos = [d.pos[0], d.pos[1], d.pos[2] + (TIMING.cruiseAlt - d.pos[2]) * f];
      if (t >= d.phaseEndsAt) {
        d.status = site ? 'transit' : 'returning';
      }
      break;
    }
    case 'transit': {
      if (!site) { d.status = 'returning'; break; }
      d.speed = TIMING.cruiseMs;
      pushTrail(d, d.pos);
      if (moveTowards(d, site.position, TIMING.cruiseMs * dt)) {
        d.status = 'landing';
        d.phaseStartedAt = t;
        d.phaseEndsAt = t + TIMING.landingS;
      }
      break;
    }
    case 'landing': {
      d.speed = 0;
      // wariant T: dron zawisa ~6 m nad gruzem i opuszcza sondę na lince
      const targetZ = site ? site.position[2] + (site.method === 'probe' ? TIMING.probeHoverM : 0) : home[2];
      const f = Math.min(1, (t - d.phaseStartedAt) / TIMING.landingS);
      d.pos = [d.pos[0], d.pos[1], TIMING.cruiseAlt + (targetZ - TIMING.cruiseAlt) * f];
      if (t >= d.phaseEndsAt) {
        d.status = 'measuring';
        d.phaseStartedAt = t;
        d.phaseEndsAt = t + ms.scenario.measureS;
      }
      break;
    }
    case 'measuring': {
      if (!site) { d.status = 'takeoff'; d.phaseStartedAt = t; d.phaseEndsAt = t + TIMING.takeoffS; break; }
      if (t >= d.phaseEndsAt) {
        const m = measureAtSite(site, ms.simVictims, ms.scenario, hashSeed(site.id + ':' + ms.measurements.length), d.id, t);
        ms.addMeasurement(m);
        d.measurementsDone++;
        // kolejny punkt, jeśli starczy baterii na przelot + powrót
        const next = d.enabled && d.battery > TIMING.reservePct + 15 ? useMissionStore.getState().takeRadarTask(d.pos) : null;
        d.taskSiteId = next?.id ?? null;
        d.status = 'takeoff';
        d.phaseStartedAt = t;
        d.phaseEndsAt = t + TIMING.takeoffS;
        if (!next && useMissionStore.getState().radarQueue.length > 0) {
          log(d.enabled ? `${d.name}: bateria ${d.battery.toFixed(0)}% — powrót na wymianę.` : `${d.name}: wyłączony przez operatora — powrót do bazy.`, 'warning');
        }
      }
      break;
    }
    case 'returning': {
      d.speed = TIMING.cruiseMs;
      pushTrail(d, d.pos);
      if (moveTowards(d, home, TIMING.cruiseMs * dt)) {
        d.pos = [home[0], home[1], 0];
        d.speed = 0;
        d.taskSiteId = null;
        if (d.battery < 60) {
          d.status = 'charging';
          d.phaseStartedAt = t;
          d.phaseEndsAt = t + TIMING.swapS;
        } else d.status = 'base';
      }
      break;
    }
    case 'charging': {
      if (t >= d.phaseEndsAt) { d.battery = 100; d.status = 'base'; }
      break;
    }
    default:
      break;
  }
}

/**
 * Zawrócenie pojedynczego drona radarowego do bazy. Niewykonany punkt pomiaru wraca do kolejki,
 * a dron zostaje wyłączony z przydziału zadań (operator włącza go ponownie w panelu).
 */
export function recallDrone(id: string): void {
  const ds = useDroneStore.getState();
  const d = ds.drones.find(x => x.id === id);
  if (!d || d.role !== 'radar') return;
  const t = ds.simTime;
  const patch: Partial<Drone> = { enabled: false, taskSiteId: null };
  if (d.taskSiteId) useMissionStore.getState().returnRadarTask(d.taskSiteId);
  if (d.status === 'measuring' || d.status === 'landing') {
    Object.assign(patch, { status: 'takeoff', phaseStartedAt: t, phaseEndsAt: t + TIMING.takeoffS });
  } else if (d.status === 'transit' || d.status === 'takeoff') {
    Object.assign(patch, { status: 'returning' });
  }
  ds.updateDrone(id, patch);
  log(`${d.name}: zawrócony do bazy przez operatora${d.taskSiteId ? ` (punkt ${d.taskSiteId} wraca do kolejki)` : ''}.`, 'warning');
}

export function tick(dtReal: number): void {
  const ds = useDroneStore.getState();
  if (ds.paused) return;
  const dt = Math.min(dtReal, 0.5) * ds.timeMultiplier;
  const t = ds.simTime + dt;
  const drones = ds.drones.map(d => ({ ...d }));
  let radarIdx = 0;
  for (const d of drones) {
    if (d.role === 'scout') updateScout(d, t);
    else updateRadar(d, radarIdx++, t, dt);
  }
  useDroneStore.setState({ simTime: t, drones });

  const ms = useMissionStore.getState();
  if (ms.phase === 'radar' && ms.radarQueue.length === 0 && drones.filter(d => d.role === 'radar').every(d => d.status === 'base' || d.status === 'charging')) {
    const vital = ms.detections.filter(x => x.vital).length;
    useMissionStore.setState({ phase: 'complete' });
    useLogStore.getState().addLog(`Faza 2 zakończona: ${ms.measurements.length} pomiarów, oznaki życia przy ${vital} hot spotach. Wyniki czekają na zatwierdzenie w zakładce „Wykrycia”.`, 'success', 'SYSTEM');
  }
}

let running: ReturnType<typeof setInterval> | null = null;

export function startEngine(): () => void {
  if (running) return () => {};
  let last = performance.now();
  running = setInterval(() => {
    const now = performance.now();
    tick((now - last) / 1000);
    last = now;
  }, 100);
  return () => {
    if (running) clearInterval(running);
    running = null;
  };
}
