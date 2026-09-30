// Test e2e całego przepływu misji w prawdziwej przeglądarce (Chrome headless + SwiftShader).
// Użycie: APP_URL=http://localhost:5173/ OUT=/tmp/zrzuty node tests/e2e/flow.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const URL = process.env.APP_URL || 'http://localhost:5173/';
const OUT = process.env.OUT || 'tests/e2e/out';
const CHROME = process.env.CHROME || '/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1680,1000'],
  defaultViewport: { width: 1680, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/tile\.openstreetmap|geoportal|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const state = fn => page.evaluate(fn);
const mission = expr => page.evaluate(`(() => { const s = window.__stores.mission.getState(); return ${expr}; })()`);
const clickText = async (text, selector = 'button') => {
  const [el] = await page.$$(`xpath/.//${selector}[contains(normalize-space(.), "${text}")]`);
  if (!el) throw new Error(`Nie znaleziono: ${text}`);
  await el.click();
};
const waitFor = async (expr, timeout = 60000, step = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await mission(expr)) return true;
    await sleep(step);
  }
  return false;
};
/** piksel na ekranie dla współrzędnych geograficznych */
const lngLatToScreen = async (lng, lat) => {
  const box = await (await page.$('[data-testid="map"]')).boundingBox();
  const p = await page.evaluate(([a, b]) => { const pt = window.__map.project([a, b]); return [pt.x, pt.y]; }, [lng, lat]);
  return [box.x + p[0], box.y + p[1]];
};

try {
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.__stores && window.__map && window.__map.loaded(), { timeout: 30000 });
  check('aplikacja się ładuje, mapa gotowa', true);

  // --- rysowanie obszarów
  const box = await (await page.$('[data-testid="map"]')).boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  await clickText('Wielokąt');
  for (const [fx, fy] of [[0.3, 0.3], [0.45, 0.28], [0.5, 0.45], [0.32, 0.5]]) { const [x, y] = at(fx, fy); await page.mouse.click(x, y); await sleep(120); }
  { const [x, y] = at(0.32, 0.5); await page.mouse.click(x, y, { clickCount: 2 }); }
  await sleep(300);
  check('wielokąt: dwuklik kończy rysowanie', await mission('s.areas.length === 1 && s.areas[0].source === "polygon" && s.drawMode === "none"'), `${await mission('s.areas.length')} obszar(y)`);
  const zoomBefore = await page.evaluate(() => window.__map.getZoom());
  check('dwuklik nie przybliża mapy podczas rysowania', Math.abs(zoomBefore - 16.5) < 0.01, `zoom ${zoomBefore.toFixed(2)}`);

  await clickText('Prostokąt');
  { const [x1, y1] = at(0.6, 0.3); await page.mouse.click(x1, y1); await sleep(150); const [x2, y2] = at(0.75, 0.45); await page.mouse.move(x2, y2); await sleep(100); await page.mouse.click(x2, y2); }
  await sleep(300);
  check('prostokąt: dwa kliknięcia', await mission('s.areas.length === 2 && s.areas[1].source === "rectangle" && s.areas[1].areaM2 > 100'), `${(await mission('s.areas[1]?.areaM2'))?.toFixed(0)} m²`);

  await clickText('LKP + promień');
  { const [x, y] = at(0.6, 0.7); await page.mouse.click(x, y); }
  await sleep(300);
  check('LKP: okrąg o zadanym promieniu', await mission('s.areas.length === 3 && s.areas[2].source === "lkp" && Math.abs(s.areas[2].areaM2 - Math.PI*40*40) < 50'));

  await clickText('Wielokąt');
  { const [x, y] = at(0.2, 0.2); await page.mouse.click(x, y); await sleep(100); }
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Esc anuluje rysowanie', await mission('s.drawMode === "none" && s.areas.length === 3'));

  // usunięcie obszarów i wybór miejsca z symulacji
  for (let i = 0; i < 3; i++) { const [b] = await page.$$('[data-testid="area-row"] button[title="Usuń"]'); await b.click(); await sleep(100); }
  check('usuwanie obszarów', await mission('s.areas.length === 0'));
  await clickText('Zaznacz miejsce zdarzenia z danych symulacji');
  await sleep(1500);
  check('obszar z symulacji (remiza, Warszawa)', await mission('s.areas.length === 1 && s.activeAreaId === s.areas[0].id'));
  await page.screenshot({ path: `${OUT}/01-obszar.png` });

  // --- faza 1
  await sleep(500);
  check('podgląd planu lotu nad obszarem przed startem', (await page.evaluate(() => window.__map.queryRenderedFeatures({ layers: ['scout-plan-line'] }).length)) > 0);
  await page.evaluate(() => window.__stores.drones.getState().setTimeMultiplier(2));
  await (await page.$('[data-testid="launch-scout"]')).click();
  check('start zwiadowcy', await waitFor('s.phase === "scouting"', 10000));
  check('georeferencja z GPS (obszar obejmuje miejsce z symulacji)', await mission('s.anchor && s.anchor.mode === "gps"'));
  check('plan pokrycia obszaru', await mission('s.scoutTrack && s.scoutTrack.plan.lines >= 1'), `${await mission('s.scoutTrack.plan.lines')} linie, ${(await mission('s.scoutTrack.plan.duration')).toFixed(0)} s`);
  await waitFor('s.scan !== null', 20000);
  const visible = () => page.evaluate(() => { const s = window.__stores.mission.getState(); const el = window.__stores.drones.getState().simTime - s.scoutTrack.startSim; let n = 0; for (const t of s.scan.scanTimes) if (t <= el) n++; return n; });
  const v1 = await visible();
  await sleep(2500);
  const v2 = await visible();
  check('skan 3D narasta na mapie w trakcie lotu', (await page.evaluate(() => !!window.__map.getLayer('scan-3d'))) && v2 > v1, `${v1} → ${v2} punktów widocznych`);
  check('mapa w widoku 3D podczas lotu', (await page.evaluate(() => window.__map.getPitch())) > 30);
  const inArea = await page.evaluate(() => {
    const s = window.__stores.mission.getState(); const d = window.__stores.drones.getState().drones.find(x => x.id === 'scout-1');
    const R = 6371008.8 * Math.PI / 180; const a = s.anchor;
    const lng = a.lon0 + d.pos[0] / (R * Math.cos(a.lat0 * Math.PI / 180)), lat = a.lat0 + d.pos[1] / R;
    const ring = s.areas.find(x => x.id === s.activeAreaId).feature.geometry.coordinates[0];
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    return lng > Math.min(...xs) - 0.0003 && lng < Math.max(...xs) + 0.0003 && lat > Math.min(...ys) - 0.0002 && lat < Math.max(...ys) + 0.0002;
  });
  check('zwiadowca leci nad wybranym obszarem', inArea);
  await page.screenshot({ path: `${OUT}/02-zwiad.png` });
  // przełączenie zakładek nie zatrzymuje symulacji
  await page.evaluate(() => window.__stores.drones.getState().setTimeMultiplier(10));
  const t1 = await state(() => window.__stores.drones.getState().simTime);
  await (await page.$('[data-testid="tab-scenariusz"]')).click();
  await sleep(1200);
  const t2 = await state(() => window.__stores.drones.getState().simTime);
  await (await page.$('[data-testid="tab-misja"]')).click();
  check('zegar misji działa po zmianie zakładki', t2 - t1 > 5, `+${(t2 - t1).toFixed(1)} s symulacji`);
  check('przetwarzanie w Web Workerze kończy się', await waitFor('s.processing.status === "done"', 90000), await mission('s.processing.message'));
  if (await mission('s.phase === "scouting"')) await clickText('Przyspiesz');
  check('po wylądowaniu: faza analizy, wszystkie hot spoty odsłonięte', await waitFor('s.phase === "analysis" && s.revealed.length === s.hotspots.length', 20000));
  const nHot = await mission('s.hotspots.length');
  const nCand = await mission('s.hotspots.filter(h => h.radarCandidate).length');
  const nSites = await mission('s.landingSites.length');
  check('hot spoty z fuzji', nHot > 2 && nCand > 0, `${nHot} hot spotów, ${nCand} do radaru, ${nSites} lądowisk`);
  check('każdy hot spot = potencjalne miejsce osoby (termowizja + mikrofon)', await mission('s.hotspots.every(h => h.kind === "fused" && h.label === "Potencjalne miejsce osoby" && h.thermalNote.startsWith("Termowizja") && h.acousticNote.startsWith("Mikrofon"))'));
  check('hot spot z obiema składowymi > 40%', await mission('s.hotspots.some(h => h.evidence.thermal > 0.25 && h.evidence.acoustic > 0.4)'));
  const med = await mission('(() => { const d = s.landingSites.map(l => l.horizontal).sort((a,b)=>a-b); return d[Math.floor(d.length/2)]; })()');
  const nProbe = await mission('s.landingSites.filter(l => l.method === "probe").length');
  check('punkty pomiaru blisko hot spotów (mediana w poziomie ≤ 2,6 m)', med <= 2.6, `mediana ${med.toFixed(2)} m, w tym ${nProbe} punktów sondy (wariant T)`);
  await sleep(1500);
  const cards = await page.$$('[data-testid="hotspot-card"]');
  check('zakładka Hot spoty pokazuje karty', cards.length > 0, `${cards.length} kart`);
  const txt = await page.evaluate(() => document.querySelector('[data-testid="hotspots-panel"]').innerText);
  check('karty pokazują termowizję i mikrofon, bez „ognia”', /Termowizja/.test(txt) && /Mikrofon/.test(txt) && !/ogień|Ogień|pożar/.test(txt));
  if (cards.length) { await cards[0].click(); await sleep(800); }
  await page.screenshot({ path: `${OUT}/03-hotspoty.png` });

  // --- czujnik chmury na mapie: lidar / RGB-D / oba
  const counts = await mission('({ count: s.scan.count, nLidar: s.scan.nLidar })');
  check('chmura obszaru: lidar + kamera RGB-D', counts.nLidar > 100000 && counts.count - counts.nLidar > 100000, `lidar ${counts.nLidar}, RGB-D ${counts.count - counts.nLidar}`);
  const mapRange = () => page.evaluate(() => { const r = window.__map.getLayer('scan-3d').implementation.points.geometry.drawRange; return [r.start, r.count]; });
  await (await page.$('[data-testid="map-source-lidar"]')).click();
  await sleep(1200);
  const rl = await mapRange();
  await page.screenshot({ path: `${OUT}/03a-mapa-lidar.png` });
  await (await page.$('[data-testid="map-source-rgbd"]')).click();
  await sleep(1200);
  const rr = await mapRange();
  await page.screenshot({ path: `${OUT}/03b-mapa-rgbd.png` });
  await (await page.$('[data-testid="map-source-both"]')).click();
  await sleep(300);
  const rb = await mapRange();
  check('mapa: przełącznik czujnika (lidar / RGB-D / oba)', rl[0] === 0 && rl[1] === counts.nLidar && rr[0] === counts.nLidar && rr[1] === counts.count - counts.nLidar && rb[0] === 0 && rb[1] >= counts.count, `lidar ${rl.join('+')}, RGB-D ${rr.join('+')}`);

  // --- widok 3D
  await (await page.$('[data-testid="open-viewer"]')).click();
  await page.waitForSelector('[data-testid="viewer"]');
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/04-3d-rgb.png` });
  const viewerRange = () => page.evaluate(() => { const r = window.__viewer.cloud.geometry.drawRange; return [r.start, r.count]; });
  await (await page.$('[data-testid="viewer-source-rgbd"]')).click();
  await sleep(1500);
  const vr = await viewerRange();
  await page.screenshot({ path: `${OUT}/04a-3d-tylko-rgbd.png` });
  await (await page.$('[data-testid="viewer-source-lidar"]')).click();
  await sleep(1500);
  const vl = await viewerRange();
  await page.screenshot({ path: `${OUT}/04b-3d-tylko-lidar.png` });
  await (await page.$('[data-testid="viewer-source-both"]')).click();
  await sleep(500);
  check('podgląd 3D: przełącznik czujnika (lidar / RGB-D / oba)', vr[0] === counts.nLidar && vr[1] === counts.count - counts.nLidar && vl[0] === 0 && vl[1] === counts.nLidar, `RGB-D ${vr.join('+')}, lidar ${vl.join('+')}`);
  await (await page.$('[data-testid="color-thermal"]')).click();
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/05-3d-termo.png` });
  const cloudPts = await state(() => window.__viewer?.cloud?.geometry.getAttribute('position').count ?? 0);
  check('wizualizator 3D: chmura punktów z misji', cloudPts > 100000, `${cloudPts} punktów`);
  await (await page.$('[data-testid="close-viewer"]')).click();
  await sleep(300);

  // --- scenariusz: zasypana osoba przy najlepszym hot spocie termicznym (1,4 m pod powierzchnią)
  // hot spot na gruzie (nie na koronie muru), z ≥ 3 lądowiskami
  // hot spot, którego lądowiska są w zasięgu radaru od osoby 1 m pod powierzchnią
  const target = await mission('(() => { const ok = h => s.landingSites.filter(l => l.hotspotId === h.id && Math.hypot(l.position[0]-h.position[0], l.position[1]-h.position[1], l.position[2]-(h.position[2]-1)) <= 2.6).length >= 3; const h = s.hotspots.filter(h => h.radarCandidate && ok(h)).sort((a,b)=>b.confidence-a.confidence)[0]; const sites = s.landingSites.filter(l => l.hotspotId === h.id); return { id: h.id, x: h.position[0], y: h.position[1], z: h.position[2], sites: sites.length }; })()');
  await (await page.$('[data-testid="tab-scenariusz"]')).click();
  await sleep(300);
  const VDEPTH = 1.0;
  await page.evaluate(d => window.__stores.mission.getState().setVictimDepth(d), VDEPTH);
  await clickText('Dodaj (kliknij na mapie)');
  const [vlng, vlat] = await page.evaluate(([x, y]) => { const a = window.__stores.mission.getState().anchor; const R = 6371008.8 * Math.PI / 180; return [a.lon0 + x / (R * Math.cos(a.lat0 * Math.PI / 180)), a.lat0 + y / R]; }, [target.x, target.y]);
  await page.evaluate(([lng, lat]) => window.__map.jumpTo({ center: [lng, lat], zoom: 19 }), [vlng, vlat]);
  await sleep(500);
  { const [x, y] = await lngLatToScreen(vlng, vlat); await page.mouse.click(x, y); }
  await sleep(400);
  check('dodano zasypaną osobę w scenariuszu', await mission('s.simVictims.some(v => v.source === "operator")'), `przy ${target.id} (pow. ${target.z.toFixed(1)} m, ${target.sites} lądowisk)`);

  // --- faza 2
  await (await page.$('[data-testid="tab-misja"]')).click();
  await page.evaluate(() => window.__stores.drones.getState().setTimeMultiplier(60));
  await (await page.$('[data-testid="launch-radar"]')).click();
  check('start fazy 2', await waitFor('s.phase === "radar"', 5000), `${await mission('s.radarQueue.length')} punktów w kolejce`);
  await sleep(4000);
  const airborne = await state(() => window.__stores.drones.getState().drones.filter(d => d.role === 'radar' && d.status !== 'base').length);
  check('drony radarowe w akcji', airborne >= 3, `${airborne} aktywnych`);
  // sterowanie pojedynczymi dronami: wyłączenie R-4 i zawrócenie R-3 w trakcie zadania
  await (await page.$('[data-testid="enable-radar-4"]')).click();
  check('wyłączenie pojedynczego drona', await state(() => !window.__stores.drones.getState().drones.find(d => d.id === 'radar-4').enabled));
  const r3task = await state(() => window.__stores.drones.getState().drones.find(d => d.id === 'radar-3').taskSiteId);
  const recall = await page.$('[data-testid="recall-radar-3"]');
  if (recall) {
    await recall.click();
    await sleep(200);
    const r3 = await state(() => { const d = window.__stores.drones.getState().drones.find(x => x.id === 'radar-3'); return { status: d.status, task: d.taskSiteId, enabled: d.enabled }; });
    const back = r3task ? await mission(`s.radarQueue.includes("${r3task}") || s.measurements.some(m => m.siteId === "${r3task}")`) : true;
    check('zawrócenie drona: wraca do bazy, zadanie wraca do kolejki', !r3.enabled && r3.task === null && ['returning', 'takeoff', 'base'].includes(r3.status) && back, `${r3.status}, punkt ${r3task}`);
  } else check('zawrócenie drona', false, 'brak przycisku');
  await (await page.$('[data-testid="tab-hotspoty"]')).click();
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/06-radar.png` });
  await (await page.$('[data-testid="tab-misja"]')).click();
  await sleep(200);
  for (const id of ['radar-3', 'radar-4']) await (await page.$(`[data-testid="enable-${id}"]`)).click();
  check('ponowne włączenie dronów', await state(() => window.__stores.drones.getState().drones.filter(d => d.role === 'radar').every(d => d.enabled)));
  check('faza 2 kończy się', await waitFor('s.phase === "complete"', 240000, 500), `${await mission('s.measurements.length')} pomiarów`);
  const victim = await mission('s.simVictims.find(v => v.source === "operator")');
  const det = await mission(`(() => { const v = s.simVictims.find(v => v.source === "operator"); return s.detections.filter(d => d.vital).map(d => ({ ...d, dh: Math.hypot(d.local[0] - v.position[0], d.local[1] - v.position[1]) })).sort((a, b) => a.dh - b.dh)[0]; })()`);
  const dbg = await mission(`(() => { const v = s.simVictims.find(v => v.source === "operator"); return JSON.stringify({ v: v.position.map(x => +x.toFixed(2)), m: s.measurements.map(m => ({ s: m.siteId, slant: m.truthSlant && +Math.hypot(m.sitePos[0]-v.position[0], m.sitePos[1]-v.position[1], m.sitePos[2]-v.position[2]).toFixed(2), snr: +m.snrDb.toFixed(1), det: m.detection.detected })).filter(x => x.slant < 5) }); })()`);
  check('radar wykrył oznaki życia przy osobie ze scenariusza', !!det && det.dh < 3, det ? `${det.hotspotId}: ${det.note}` : 'brak wpisu ' + dbg);
  check('lokalizacja 3D (≥ 3 punkty, w razie potrzeby po dogęszczeniu)', !!det?.estimate);
  if (det?.estimate) {
    check(`przedział głębokości zawiera prawdziwe ${VDEPTH} m`, det.estimate.depthMin - 0.15 <= VDEPTH && det.estimate.depthMax + 0.15 >= VDEPTH, `${det.estimate.depthMin.toFixed(2)}–${det.estimate.depthMax.toFixed(2)} m`);
    check('błąd położenia poziomego < 1 m', det.dh < 1, `${det.dh.toFixed(2)} m (deklarowane ±${det.estimate.horizontalErr.toFixed(2)} m)`);
  }
  void victim;
  // fałszywy alarm = detektor zgłosił oddech, choć w zasięgu nie było nikogo
  const fa = await mission('s.measurements.filter(m => m.detection.detected && !m.truthVictimId).length');
  const tot = await mission('s.measurements.length');
  check('fałszywe alarmy detektora', fa === 0, `${fa}/${tot} pomiarów`);
  await sleep(1000);
  const dcards = await page.$$('[data-testid="detection-card"]');
  check('zakładka Wykrycia', dcards.length > 0, `${dcards.length} wyników`);
  const confirm = await page.$('[data-testid="confirm"]');
  if (confirm) { await confirm.click(); await sleep(300); }
  check('zatwierdzenie przez ratownika', await mission('s.detections.some(d => d.status === "confirmed")'));
  await clickText('Pokaż pomiary radaru');
  await sleep(800);
  await page.screenshot({ path: `${OUT}/07-wykrycia.png` });
  await page.evaluate(([lng, lat]) => window.__map.jumpTo({ center: [lng, lat], zoom: 18.6 }), [vlng, vlat]);
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/08-mapa-wyniki.png` });
  await page.evaluate(id => window.__stores.mission.getState().openViewer(id), target.id);
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/09-3d-radar.png` });
  await (await page.$('[data-testid="close-viewer"]')).click();

  // --- tryb demonstracyjny: obszar gdzie indziej (dane przeniesione)
  await page.evaluate(() => { const s = window.__stores.mission.getState(); s.resetMission(false); });
  await (await page.$('[data-testid="tab-misja"]')).click();
  await page.evaluate(() => window.__map.jumpTo({ center: [19.9450, 50.0647], zoom: 17 }));
  await sleep(800);
  await clickText('Prostokąt');
  { const [x1, y1] = at(0.4, 0.35); await page.mouse.click(x1, y1); await sleep(150); const [x2, y2] = at(0.6, 0.55); await page.mouse.click(x2, y2); }
  await sleep(300);
  await (await page.$('[data-testid="launch-scout"]')).click();
  check('obszar w innym mieście: tryb demonstracyjny (zakotwiczenie)', await waitFor('s.anchor && s.anchor.mode === "anchored"', 10000));
  check('przetwarzanie w trybie demonstracyjnym', await waitFor('s.processing.status === "done"', 90000));
  if (await mission('s.phase === "scouting"')) await clickText('Przyspiesz');
  check('hot spoty w wybranym obszarze', await waitFor('s.phase === "analysis" && s.hotspots.length > 0', 20000));
  const krak = await page.evaluate(() => { const s = window.__stores.mission.getState(); const h = s.hotspots[0]; const R = 6371008.8 * Math.PI / 180; const a = s.anchor; return [a.lon0 + h.position[0] / (R * Math.cos(a.lat0 * Math.PI / 180)), a.lat0 + h.position[1] / R]; });
  check('hot spoty leżą w Krakowie (w wybranym obszarze)', Math.abs(krak[0] - 19.945) < 0.002 && Math.abs(krak[1] - 50.0647) < 0.002, krak.map(v => v.toFixed(5)).join(', '));
  await (await page.$('[data-testid="tab-scenariusz"]')).click();
  await sleep(200);
  const nv0 = await mission('s.simVictims.length');
  await (await page.$('[data-testid="victims-at-hotspots"]')).click();
  check('scenariusz: osoby pod najsilniejszymi hot spotami', (await mission('s.simVictims.length')) === nv0 + 2);
  await (await page.$('[data-testid="tab-misja"]')).click();

  // --- obszar blisko miejsca z symulacji, ale go nie obejmujący → dron leci nad NARYSOWANY obszar
  await page.evaluate(() => { const s = window.__stores.mission.getState(); s.resetMission(false); });
  await page.evaluate(() => window.__map.jumpTo({ center: [21.0152, 52.2310], zoom: 17.5, pitch: 0 }));
  await sleep(800);
  await clickText('Prostokąt');
  { const [x1, y1] = at(0.42, 0.4); await page.mouse.click(x1, y1); await sleep(150); const [x2, y2] = at(0.58, 0.56); await page.mouse.click(x2, y2); }
  await sleep(300);
  await page.evaluate(() => window.__stores.drones.getState().setTimeMultiplier(4));
  await (await page.$('[data-testid="launch-scout"]')).click();
  await waitFor('s.phase === "scouting"', 10000);
  await sleep(3000);
  const near = await page.evaluate(() => {
    const s = window.__stores.mission.getState(); const d = window.__stores.drones.getState().drones.find(x => x.id === 'scout-1');
    const R = 6371008.8 * Math.PI / 180; const a = s.anchor;
    const lng = a.lon0 + d.pos[0] / (R * Math.cos(a.lat0 * Math.PI / 180)), lat = a.lat0 + d.pos[1] / R;
    const ring = s.areas.find(x => x.id === s.activeAreaId).feature.geometry.coordinates[0];
    const cx = ring.slice(0, -1).reduce((q, p) => q + p[0], 0) / (ring.length - 1), cy = ring.slice(0, -1).reduce((q, p) => q + p[1], 0) / (ring.length - 1);
    return { dist: Math.hypot((lng - cx) * 68000, (lat - cy) * 111000), mode: s.anchor.mode };
  });
  check('obszar 250 m od miejsca z symulacji: dron leci nad narysowany obszar', near.dist < 60 && near.mode === 'anchored', `${near.dist.toFixed(0)} m od środka obszaru, tryb ${near.mode}`);
  await page.screenshot({ path: `${OUT}/12-inny-obszar.png` });
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/10-demo-krakow.png` });

  // --- dotychczasowe funkcje: warstwa GeoJSON i plik PLY w wizualizatorze
  const geoInput = await page.$('input[type="file"][accept=".geojson,.json,.kml,.gpx"]');
  await geoInput.uploadFile('Warm and Welcoming Spaces December 2025.geojson');
  await sleep(1500);
  const layerOk = await page.evaluate(() => { const l = window.__stores.map.getState().layers.find(x => x.type === 'geojson'); return !!l && !!window.__map.getSource(l.id) && !!window.__map.getLayer(l.id + '-circle'); });
  check('wgranie warstwy GeoJSON', layerOk);
  await page.evaluate(() => window.__stores.mission.getState().openViewer());
  await page.waitForSelector('[data-testid="viewer"]');
  const plyInput = await page.$('[data-testid="viewer"] input[type="file"]');
  await plyInput.uploadFile('dane_z_symulacji/point_cloud_map.ply');
  await page.waitForFunction(() => window.__viewer?.cloud?.geometry.getAttribute('position').count === 1282590, { timeout: 30000 }).catch(() => {});
  check('wczytanie pliku PLY w wizualizatorze', await state(() => window.__viewer?.cloud?.geometry.getAttribute('position').count === 1282590));
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/11-plik-ply.png` });
  await (await page.$('[data-testid="close-viewer"]')).click();
} catch (e) {
  check('wyjątek w teście', false, e.message);
  await page.screenshot({ path: `${OUT}/blad.png` }).catch(() => {});
}

check('brak błędów w konsoli', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} OK`);
process.exit(failed.length ? 1 : 0);
