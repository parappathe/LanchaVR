// Uma corrida: 6 lanchas, largada, voltas, portais de boias (penalidade), troncos, batidas e
// resultado. A lancha 0 é o jogador. Avança em passos fixos (step). Sem navegador.
import { Track } from './track.js';
import { Boat, PHYS, DT } from './boat.js';
import { Driver, LEVELS, ROBOT, DRIVERS } from './ai.js';
import { rng } from './util.js';

export const COUNTDOWN = 3.5;
export const GATE_PENALTY = 2;     // segundos por portal perdido

export class Race {
  constructor({ trackDef, level = LEVELS[1], laps = 3, seed = 1, onEvent = () => {}, robotPlayer = false, opponents = 5 }) {
    this.track = new Track(trackDef);
    this.track.buildProfile({ vmax: PHYS.vmax, alat: PHYS.alat * 0.85, decel: 5 });
    this.level = level;
    this.laps = laps;
    this.rand = rng(seed);
    this.onEvent = onEvent;
    this.robotPlayer = robotPlayer;
    this.t = -COUNTDOWN;
    this.state = 'countdown';
    this.count = 4;
    this.order = [];
    this.results = null;
    this.totalGates = laps * this.track.gates.length;

    // Grid em duas colunas; o jogador larga em último.
    const n = opponents + 1;
    this.boats = [];
    this.drivers = [];
    for (let slot = 0; slot < n; slot++) {
      const row = Math.floor(slot / 2), col = slot % 2;
      const s = this.track.length - 6 - row * 8;
      const lat = col ? -3.2 : 3.2;
      const k = new Boat(this.track, s, lat);
      const who = slot === n - 1 ? 0 : slot + 1;
      k.index = who;
      k.name = who === 0 ? 'Você' : DRIVERS[(who - 1) % DRIVERS.length].name;
      k.color = who === 0 ? 0xe23b3b : DRIVERS[(who - 1) % DRIVERS.length].color;
      k.lap = 0; k.lapStart = 0; k.lapTimes = []; k.finished = false; k.finishTime = null; k.pos = 0;
      k.gateN = 0; k.gatesPassed = 0; k.gatesMissed = 0; k.penalty = 0;
      this.boats[who] = k;
    }
    for (let i = 0; i < n; i++) this.drivers[i] = new Driver(i === 0 ? ROBOT : level, this.rand, i === 0 ? 0 : (this.rand() - 0.5) * 0.04);
    this.player = this.boats[0];
    this.updateOrder();
  }

  emit(type, d = {}) { this.onEvent(type, d); }

  // Ajuste para a corrida não espalhar demais (só para os pilotos do computador).
  catchUp(k) {
    if (k.index === 0) return 1;
    const gap = k.dist - this.player.dist;
    return Math.max(0.97, Math.min(1.03, 1 - gap * 0.0004));
  }

  // Distância (desde a largada) do portal número n (contando as voltas).
  gateDist(n) {
    const G = this.track.gates.length;
    return Math.floor(n / G) * this.track.length + this.track.gates[n % G].s;
  }

  // input do jogador: { throttle, brake, steer }
  step(input = {}) {
    this.t += DT;
    if (this.state === 'countdown') {
      const c = Math.ceil(-this.t);
      if (c < this.count && c >= 1) { this.count = c; this.emit('count', { n: c }); }
      if (this.t >= 0) { this.state = 'race'; this.emit('go'); }
      for (const k of this.boats) k.step({});
      return;
    }
    if (this.state === 'done') return;

    const L = this.track.length;
    for (let i = 0; i < this.boats.length; i++) {
      const k = this.boats[i];
      const human = i === 0 && !this.robotPlayer && !k.finished;
      const inp = human ? input : this.drivers[i].control(k, this, this.t);
      k.step(inp);
      for (const e of k.events) this.emit(e.type, { boat: i, power: e.power });
      k.events.length = 0;

      this.checkGates(k);
      this.checkObstacles(k);

      // Voltas
      const lapsDone = Math.floor(k.dist / L);
      if (lapsDone > k.lap && !k.finished) {
        k.lap = lapsDone;
        if (lapsDone >= 1) { k.lapTimes.push(this.t - k.lapStart); k.lapStart = this.t; }
        if (k.lap >= this.laps) {
          // portais que ficaram para trás sem passar (cortou caminho de ré, por exemplo) contam como perdidos
          while (k.gateN < this.totalGates) this.missGate(k);
          k.finished = true; k.finishTime = this.t;
          this.updateOrder();
          this.emit('finish', { boat: i, pos: k.pos, time: k.finishTime, penalty: k.penalty });
        } else if (lapsDone >= 1) this.emit('lap', { boat: i, lap: k.lap + 1, final: k.lap + 1 === this.laps, time: k.lapTimes.at(-1) });
      }
    }
    this.collide();
    this.updateOrder();

    const p = this.player;
    if (p.finished && (this.boats.every(k => k.finished) || this.t > p.finishTime + 12)) this.finishRace();
  }

  // Passou da linha do próximo portal: dentro das boias conta, fora dá penalidade.
  checkGates(k) {
    if (k.finished || !this.track.gates.length) return;
    while (k.gateN < this.totalGates && k.dist >= this.gateDist(k.gateN)) {
      const g = this.track.gates[k.gateN % this.track.gates.length];
      if (Math.abs(k.proj.lat - g.lat) <= g.hw) {
        k.gateN++; k.gatesPassed++;
        this.emit('gate', { boat: k.index, n: k.gateN });
      } else this.missGate(k);
    }
  }

  missGate(k) {
    k.gateN++; k.gatesMissed++;
    k.penalty += GATE_PENALTY;
    this.emit('miss', { boat: k.index, n: k.gateN, penalty: k.penalty });
  }

  checkObstacles(k) {
    for (const ob of this.track.obstacles) {
      // centro e proa da lancha
      const rr = ob.r + PHYS.radius * 0.7;
      const hit = [0, 1.4].some(e => (k.x + k.fx * e - ob.x) ** 2 + (k.z + k.fz * e - ob.z) ** 2 < rr * rr);
      if (hit && k.hitObstacle()) this.emit('log', { boat: k.index, type: ob.type });
    }
  }

  // Batidas entre lanchas: cada casco é aproximado por dois círculos (proa e popa).
  collide() {
    const ks = this.boats, R = PHYS.radius, R2 = R * 2, OFF = 1.2;
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i], b = ks[j];
      if (Math.abs(a.y - b.y) > 1) continue;
      if ((a.x - b.x) ** 2 + (a.z - b.z) ** 2 > (R2 + 2 * OFF) ** 2) continue;
      let best = null;
      for (const ea of [-OFF, OFF]) for (const eb of [-OFF, OFF]) {
        const ax = a.x + a.fx * ea, az = a.z + a.fz * ea, bx = b.x + b.fx * eb, bz = b.z + b.fz * eb;
        const d = Math.hypot(bx - ax, bz - az);
        if (d < R2 && (!best || d < best.d)) best = { d, dx: bx - ax, dz: bz - az };
      }
      if (!best || best.d < 1e-6) continue;
      const nx = best.dx / best.d, nz = best.dz / best.d, push = (R2 - best.d) / 2;
      a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
      const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (closing > 0) {
        // troca a velocidade na direção da batida (choque meio mole) e quem vem atrás perde um pouco
        const imp = closing * 0.6;
        a.vx -= nx * imp; a.vz -= nz * imp; b.vx += nx * imp; b.vz += nz * imp;
        const behind = a.dist < b.dist ? a : b;
        behind.vx *= 0.94; behind.vz *= 0.94;
        if (closing > 2) this.emit('bump', { boat: i, other: j, power: closing });
      }
    }
  }

  updateOrder() {
    const key = k => k.finished ? 1e9 - k.finishTime : k.dist;
    this.order = this.boats.slice().sort((a, b) => key(b) - key(a));
    this.order.forEach((k, i) => { k.pos = i + 1; });
  }

  // Classificação final: tempo de prova + penalidades.
  finishRace() {
    const L = this.track.length;
    this.results = this.order.map(k => {
      let time = k.finishTime;
      if (!k.finished) {
        const avg = Math.max(5, k.dist / Math.max(1, this.t));
        time = this.t + (this.laps * L - k.dist) / avg;
      }
      return {
        index: k.index, name: k.name, color: k.color, time, penalty: k.penalty, total: time + k.penalty,
        missed: k.gatesMissed, estimated: !k.finished, bestLap: k.lapTimes.length ? Math.min(...k.lapTimes) : null,
      };
    });
    this.results.sort((a, b) => a.total - b.total);
    const playerPos = this.results.findIndex(r => r.index === 0) + 1;
    const me = this.results[playerPos - 1];
    this.state = 'done';
    this.emit('over', { pos: playerPos, results: this.results, time: me.time, penalty: me.penalty, total: me.total, missed: me.missed, bestLap: Math.min(...this.player.lapTimes) });
  }
}
