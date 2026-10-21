// Pilotos do computador: seguem a linha ideal do canal, miram nos portais de boias (com erro
// por nível), desviam de troncos e de quem está à frente. O mesmo piloto (nível "robo", sem
// erro) dirige a lancha do jogador nos testes e depois da chegada. Sem navegador.
import { clamp, wrapAngle } from './util.js';
import { PHYS, yawMaxAt } from './boat.js';

// speed = fração da velocidade possível; wander = quanto erra a linha (m);
// gateErr = erro de mira no portal (m, desvio padrão); dodge = chance de ver o obstáculo a tempo
export const LEVELS = [
  { id: 'facil', name: 'Fácil', desc: 'Pilotos tranquilos', speed: 0.79, wander: 1.8, gateErr: 2.1, dodge: 0.6 },
  { id: 'medio', name: 'Médio', desc: 'Briga de verdade', speed: 0.86, wander: 1.1, gateErr: 1.3, dodge: 0.8 },
  { id: 'dificil', name: 'Difícil', desc: 'Para quem conhece o rio', speed: 0.92, wander: 0.6, gateErr: 0.75, dodge: 0.95 },
];
export const ROBOT = { id: 'robo', speed: 1.0, wander: 0, gateErr: 0, dodge: 1 };

export const DRIVERS = [
  { name: 'Boto Rosa', color: 0xff6aa8 }, { name: 'Tucunaré', color: 0xf2c518 }, { name: 'Jacaré', color: 0x3fae4f },
  { name: 'Piranha', color: 0x8a5ad6 }, { name: 'Ariranha', color: 0xff8a1e },
];

// número com distribuição normal (média 0, desvio 1)
function gauss(rand) { return Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand()); }

export class Driver {
  constructor(level, rand, personal = 0) {
    this.level = level;
    this.rand = rand;
    this.bias = (rand() - 0.5) * 2 * level.wander;     // faixa preferida
    this.phase = rand() * 10;
    this.personal = personal;                          // ±fração de velocidade própria
    this.stuck = 0; this.reverse = 0;
    this.aimGate = -1; this.aimErr = 0;                // erro sorteado para o próximo portal
    this.seen = new Set();                             // obstáculos que ele "viu" nesta passada
    this.blind = new Set();
    this.pass = null;                                  // ultrapassagem em andamento { o, side, until }
    this._p = {};
  }

  // Devolve { throttle, brake, steer }
  control(k, race, t) {
    const tr = race.track, lv = this.level;
    if (this.reverse > 0) {
      this.reverse -= 1 / 120;
      return { throttle: 0, brake: 1, steer: clamp(this.headingTo(k, k.s + 10, 0) * 2, -1, 1) };   // de ré o leme inverte
    }
    const av = Math.abs(k.v);
    if (race.state === 'race' && av < 1.0 && !k.airborne) { this.stuck += 1 / 120; if (this.stuck > 2.0) { this.reverse = 1.4; this.stuck = 0; } }
    else this.stuck = 0;

    const look = 7 + av * 0.55;
    const sT = k.s + look;
    let lat = tr.sampleAt(tr.line, sT) + this.bias + Math.sin(t * 0.35 + this.phase) * lv.wander * 0.6;

    // Portal à frente: mira no centro (com o erro do nível) quando está chegando perto.
    const gi = k.gateN % tr.gates.length;
    const g = tr.gates[gi];
    let dg = g ? g.s - k.s : Infinity;
    if (dg < -tr.length / 2) dg += tr.length;
    let gateW = 0, gateC = 0;
    if (this.aimGate !== k.gateN) { this.aimGate = k.gateN; this.aimErr = gauss(this.rand) * lv.gateErr; }
    const gateC0 = g ? g.lat + this.aimErr : 0;
    if (g && k.gateN < race.laps * tr.gates.length) {
      // o ponto de mira (sT) vai para o centro do portal um pouco antes de chegar nele e fica
      // lá até a lancha passar
      if (dg > -1 && dg < 120) {
        const dT = dg - look;
        const wgt = dT > 0 ? clamp(1 - (dT - 6) / 25, 0, 1) : 1;
        gateC = g.lat + this.aimErr; gateW = wgt;
        lat = lat + (gateC - lat) * wgt;
      }
    }

    // ultrapassa quem está logo à frente e mais devagar, pelo lado com mais espaço; sem espaço,
    // segue atrás sem bater (batida faz perder velocidade)
    const lim = tr.halfWidth - 1.6;
    let follow = Infinity;
    const blockers = [];
    for (const o of race.boats) {
      if (o === k) continue;
      const d = o.dist - k.dist;
      if (d > -2.5 && d < 6 + av * 0.5 && (d < 0.5 || o.v < k.v + 1)) blockers.push(o);
    }
    if (blockers.length) {
      const free = (c) => blockers.every(o => Math.abs(o.proj.lat - c) >= 2.7);
      const gateNear = dg > -1 && dg < 22 + av;
      const ok = (c) => Math.abs(c) <= lim && (!gateNear || Math.abs(c - gateC0) <= g.hw - 1.1);
      // lado escolhido para ultrapassar fica valendo um tempo (senão fica trocando de lado)
      if (this.pass && (this.pass.until < t || !blockers.includes(this.pass.o))) this.pass = null;
      if (this.pass) {
        const c = this.pass.o.proj.lat + this.pass.side * 3.3;
        if (ok(c) && free(c)) { lat = c; this.pass.until = Math.max(this.pass.until, t + 0.5); }
        else this.pass = null;
      }
      if (!this.pass && (!free(lat) || !ok(lat))) {
        let best = null;
        for (const o of blockers) for (const side of [-1, 1]) {
          const c = o.proj.lat + side * 3.3;
          if (ok(c) && free(c) && (best == null || Math.abs(c - lat) < Math.abs(best.c - lat))) best = { c, o, side };
        }
        if (best) { lat = best.c; this.pass = { o: best.o, side: best.side, until: t + 1.5 }; }
        else {
          // sem espaço: segue o barco da frente na mesma faixa, sem bater
          for (const o of blockers) {
            const d = o.dist - k.dist;
            if (d > 0.5 && d < 11 && Math.abs(o.proj.lat - k.proj.lat) < 2.6) follow = Math.min(follow, o.v + 0.2);
          }
        }
      }
      for (const o of blockers) {
        const d = o.dist - k.dist;
        if (d > 0.5 && d < 6 && Math.abs(o.proj.lat - k.proj.lat) < 2.4) follow = Math.min(follow, o.v + 0.5);
      }
    }
    // desvia de troncos e boias soltas (se viu a tempo)
    for (const ob of tr.obstacles) {
      let d = ob.s - k.s; if (d < -tr.length / 2) d += tr.length;
      if (d < 0 || d > 14 + av * 1.4) { this.seen.delete(ob); this.blind.delete(ob); continue; }
      if (!this.seen.has(ob) && !this.blind.has(ob)) (this.rand() < lv.dodge ? this.seen : this.blind).add(ob);
      if (this.seen.has(ob) && Math.abs(ob.lat - lat) < ob.r + 2.2) lat = ob.lat + (lat >= ob.lat ? 1 : -1) * (ob.r + 2.6);
    }
    // perto do portal, ultrapassar e desviar não pode tirar a lancha de dentro dele
    if (gateW > 0) lat += (clamp(lat, gateC - g.hw + 1.1, gateC + g.hw - 1.1) - lat) * gateW;
    lat = clamp(lat, -lim, lim);
    // mira compensando a deriva: usa a direção em que o barco está indo de fato
    const diff = this.courseTo(k, sT, lat);
    // leme de antemão para a curva do canal, mais a correção para o ponto de mira
    const ff = av > 2 ? -tr.sampleAt(tr.lineCurv, k.s + av * 0.3) * k.v / Math.max(0.05, yawMaxAt(k.v)) : 0;
    const steer = clamp(ff * 0.9 - diff * 2.4 + k.yawRate * 0.25, -1, 1);

    // aiPace: ajuste por circuito (no cânion estreito é difícil ultrapassar, então os rivais andam um pouco menos)
    const pace = lv === ROBOT ? 1 : (tr.def.aiPace ?? 1);
    let target = Math.min(tr.sampleAt(tr.profile, k.s + 3), PHYS.vmax) * lv.speed * pace * (1 + this.personal);
    target = Math.min(target * race.catchUp(k), follow);
    const throttle = k.v < target ? 1 : k.v < target + 0.6 ? 0.3 : 0;
    const brake = k.v > target + 2 ? 1 : 0;
    return { throttle, brake, steer };
  }

  // ângulo entre a direção do movimento (ou da proa, se devagar) e o ponto (s, lat)
  courseTo(k, s, lat) {
    const p = k.track.pointAt(s, lat, this._p);
    const ht = Math.atan2(-(p.x - k.x), -(p.z - k.z));
    const sp = Math.hypot(k.vx, k.vz);
    const hc = sp > 3 && k.v > 0 ? Math.atan2(-k.vx, -k.vz) : k.h;
    return wrapAngle(ht - hc);
  }

  headingTo(k, s, lat) {
    const p = k.track.pointAt(s, lat, this._p);
    const ht = Math.atan2(-(p.x - k.x), -(p.z - k.z));
    return wrapAngle(ht - k.h);
  }
}
