// Física da lancha em passo fixo. Sem navegador.
// heading h: a lancha olha para (-sen h, -cos h) na água (igual a rotation.y do Three.js).
// steer: -1 (esquerda) .. +1 (direita).
//
// Modelo de água: a velocidade é guardada no mundo (vx, vz). A cada passo ela é decomposta em
// "para frente" (v) e "de lado" (w, positivo = para a esquerda). O motor empurra só para frente;
// a água freia muito a parte lateral, mas não na hora: ao virar, o barco continua indo um pouco
// para onde ia (deriva) e essa deriva some em ~1 s. O leme só funciona com água passando nele,
// então a lancha quase não vira parada.
import { clamp, wrapAngle } from './util.js';

export const DT = 1 / 120;
export const PHYS = {
  vmax: 20,         // m/s (72 km/h)
  acc: 6.5,         // empurrão do motor saindo do zero (diminui perto da máxima)
  brake: 5,         // gatilho esquerdo andando para frente (reduzir)
  reverse: 4,       // velocidade máxima de ré
  revAcc: 2.5,
  drag: 1.0,        // atrito da água constante
  dragQ: 0.0035,    // atrito que cresce com a velocidade ao quadrado
  latDamp: 2.0,     // quanto a deriva lateral some por segundo (1/s)
  latDrag: 0.35,    // quanto a deriva freia a lancha
  grip: 0.6,        // fração do giro do casco que a velocidade acompanha na hora
  alat: 9,         // "aceleração lateral" máxima do leme (define o raio mínimo de curva)
  turnLow: 1.3,     // rad/s de giro em baixa velocidade
  rudderV: 4,       // m/s com que o leme pega todo
  shallowMax: 0.55, // fração da velocidade máxima na faixa rasa
  gravity: 12,
  radius: 1.15,     // para batidas entre lanchas (dois círculos por casco) e na margem
};

// Giro máximo (rad/s) com o leme todo, na velocidade v.
export function yawMaxAt(v) {
  const av = Math.abs(v);
  return Math.min(PHYS.turnLow, PHYS.alat / Math.max(av, 0.1)) * clamp(av / PHYS.rudderV, 0, 1);
}

export class Boat {
  constructor(track, s, lat, opts = {}) {
    this.track = track;
    this.power = opts.power ?? 1;            // multiplica a velocidade máxima
    const p = track.pointAt(s, lat);
    this.x = p.x; this.z = p.z; this.y = 0; this.vy = 0;
    this.h = Math.atan2(-p.tx, -p.tz);
    this.vx = 0; this.vz = 0;
    this.v = 0;              // velocidade para frente (m/s)
    this.w = 0;              // deriva lateral (m/s, positivo = para a esquerda do barco)
    this.steer = 0;
    this.throttle = 0;
    this.airborne = false;
    this.ramp = null;        // rampa em que está subindo
    this.bump = 0;           // s até poder bater de novo num obstáculo
    this.shallow = false;
    this.proj = track.project(this.x, this.z, -1);
    this.s = this.proj.s;
    this.dist = s >= track.length / 2 ? s - track.length : s;   // distância percorrida (negativa no grid)
    this.lastSlopeVy = 0;
    this.yawRate = 0;
    this.events = [];
  }

  get fx() { return -Math.sin(this.h); }
  get fz() { return -Math.cos(this.h); }
  // esquerda do barco: (-cos h, sen h)
  get lx() { return -Math.cos(this.h); }
  get lz() { return Math.sin(this.h); }
  get speedKmh() { return Math.hypot(this.vx, this.vz) * 3.6; }

  step(input) {
    const P = PHYS, dt = DT, tr = this.track;
    let { throttle = 0, brake = 0, steer = 0 } = input;
    if (this.bump > 0) this.bump -= dt;
    this.steer += clamp(steer - this.steer, -4 * dt, 4 * dt);
    this.throttle = throttle;

    // decompõe a velocidade do mundo em frente/lado
    let v = this.vx * this.fx + this.vz * this.fz;
    let w = this.vx * this.lx + this.vz * this.lz;
    const vmax = P.vmax * this.power * (this.shallow ? P.shallowMax : 1);
    if (!this.airborne) {
      // água: atrito para frente (o motor vence o atrito até a velocidade máxima)
      const drag = P.drag + P.dragQ * v * v;
      if (throttle > 0 && v > -0.5 && v < vmax) v += throttle * (P.acc * Math.max(0.1, 1 - v / vmax) + drag) * dt;
      if (brake > 0) {
        if (v > 0.3) v -= P.brake * brake * dt;
        else if (v > -P.reverse) v = Math.max(-P.reverse, v - (P.revAcc + drag) * brake * dt);
      }
      v -= Math.sign(v) * Math.min(Math.abs(v), drag * dt);
      // deriva lateral: some aos poucos e freia o barco
      if (v > vmax) v -= Math.min(v - vmax, (this.shallow ? 8 : 3) * dt);
      const keep = Math.exp(-P.latDamp * dt);
      v -= Math.sign(v) * Math.min(Math.abs(v), Math.abs(w) * P.latDrag * dt);
      w *= keep;
    }

    // Leme: precisa de água passando; giro limitado pela "aceleração lateral".
    const av = Math.abs(v);
    const yawMax = yawMaxAt(av) * (this.airborne ? 0.15 : 1);
    const dh = -this.steer * yawMax * Math.sign(v) * dt;
    // velocidade de volta ao mundo, ainda na direção antiga do barco
    let vx = this.fx * v + this.lx * w, vz = this.fz * v + this.lz * w;
    this.h = wrapAngle(this.h + dh);
    this.yawRate = dh / dt;
    // o casco leva só parte da velocidade junto na curva; o resto vira deriva lateral
    const a = this.airborne ? 0 : dh * P.grip, ca = Math.cos(a), sa = Math.sin(a);
    this.vx = vx * ca + vz * sa;
    this.vz = -vx * sa + vz * ca;
    this.v = this.vx * this.fx + this.vz * this.fz;
    this.w = this.vx * this.lx + this.vz * this.lz;

    const ox = this.x, oz = this.z;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Canal: projeção, faixa rasa e margem
    const pr = tr.project(this.x, this.z, this.proj.i, this.proj);
    this.shallow = Math.abs(pr.lat) > tr.halfWidth + 0.3;
    const lim = tr.wall - P.radius;
    if (Math.abs(pr.lat) > lim) {
      const side = Math.sign(pr.lat), push = pr.lat - side * lim;
      this.x -= pr.tz * push; this.z += pr.tx * push;          // volta para dentro (eixo "esquerda" = (tz, -tx))
      const nx = pr.tz * side, nz = -pr.tx * side;               // normal apontando para a margem
      const into = this.vx * nx + this.vz * nz;                  // velocidade contra a margem
      if (into > 0) {
        // tira a velocidade contra a margem e perde um pouco da que segue junto
        this.vx -= nx * into * 1.15; this.vz -= nz * into * 1.15;
        const sp = Math.hypot(this.vx, this.vz);
        const loss = clamp(1 - into / Math.max(sp + into, 1) * 0.7, 0.3, 1);
        this.vx *= loss; this.vz *= loss;
        // gira a lancha para ficar paralela à margem
        const along = Math.sign(this.fx * pr.tx + this.fz * pr.tz) || 1;
        const ht = Math.atan2(-pr.tx * along, -pr.tz * along);
        this.h = wrapAngle(this.h + wrapAngle(ht - this.h) * 0.4);
        if (into > 1.5) this.events.push({ type: 'wall', power: into });
      }
      tr.project(this.x, this.z, pr.i, pr);
      this.v = this.vx * this.fx + this.vz * this.fz;
      this.w = this.vx * this.lx + this.vz * this.lz;
    }

    // Distância percorrida
    let ds = pr.s - this.s;
    if (ds < -tr.length / 2) ds += tr.length; else if (ds > tr.length / 2) ds -= tr.length;
    this.dist += ds;
    this.s = pr.s;

    // Altura: água ou rampa. Só sobe na rampa quem entra pela frente dela; quem sai pelo lado cai.
    if (this.ramp) {
      const d = tr.wrap(pr.s) - this.ramp.s;
      if (d < -0.5 || d > this.ramp.len || Math.abs(pr.lat - this.ramp.lat) > this.ramp.hw + 0.4) this.ramp = null;
    } else if (!this.airborne) {
      const r = tr.rampAt(pr.s, pr.lat);
      if (r && tr.wrap(pr.s) - r.s < 1.5) this.ramp = r;
    }
    const ground = this.ramp ? tr.heightAt(pr.s, this.ramp.lat) : tr.sampleAt(tr.y, pr.s);
    const along = this.fx * pr.tx + this.fz * pr.tz;
    const slopeVy = this.ramp ? this.v * along * tr.gradeAt(pr.s, this.ramp.lat) : 0;
    if (this.airborne) {
      this.vy -= P.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        if (this.vy < -2) this.events.push({ type: 'land', power: -this.vy });
        this.y = ground; this.airborne = false; this.vy = slopeVy;
      }
    } else {
      const dropOff = this.y - ground > 0.15;
      if (((this.lastSlopeVy - slopeVy) / dt > P.gravity * 1.5 && this.lastSlopeVy > 0.8) || dropOff) {
        this.airborne = true;
        this.vy = Math.max(0, this.lastSlopeVy);
        this.y += this.vy * dt;
        if (!dropOff || this.vy > 0.8) this.events.push({ type: 'jump' });
      } else { this.y = ground; this.vy = slopeVy; }
    }
    this.lastSlopeVy = this.airborne ? 0 : slopeVy;
    this.moved = Math.hypot(this.x - ox, this.z - oz);
  }

  // Bateu num tronco ou numa boia solta: perde velocidade (uma vez por segundo, no máximo).
  hitObstacle() {
    if (this.bump > 0 || this.airborne) return false;
    this.bump = 1.0;
    this.vx *= 0.5; this.vz *= 0.5;
    this.v *= 0.5; this.w *= 0.5;
    return true;
  }
}
