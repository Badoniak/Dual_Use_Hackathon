import { describe, expect, it } from 'vitest';
import { planCoverage, planPositionAt, scanTimeField, swathWidth } from '../../src/sim/flightPlan';
import { pointInPolygon } from '../../src/sim/geo';

describe('plan lotu zwiadowcy nad wybranym obszarem', () => {
  const rect: [number, number][] = [[0, 0], [60, 0], [60, 40], [0, 40]];

  it('pas termowizji wynika z wysokości i pola widzenia 60°', () => {
    expect(swathWidth(30, 60)).toBeCloseTo(34.64, 1);
    const low = planCoverage(rect, { altitude: 20 }), high = planCoverage(rect, { altitude: 50 });
    expect(low.lines).toBeGreaterThan(high.lines);
  });

  it('trasa pokrywa cały obszar, baza poza obszarem, start i lądowanie na ziemi', () => {
    const plan = planCoverage(rect, { altitude: 30 });
    expect(plan.lines).toBe(2);
    expect(pointInPolygon(plan.base[0], plan.base[1], rect)).toBe(false);
    expect(plan.waypoints[0][2]).toBe(0);
    expect(plan.waypoints[plan.waypoints.length - 1][2]).toBe(0);
    const field = scanTimeField(plan, { minX: -10, minY: -10, maxX: 70, maxY: 50 });
    for (let x = 1; x < 60; x += 3) for (let y = 1; y < 40; y += 3) expect(Number.isFinite(field(x, y))).toBe(true);
    // ~2 linie po 60 m + dojścia, 8 m/s
    expect(plan.duration).toBeGreaterThan(20);
    expect(plan.duration).toBeLessThan(120);
  });

  it('linie równoległe do najdłuższej krawędzi (obszar obrócony o 30°)', () => {
    const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
    const rot = rect.map(([x, y]) => [x * c - y * s, x * s + y * c] as [number, number]);
    const plan = planCoverage(rot, { altitude: 30 });
    const [p, q] = [plan.waypoints[2], plan.waypoints[3]];
    const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
    expect(Math.abs(Math.sin(ang - a))).toBeLessThan(0.01);
  });

  it('pozycja na planie jest ciągła', () => {
    const plan = planCoverage(rect, { altitude: 30 });
    let prev = planPositionAt(plan, 0);
    for (let t = 0.5; t <= plan.duration; t += 0.5) {
      const p = planPositionAt(plan, t);
      expect(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])).toBeLessThan(8 * 0.5 + 0.01);
      prev = p;
    }
  });
});
