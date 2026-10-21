// Painel de menu flutuante (o mesmo no PC e no VR): desenhado num canvas e mostrado num
// plano 3D. No VR se aponta com o controle; no PC se clica com o mouse.
import * as THREE from '../vendor/three/three.module.js';

const W = 1024, H = 720;
const C = {
  bg: 'rgba(8,22,30,0.95)', edge: '#4fd1e8', text: '#f2f8fa', dim: '#a2b8c2',
  btn: '#1d3542', btnHover: '#2b4d5e', btnOn: '#4fd1e8', btnOnText: '#04202a', lock: '#22303a',
};

export class Panel {
  constructor(width = 1.1) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const height = width * H / W;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }));
    this.mesh.renderOrder = 10;
    this.buttons = [];
    this.hover = -1;
    this.drawFn = null;
  }

  show(drawFn) { this.drawFn = drawFn; this.hover = -1; this.mesh.visible = true; this.redraw(); this.onShow?.(); }
  hide() { this.mesh.visible = false; this.drawFn = null; }
  get visible() { return this.mesh.visible; }

  redraw() {
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    g.fillStyle = C.bg; roundRect(g, 4, 4, W - 8, H - 8, 28); g.fill();
    g.strokeStyle = C.edge; g.lineWidth = 4; g.stroke();
    this.buttons = [];
    this.drawFn?.(this);
    this.tex.needsUpdate = true;
  }

  // Ferramentas de desenho para as telas.
  title(text, y = 70) {
    const g = this.ctx;
    g.fillStyle = C.edge; g.font = 'bold 54px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, W / 2, y);
  }
  text(text, x, y, { size = 32, color = C.text, align = 'center', bold = false } = {}) {
    const g = this.ctx;
    g.fillStyle = color; g.font = `${bold ? 'bold ' : ''}${size}px sans-serif`; g.textAlign = align; g.textBaseline = 'middle';
    g.fillText(text, x, y);
  }
  button(label, action, x, y, w, h, { on = false, locked = false, size = 34, sub = null } = {}) {
    const g = this.ctx;
    const i = this.buttons.length;
    this.buttons.push({ x, y, w, h, action: locked ? null : action });
    g.fillStyle = locked ? C.lock : on ? C.btnOn : (i === this.hover ? C.btnHover : C.btn);
    roundRect(g, x, y, w, h, 16); g.fill();
    if (i === this.hover && !locked) { g.strokeStyle = C.edge; g.lineWidth = 3; g.stroke(); }
    g.fillStyle = on ? C.btnOnText : locked ? C.dim : C.text;
    g.font = `bold ${size}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + w / 2, y + h / 2 - (sub ? 14 : 0));
    if (sub) { g.font = `24px sans-serif`; g.fillStyle = on ? C.btnOnText : C.dim; g.fillText(sub, x + w / 2, y + h / 2 + 20); }
  }
  // Linha de circuito no menu.
  row(y, { num, name, style, desc, status, action, color, tag: customTag = null }) {
    const g = this.ctx;
    const i = this.buttons.length;
    const x = 40, w = W - 80, h = 88;
    const locked = status === 'locked';
    this.buttons.push({ x, y, w, h, action: locked ? null : action });
    g.fillStyle = locked ? 'rgba(40,44,54,0.8)' : (i === this.hover ? C.btnHover : C.btn);
    roundRect(g, x, y, w, h, 14); g.fill();
    if (status === 'next') { g.strokeStyle = C.edge; g.lineWidth = 3; g.stroke(); }
    g.fillStyle = locked ? '#555' : color; g.fillRect(x + 14, y + 14, 10, h - 28);
    this.text(`${num}. ${locked ? '???' : name}`, x + 44, y + 30, { size: 34, bold: true, align: 'left', color: locked ? C.dim : C.text });
    this.text(locked ? 'Vença o anterior para liberar' : `${style} · ${desc}`, x + 44, y + 64, { size: 22, align: 'left', color: C.dim });
    const tag = customTag ?? (status === 'beaten' ? '✔ VENCIDO' : status === 'next' ? '▶ PRÓXIMO' : status === 'locked' ? '🔒' : '');
    this.text(tag, x + w - 24, y + h / 2, { size: 26, bold: true, align: 'right', color: status === 'beaten' ? '#6fcf97' : C.edge });
  }

  // uv do raycast → índice do botão
  pick(uv) {
    if (!uv) return -1;
    const x = uv.x * W, y = (1 - uv.y) * H;
    return this.buttons.findIndex(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  }
  setHover(i) { if (i !== this.hover) { this.hover = i; this.redraw(); } }
  actionAt(i) { return i >= 0 ? this.buttons[i]?.action : null; }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Painel pequeno de texto (FPS, avisos) preso à câmera.
export class Label {
  constructor(width = 0.16, px = 256, py = 64) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = px; this.canvas.height = py;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * py / px),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false }));
    this.mesh.renderOrder = 11;
    this.last = null;
  }
  set(text) {
    if (text === this.last) return;
    this.last = text;
    const g = this.ctx, w = this.canvas.width, h = this.canvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffdf6e'; g.font = `bold ${Math.round(h * 0.55)}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2);
    this.tex.needsUpdate = true;
  }
}
