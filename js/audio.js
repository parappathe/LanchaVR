// Sons sintetizados com Web Audio (sem arquivos). Só tocam depois de um clique/gatilho
// (unlock); os testes automáticos nunca chamam unlock, então ficam mudos.
export class Sfx {
  constructor() { this.ctx = null; this.engine = null; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _out(pan = 0) {
    const c = this.ctx;
    if (!c.createStereoPanner) return this.master;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    return p;
  }

  _tone(freq, dur, vol, pan = 0, type = 'sine', bend = 1, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * bend, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this._out(pan));
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(dur, vol, freq, q, pan = 0, attack = 0.002, type = 'bandpass') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this._out(pan));
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  // Motor de popa do jogador e chiado da água. rpm 0..1, load 0..1 (acelerando),
  // water 0..1 (velocidade na água); on = false silencia.
  motor(on, rpm = 0, load = 0, water = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    if (!this.engine) {
      const o1 = c.createOscillator(), o2 = c.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'square';
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 3;
      const g = c.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
      o1.start(); o2.start();
      const ns = c.createBufferSource(); ns.buffer = this.noise; ns.loop = true;
      const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.6;
      const ng = c.createGain(); ng.gain.value = 0;
      ns.connect(nf); nf.connect(ng); ng.connect(this.master); ns.start();
      this.engine = { o1, o2, f, g, nf, ng };
    }
    const e = this.engine;
    const f0 = 70 + rpm * 190 + load * 25;
    e.o1.frequency.setTargetAtTime(f0, t, 0.08);
    e.o2.frequency.setTargetAtTime(f0 * 0.502, t, 0.08);
    e.f.frequency.setTargetAtTime(600 + rpm * 1600 + load * 700, t, 0.1);
    e.g.gain.setTargetAtTime(on ? 0.04 + load * 0.05 + rpm * 0.03 : 0, t, 0.1);
    e.nf.frequency.setTargetAtTime(500 + water * 900, t, 0.1);
    e.ng.gain.setTargetAtTime(on ? water * 0.14 : 0, t, 0.1);
  }

  click() { this._tone(660, 0.05, 0.2, 0, 'square', 1.2); }
  beep(high = false) { this._tone(high ? 1320 : 660, high ? 0.5 : 0.25, 0.25, 0, 'square'); }
  gate() { this._tone(988, 0.12, 0.14, 0, 'triangle', 1, 0); this._tone(1319, 0.18, 0.14, 0, 'triangle', 1, 0.07); }
  miss() { this._tone(180, 0.35, 0.2, 0, 'sawtooth', 0.8); this._tone(150, 0.35, 0.16, 0, 'square', 0.8, 0.12); }
  log(pan = 0) { this._tone(110, 0.2, 0.4, pan, 'sine', 0.5); this._noise(0.25, 0.3, 400, 1.2, pan); this._noise(0.5, 0.15, 1200, 0.5, pan, 0.02); }
  bump(power = 3, pan = 0) { const v = Math.min(0.5, 0.1 + power * 0.05); this._tone(80, 0.18, v, pan, 'sine', 0.6); this._noise(0.15, v * 0.6, 500, 1, pan); }
  jump() { this._noise(0.4, 0.12, 1500, 0.5, 0, 0.05); }
  splash(power = 4) { this._noise(0.7, Math.min(0.5, 0.12 + power * 0.04), 900, 0.4, 0, 0.01); this._tone(90, 0.2, Math.min(0.4, power * 0.05), 0, 'sine', 0.5); }
  horn() { this._tone(330, 0.6, 0.18, 0, 'square', 1); this._tone(415, 0.6, 0.14, 0, 'square', 1); }
  lap(final = false) { (final ? [784, 988, 1175, 1568] : [784, 1175]).forEach((f, i) => this._tone(f, 0.2, 0.18, 0, 'triangle', 1, i * 0.1)); }
  cheer() { this._noise(1.6, 0.16, 1300, 0.5, -0.3, 0.2); this._noise(1.6, 0.16, 1800, 0.5, 0.3, 0.25); }
  fanfare(win = true) {
    const notes = win ? [523, 659, 784, 1047, 1319] : [392, 349, 311, 262];
    notes.forEach((f, i) => this._tone(f, 0.35, 0.2, 0, 'triangle', 1, i * 0.15));
  }
}
