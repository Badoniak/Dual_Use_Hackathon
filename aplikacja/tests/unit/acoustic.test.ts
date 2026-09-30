import { describe, expect, it } from 'vitest';
import { parseSoundSourcesYaml, parseTrajectory, parseWav } from '../../src/sim/parse';
import { analyzeAudio } from '../../src/sim/acoustic';
import { hasData, readBuffer, readText } from './data';

describe.skipIf(!hasData)('analiza mikrofonu', () => {
  it('wykrywa ton 1100 Hz (telefon/alarm) i szum szerokopasmowy', () => {
    const tr = parseTrajectory(readText('trajectory.csv'));
    const wav = parseWav(readBuffer('microphone/microphone.wav'));
    const start = parseFloat(readText('microphone/index.csv').split('\n')[1].split(',')[1]);
    const t0 = performance.now();
    const res = analyzeAudio(wav, start, tr, { minX: -45, minY: -35, maxX: 55, maxY: 35 });
    console.log(`analiza ${(performance.now() - t0).toFixed(0)} ms, ramki ${res.frames.length}`);
    const counts: Record<string, number> = {};
    for (const e of res.events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    console.log('zdarzenia', counts);
    for (const s of res.sources) console.log(s.id, s.kind, s.freqHz.toFixed(0), 'Hz', s.position.map(v => v.toFixed(1)).join(','), 'r=', s.radius.toFixed(1), 'n=', s.events, 'snr', s.snrMaxDb.toFixed(1), 't', s.tFirst.toFixed(0), '-', s.tLast.toFixed(0));
    const gt = parseSoundSourcesYaml(readText('ground_truth/sound_sources.yaml'));
    console.log('GT', gt.map(g => `${g.name} ${g.type} ${g.xyz.join(',')}`).join(' | '));
    const tone = res.sources.find(s => s.kind === 'tone' && Math.abs(s.freqHz - 1100) < 15);
    expect(tone).toBeTruthy();
    // telefon z ground truth leży w strefie niepewności źródła tonalnego
    const phone = gt.find(g => g.type === 'tone')!;
    expect(Math.hypot(tone!.position[0] - phone.xyz[0], tone!.position[1] - phone.xyz[1])).toBeLessThan(tone!.radius);
    // trzaski (tlące się pogorzelisko) zlokalizowane z dokładnością kilku metrów
    const crackle = gt.find(g => g.type === 'crackle')!;
    const broad = res.sources.find(s => s.kind === 'broadband')!;
    expect(Math.hypot(broad.position[0] - crackle.xyz[0], broad.position[1] - crackle.xyz[1])).toBeLessThan(3);
    // brak fałszywych detekcji głosu (w nagraniu nie ma harmonicznych głosu ponad szumem wirników)
    expect(res.sources.filter(s => s.kind === 'voice').length).toBe(0);
  });
});
