// Testes automáticos (rodam no Node, sem navegador e sem som): node tests/run.js
import { Track } from '../js/track.js';
import { TRACKS } from '../js/tracks.js';
import { Boat, PHYS, DT } from '../js/boat.js';
import { Race, GATE_PENALTY } from '../js/race.js';
import { LEVELS } from '../js/ai.js';

let fails = 0;
function check(ok, msg) {
  if (ok) console.log('  ok  ' + msg);
  else { fails++; console.log('  FALHOU  ' + msg); }
}

function runRace(opts, maxT = 900) {
  const ev = {};
  const race = new Race({ ...opts, onEvent: (t, d) => { (ev[t] ||= []).push(d); } });
  while (race.state !== 'done' && race.t < maxT) race.step({});
  return { race, ev };
}

const wins = [[], [], []];

for (const def of TRACKS) {
  console.log(`\nCircuito: ${def.name}`);
  const tr = new Track(def);
  tr.buildProfile({ vmax: PHYS.vmax, alat: PHYS.alat * 0.85, decel: 5 });

  // Geometria
  let worst = 0;
  for (let s = 0; s < tr.length; s += 7.3) for (const lat of [-6, 0, 5]) {
    const p = tr.pointAt(s, lat), q = tr.project(p.x, p.z, -1);
    let ds = Math.abs(q.s - s); ds = Math.min(ds, tr.length - ds);
    worst = Math.max(worst, ds, Math.abs(q.lat - lat));
  }
  check(worst < 0.15, `projeção volta ao mesmo ponto (erro máx ${worst.toFixed(3)} m)`);
  let minC = Infinity;
  for (let i = 0; i < tr.N; i += 2) for (let j = i + 2; j < tr.N; j += 2) {
    const along = Math.min(Math.abs(i - j), tr.N - Math.abs(i - j)) * tr.step;
    if (along > 80) minC = Math.min(minC, Math.hypot(tr.x[i] - tr.x[j], tr.z[i] - tr.z[j]));
  }
  check(minC > 2 * tr.wall + 20, `canal não se cruza nem encosta (folga ${minC.toFixed(1)} m)`);
  let minR = Infinity;
  for (let i = 0; i < tr.N; i++) minR = Math.min(minR, 1 / Math.abs(tr.curv[i]));
  check(minR > 14, `curva mais fechada tem raio ${minR.toFixed(1)} m (> 14)`);
  check(tr.length > 950 && tr.length < 1550, `comprimento ${tr.length.toFixed(0)} m`);

  // Portais, rampas e obstáculos bem colocados
  const sep = (a, b) => { let d = Math.abs(a - b); return Math.min(d, tr.length - d); };
  check(tr.gates.every(g => tr.ramps.every(r => sep(g.s, r.s) > 30 && sep(g.s, r.s + r.len) > 30)), `${tr.gates.length} portais longe das rampas`);
  check(tr.gates.every(g => Math.abs(g.lat) + g.hw < tr.halfWidth), 'portais dentro do canal');
  check(tr.obstacles.every(o => tr.gates.every(g => sep(o.s, g.s) > 18) && tr.ramps.every(r => sep(o.s, r.s) > 25)),
    `${tr.obstacles.length} obstáculos longe de portais e rampas`);
  const offLine = Math.min(...tr.obstacles.map(o => Math.abs(o.lat - tr.sampleAt(tr.line, o.s))));
  check(offLine > 2.5, `obstáculos fora da linha ideal (mín ${offLine.toFixed(1)} m)`);

  // Margem: acelerando e virando todo para um lado, a lancha nunca sai do canal
  for (const steer of [-1, 1]) {
    const k = new Boat(tr, 20, 0);
    let out = 0;
    for (let i = 0; i < 120 * 12; i++) {
      k.step({ throttle: 1, steer: i < 240 ? 0 : steer * 0.5 });
      out = Math.max(out, Math.abs(k.proj.lat));
    }
    check(out <= tr.wall - PHYS.radius + 0.01, `margem segura a lancha virando para ${steer < 0 ? 'a esquerda' : 'a direita'} (|lat| máx ${out.toFixed(2)}, margem ${(tr.wall - PHYS.radius).toFixed(2)})`);
  }

  // Volta só conta andando para frente
  {
    const k = new Boat(tr, 3, 0);
    k.h += Math.PI;
    for (let i = 0; i < 120 * 4; i++) k.step({ throttle: 1 });
    check(k.dist < 0 && Math.floor(k.dist / tr.length) <= 0, `andar para trás pela largada não conta volta (dist ${k.dist.toFixed(1)})`);
  }

  // Robô completa a corrida sozinho, sem penalidade; salta nas rampas
  {
    const { race, ev } = runRace({ trackDef: def, level: LEVELS[1], robotPlayer: true, opponents: 0, seed: 3 });
    const p = race.player;
    const limit = race.laps * tr.length / 12;
    check(p.finished && p.finishTime < limit, `robô completa 3 voltas no tempo limite (${p.finishTime?.toFixed(1)} s < ${limit.toFixed(0)} s, melhor volta ${Math.min(...p.lapTimes).toFixed(1)} s)`);
    check(p.penalty === 0 && p.gatesPassed === race.totalGates, `robô passa os ${race.totalGates} portais sem penalidade (perdeu ${p.gatesMissed})`);
    const jumps = (ev.jump || []).filter(e => e.boat === 0).length;
    check(jumps >= tr.ramps.length * 3, `saltos nas rampas: ${jumps} (esperado ≥ ${tr.ramps.length * 3})`);
    const logs = (ev.log || []).filter(e => e.boat === 0).length;
    check(logs === 0, `robô desvia dos troncos e boias soltas (batidas ${logs})`);
  }

  // Níveis: média dos pilotos do computador mais rápida no Difícil
  const avg = [];
  LEVELS.forEach((lv, li) => {
    let sum = 0, n = 0;
    for (const seed of [11, 12, 13]) {
      const { race } = runRace({ trackDef: def, level: lv, robotPlayer: true, seed });
      for (const r of race.results) if (r.index !== 0) { sum += r.total; n++; }
      wins[li].push(race.results.findIndex(r => r.index === 0) + 1);
    }
    avg.push(sum / n);
  });
  check(avg[0] > avg[1] && avg[1] > avg[2], `níveis em ordem: Fácil ${avg[0].toFixed(1)} s > Médio ${avg[1].toFixed(1)} s > Difícil ${avg[2].toFixed(1)} s`);

  // Corrida completa com 6 lanchas
  {
    const { race, ev } = runRace({ trackDef: def, level: LEVELS[0], robotPlayer: true, seed: 7 });
    check(race.state === 'done' && race.results.length === 6, 'corrida de 6 termina com resultado de todos');
    check(new Set(race.results.map(r => r.index)).size === 6, 'resultado sem repetidos');
    const okSum = race.results.every(r => Math.abs(r.total - r.time - r.penalty) < 1e-9 && r.penalty === r.missed * GATE_PENALTY);
    const ordered = race.results.every((r, i) => i === 0 || race.results[i - 1].total <= r.total);
    check(okSum && ordered, 'classificação por tempo + penalidades somadas');
    const pen = race.results.reduce((a, r) => a + r.penalty, 0);
    console.log(`     Fácil: robô chegou em ${ev.over[0].pos}º · penalidades dos rivais ${pen} s · batidas em troncos ${(ev.log || []).length}`);
  }
}

// Física na água
{
  console.log('\nFísica');
  const tr = new Track(TRACKS[0]);
  const k = new Boat(tr, 5, 0);
  let t0 = null;
  for (let i = 0; i < 120 * 20; i++) { k.step({ throttle: 1 }); if (t0 == null && k.v > PHYS.vmax * 0.9) t0 = i * DT; }
  check(t0 > 4 && t0 < 12, `acelera devagar: 90% da máxima em ${t0?.toFixed(1)} s`);
  // em aberto (sem margem por perto) para medir a deriva
  const open = { ...TRACKS[0], width: 400, shallow: 1 };
  const b = new Boat(new Track(open), 5, 0);
  for (let i = 0; i < 120 * 8; i++) b.step({ throttle: 1 });
  let maxW = 0;
  for (let i = 0; i < 120 * 1.5; i++) { b.step({ throttle: 1, steer: 1 }); maxW = Math.max(maxW, Math.abs(b.w)); }
  check(maxW > 0.8, `lancha desliza de lado na curva (deriva máx ${maxW.toFixed(2)} m/s)`);
  for (let i = 0; i < 120 * 2.5; i++) b.step({ throttle: 1, steer: 0 });
  check(Math.abs(b.w) < 0.15, `deriva some na reta (${Math.abs(b.w).toFixed(3)} m/s depois de 2,5 s)`);
  // freia devagar: soltando e puxando o gatilho esquerdo, leva mais de 2 s para parar
  let tStop = 0;
  while (b.v > 0.5 && tStop < 20) { b.step({ brake: 1 }); tStop += DT; }
  check(tStop > 2 && tStop < 8, `freia devagar (parou em ${tStop.toFixed(1)} s)`);
  for (let i = 0; i < 120 * 4; i++) b.step({ brake: 1 });
  check(b.v < -2 && b.v >= -PHYS.reverse - 0.01, `dá ré (${b.v.toFixed(1)} m/s)`);
  // leme quase não vira parado
  const c = new Boat(tr, 5, 0), h0 = c.h;
  for (let i = 0; i < 120; i++) c.step({ steer: 1 });
  check(Math.abs(c.h - h0) < 0.05, `parada, a lancha quase não gira (${Math.abs(c.h - h0).toFixed(3)} rad em 1 s)`);
}

// Portais: perder dá penalidade, passar não dá
{
  console.log('\nPortais');
  const def = TRACKS[0];
  for (const miss of [false, true]) {
    const race = new Race({ trackDef: def, robotPlayer: true, opponents: 0 });
    const g = race.track.gates[0];
    const k = race.player;
    const want = miss ? (g.lat > 0 ? g.lat - g.hw - 3 : g.lat + g.hw + 3) : g.lat;
    // coloca a lancha logo antes do portal, na faixa desejada, andando reto
    race.state = 'race'; race.t = 1;
    const p = race.track.pointAt(g.s - 6, want);
    Object.assign(k, { x: p.x, z: p.z, h: Math.atan2(-p.tx, -p.tz), dist: g.s - 6, s: g.s - 6 });
    k.vx = -Math.sin(k.h) * 12; k.vz = -Math.cos(k.h) * 12;
    race.track.project(k.x, k.z, -1, k.proj);
    race.drivers[0].control = () => ({ throttle: 1, steer: 0 });
    for (let i = 0; i < 120; i++) race.step({});
    if (miss) check(k.penalty === GATE_PENALTY && k.gatesMissed === 1, `passar fora do portal dá +${GATE_PENALTY} s (penalidade ${k.penalty} s)`);
    else check(k.penalty === 0 && k.gatesPassed === 1, 'passar dentro do portal não dá penalidade');
  }
}

// Calibragem: o robô (que pilota perfeito) ganha quase sempre no Fácil e no Médio e briga no Difícil
{
  console.log('\nNíveis (posição do robô em 9 corridas cada)');
  LEVELS.forEach((lv, i) => {
    const w = wins[i], first = w.filter(p => p === 1).length;
    console.log(`     ${lv.name}: ${w.join(' ')}  (venceu ${first}/9)`);
  });
  const f = (i) => wins[i].filter(p => p === 1).length;
  check(f(0) >= 8, 'Fácil: robô vence quase sempre');
  check(f(1) >= 7, 'Médio: robô vence quase sempre');
  const mean = wins[2].reduce((a, b) => a + b, 0) / wins[2].length;
  check(f(2) >= 2 && f(2) <= 8 && mean <= 2.6 && wins[2].every(p => p < 6), `Difícil: robô briga (vence às vezes, posição média ${mean.toFixed(1)}, nunca em último)`);
}

console.log(fails ? `\n${fails} teste(s) falharam` : '\nTudo certo');
process.exit(fails ? 1 : 0);
