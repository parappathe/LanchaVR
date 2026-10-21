// Painel da lancha: posição, volta, tempo, portais e penalidade, velocidade e minimapa.
// Desenhado num canvas; no VR vira uma tela no painel da lancha, no PC o mesmo canvas aparece no
// canto da tela.
import * as THREE from '../vendor/three/three.module.js';
import { fmtTime } from './util.js';

const W = 640, H = 300;

export class Hud {
  constructor(track) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42 * H / W),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true }));
    this.setTrack(track);
    this.last = '';
  }

  setTrack(track) {
    this.track = track;
    if (!track) return;
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (let i = 0; i < track.N; i++) { a = Math.min(a, track.x[i]); b = Math.max(b, track.x[i]); c = Math.min(c, track.z[i]); d = Math.max(d, track.z[i]); }
    const box = 200, sc = (box - 20) / Math.max(b - a, d - c);
    this.map = { x0: W - box - 10 + (box - (b - a) * sc) / 2, y0: 50 + (box - (d - c) * sc) / 2, minX: a, minZ: c, sc };
  }

  mp(x, z) { const m = this.map; return [m.x0 + (x - m.minX) * m.sc, m.y0 + (z - m.minZ) * m.sc]; }

  draw(race) {
    if (!race) return;
    const p = race.player;
    const key = `${p.pos}|${p.lap}|${Math.floor(race.t * 10)}|${p.gateN}|${p.penalty}|${Math.round(p.speedKmh)}`;
    if (key === this.last) return;
    this.last = key;
    const g = this.ctx, tr = race.track;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(10,20,26,0.84)'; rr(g, 2, 2, W - 4, H - 4, 24); g.fill();
    g.strokeStyle = '#4fd1e8'; g.lineWidth = 4; g.stroke();
    g.textBaseline = 'middle';
    // posição
    g.fillStyle = '#ffd23a'; g.font = 'bold 120px sans-serif'; g.textAlign = 'left';
    g.fillText(`${p.pos}º`, 26, 90);
    g.fillStyle = '#c9d6dc'; g.font = 'bold 34px sans-serif';
    g.fillText(`de ${race.boats.length}`, 32, 160);
    // volta e tempo
    const lap = Math.min(race.laps, Math.max(1, p.lap + 1));
    g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif';
    g.fillText(p.finished ? 'Chegada!' : `Volta ${lap}/${race.laps}`, 200, 60);
    g.font = '36px monospace';
    g.fillText(fmtTime(Math.max(0, p.finished ? p.finishTime : race.t)), 200, 110);
    g.fillStyle = '#c9d6dc'; g.font = '26px sans-serif';
    if (p.lapTimes.length) g.fillText(`Melhor volta ${fmtTime(Math.min(...p.lapTimes))}`, 200, 152);
    // velocidade
    g.fillStyle = '#fff'; g.font = 'bold 56px sans-serif';
    g.fillText(`${Math.round(p.speedKmh)}`, 30, 235);
    g.fillStyle = '#c9d6dc'; g.font = '26px sans-serif';
    g.fillText('km/h', 30, 280);
    // portais e penalidade
    g.fillStyle = 'rgba(255,255,255,0.08)'; rr(g, 180, 186, 250, 98, 16); g.fill();
    g.strokeStyle = p.penalty ? '#ff7a5a' : '#4fd1e8'; g.lineWidth = 3; g.stroke();
    const G = tr.gates.length, next = p.gateN % G;
    g.fillStyle = '#fff'; g.font = 'bold 28px sans-serif'; g.textAlign = 'left';
    g.fillText(p.finished ? `Perdidos: ${p.gatesMissed}` : `Portal ${next + 1} de ${G}`, 196, 214);
    g.fillStyle = p.penalty ? '#ff9a7a' : '#7fe0a0'; g.font = 'bold 30px sans-serif';
    g.fillText(p.penalty ? `Penalidade +${p.penalty} s` : 'Sem penalidade', 196, 256);
    // minimapa com os portais
    g.strokeStyle = '#3a6a8a'; g.lineWidth = 10; g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i <= tr.N; i += 4) { const [x, y] = this.mp(tr.x[i % tr.N], tr.z[i % tr.N]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.stroke();
    tr.gates.forEach((gt, i) => {
      const q = tr.pointAt(gt.s, gt.lat), [x, y] = this.mp(q.x, q.z);
      g.fillStyle = i === next && !p.finished ? '#ffd23a' : '#d8e4ea';
      g.beginPath(); g.arc(x, y, i === next ? 6 : 3.5, 0, Math.PI * 2); g.fill();
    });
    const [sx, sy] = this.mp(tr.x[0], tr.z[0]);
    g.fillStyle = '#fff'; g.fillRect(sx - 6, sy - 3, 12, 6);
    for (let i = race.boats.length - 1; i >= 0; i--) {
      const k = race.boats[i];
      const [x, y] = this.mp(k.x, k.z);
      g.fillStyle = '#' + k.color.toString(16).padStart(6, '0');
      g.beginPath(); g.arc(x, y, i === 0 ? 10 : 6, 0, Math.PI * 2); g.fill();
      if (i === 0) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke(); }
    }
    this.tex.needsUpdate = true;
  }
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Mensagem grande (largada, volta final, chegada), num plano à frente do jogador.
export class Banner {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }));
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
    this.until = 0;
    this.text = '';
  }
  show(text, sub = '', secs = 1.5, color = '#ffd23a') {
    const g = this.ctx, w = 1024, h = 256;
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 130px sans-serif';
    g.lineWidth = 14; g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.strokeText(text, w / 2, sub ? 100 : 128);
    g.fillStyle = color; g.fillText(text, w / 2, sub ? 100 : 128);
    if (sub) { g.font = 'bold 46px sans-serif'; g.lineWidth = 8; g.strokeText(sub, w / 2, 205); g.fillStyle = '#fff'; g.fillText(sub, w / 2, 205); }
    this.tex.needsUpdate = true;
    this.mesh.visible = true;
    this.text = text; this.sub = sub; this.color = color;
    this.until = performance.now() + secs * 1000;
  }
  update() { if (this.mesh.visible && performance.now() > this.until) this.mesh.visible = false; }
}
