// Liga a corrida à tela, aos controles do Quest (volante, manete e gatilhos), ao teclado/controle
// no PC e aos menus.
import * as THREE from '../vendor/three/three.module.js';
import { TRACKS } from './tracks.js';
import { Race, GATE_PENALTY } from './race.js';
import { DT, PHYS } from './boat.js';
import { LEVELS } from './ai.js';
import { buildWorld, disposeGroup, makeBoat, makeVignette, Wakes, BOAT } from './scene.js';
import { waveHeight, waveSlope } from './waves.js';
import { Hud, Banner } from './hud.js';
import { Panel, Label } from './ui.js';
import { Sfx } from './audio.js';
import { loadSave, storeSave } from './save.js';
import { clamp, lerp, fmtTime, wrapAngle } from './util.js';

const save = loadSave();
const sfx = new Sfx();
const WHEEL_MAX = 1.6;         // giro máximo do volante (rad), ~90°
const LEVER_FWD = 0.85, LEVER_BACK = 0.45;   // curso da manete (rad): frente = acelera, trás = ré
const BOB_VR = 0.015;          // balanço máximo da lancha do jogador no VR (m)

// ---------- Render e cena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation?.(1);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1700);
scene.add(camera);
const seat = new THREE.Group();      // cabeça do piloto, presa à lancha do jogador (só gira no eixo vertical)
scene.add(seat);
const rig = new THREE.Group();       // espaço do VR (ajustado pelo "recentralizar")
seat.add(rig);

const panel = new Panel(1.1);
panel.onShow = () => { banner.mesh.visible = false; };
const banner = new Banner();
const vignette = makeVignette();
const fpsLabel = new Label(0.14);
fpsLabel.mesh.visible = false;
let hud = new Hud(null);
document.getElementById('hudbox').appendChild(hud.canvas);
const wakes = new Wakes(6);
scene.add(wakes.mesh);

// ---------- Estado ----------
let app = 'menu';          // 'menu' | 'playing' | 'paused' | 'result'
let screen = 'main';
let optionsBack = 'main';
let trackIndex = 0;
let levelIndex = clamp(save.level ?? 1, 0, LEVELS.length - 1);
let race = null;
let world = null;
let boatModels = [];
let lastResult = null;
let time = 0;

// ---------- Circuito ----------
function loadTrack(i) {
  trackIndex = i;
  const def = TRACKS[i];
  if (world) { scene.remove(world.group); disposeGroup(world.group); }
  race = new Race({ trackDef: def, level: LEVELS[levelIndex], onEvent, seed: (Date.now() & 0xffff) + 1 });
  world = buildWorld(race.track, def.theme);
  scene.add(world.group);
  scene.background = world.background;
  scene.fog = world.fog;
  wakes.mesh.material.color.set(def.theme.foam);
  wakes.reset();
  if (!boatModels.length) {
    boatModels = race.boats.map((k, idx) => makeBoat(k.color, { player: idx === 0 }));
    for (const m of boatModels) scene.add(m.group);
    // tela no painel da lancha do jogador
    hud.mesh.position.set(-0.43, 0.9, -0.5);
    hud.mesh.rotation.set(-0.75, 0.25, 0, 'YXZ');
    hud.mesh.scale.setScalar(0.85);
    boatModels[0].body.add(hud.mesh);
  }
  hud.setTrack(race.track);
  lever.angle = 0;
  seatY = null;
  syncBoats(0);
}

// ---------- VR: controles ----------
const hands = { left: null, right: null };
const ctrls = [];
const handGeo = new THREE.SphereGeometry(0.035, 12, 10);
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  rig.add(ctrl); rig.add(grip);
  const laser = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0x4fd1e8 }));
  laser.scale.z = 2; laser.visible = false;
  ctrl.add(laser);
  const glove = new THREE.Mesh(handGeo, new THREE.MeshLambertMaterial({ color: 0x2a2a30 }));
  glove.visible = false;
  scene.add(glove);
  const entry = { ctrl, grip, laser, glove, source: null, hand: null, prev: [], hoverIndex: -1, held: null, a0: 0, w0: 0 };
  ctrls.push(entry);
  ctrl.addEventListener('connected', (e) => {
    entry.source = e.data; entry.hand = e.data.handedness;
    if (entry.hand === 'left' || entry.hand === 'right') hands[entry.hand] = entry;
  });
  ctrl.addEventListener('disconnected', () => {
    if (entry.hand && hands[entry.hand] === entry) hands[entry.hand] = null;
    entry.source = null; entry.hand = null; entry.held = null;
  });
  ctrl.addEventListener('selectstart', () => onSelect(entry));
}

function pulse(handName, v, ms) {
  try { hands[handName]?.source?.gamepad?.hapticActuators?.[0]?.pulse?.(v, ms); } catch { /* sem vibração */ }
}
function pulseBoth(v, ms) { pulse('left', v, ms); pulse('right', v, ms); }

function recenter() {
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  rig.rotation.set(0, -e.y, 0);
  const head = camera.position.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -e.y);
  rig.position.set(-head.x, -head.y, -head.z);
}
let recenterIn = 0;
renderer.xr.addEventListener('sessionstart', () => {
  rig.add(camera);
  camera.add(vignette);
  camera.add(fpsLabel.mesh);
  fpsLabel.mesh.position.set(0.12, -0.12, -0.5);
  recenterIn = 5;
  placeOverlays();
  updateHint();
});
renderer.xr.addEventListener('sessionend', () => {
  scene.add(camera);
  camera.remove(vignette);
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0);
  for (const e of ctrls) { e.held = null; e.glove.visible = false; }
  camera.fov = 70; camera.updateProjectionMatrix();
  placeOverlays();
  updateHint();
});

// Painel do menu e letreiro: presos ao assento no VR, presos à câmera no PC.
function placeOverlays() {
  if (renderer.xr.isPresenting) {
    seat.add(panel.mesh); panel.mesh.position.set(0, 0.0, -1.05); panel.mesh.rotation.set(0, 0, 0);
    seat.add(banner.mesh); banner.mesh.position.set(0, 0.5, -3.2); banner.mesh.scale.setScalar(1);
  } else {
    camera.add(panel.mesh); panel.mesh.position.set(0, 0, -1.25); panel.mesh.rotation.set(0, 0, 0);
    camera.add(banner.mesh); banner.mesh.position.set(0, 0.32, -2.2); banner.mesh.scale.setScalar(0.8);
  }
}

// ---------- Volante e manete ----------
const wheel = { angle: 0, grabbed: false };
const lever = { angle: 0, held: false };     // a manete fica onde a mão soltou, como a de verdade
const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

function updateHands(dt, stickSteer) {
  const m = boatModels[0];
  const piv = m.wheelPivot;
  piv.updateWorldMatrix(true, false);
  m.lever.updateWorldMatrix(true, false);
  let sum = 0, n = 0;
  lever.held = false;
  for (const e of ctrls) {
    const gp = e.source?.gamepad;
    if (!gp) { e.glove.visible = false; continue; }
    e.grip.getWorldPosition(tmpV);
    const world = tmpV.clone();
    const gripOn = !!gp.buttons[1]?.pressed;
    const canPlay = app === 'playing' || app === 'paused';
    const pressedNow = gripOn && !e.gripWas;
    e.gripWas = gripOn;
    // posição da mão no plano do volante
    tmpW.copy(world); piv.worldToLocal(tmpW);
    const r = Math.hypot(tmpW.x, tmpW.y), a = Math.atan2(tmpW.y, tmpW.x);
    // posição da mão em relação à base da manete (no espaço da lancha)
    tmpV.copy(world); m.body.worldToLocal(tmpV);
    const ly = tmpV.y - BOAT.leverY, lz = tmpV.z - BOAT.leverZ, lx = tmpV.x - BOAT.leverX;
    const knobY = Math.cos(lever.angle) * 0.25, knobZ = -Math.sin(lever.angle) * 0.25;
    const nearLever = Math.hypot(lx, ly - knobY, lz - knobZ) < 0.13;
    if (pressedNow && !e.held && canPlay && !panel.visible) {
      if (Math.abs(r - BOAT.wheelR) < 0.12 && Math.abs(tmpW.z) < 0.14) { e.held = 'wheel'; e.a0 = a; e.w0 = wheel.angle; pulse(e.hand, 0.3, 30); }
      else if (nearLever) { e.held = 'lever'; pulse(e.hand, 0.3, 30); }
    }
    if (!gripOn) e.held = null;
    if (e.held === 'wheel') {
      sum += e.w0 + wrapAngle(a - e.a0); n++;
      tmpV.set(Math.cos(a) * BOAT.wheelR, Math.sin(a) * BOAT.wheelR, 0);
      piv.localToWorld(tmpV);
      e.glove.position.copy(tmpV);
    } else if (e.held === 'lever') {
      lever.held = true;
      const ang = clamp(Math.atan2(-lz, Math.max(0.02, ly)), -LEVER_BACK, LEVER_FWD);
      if (Math.abs(ang - lever.angle) > 0.12) pulse(e.hand, 0.1, 10);
      lever.angle = ang;
      tmpV.set(BOAT.leverX, BOAT.leverY + Math.cos(ang) * 0.25, BOAT.leverZ - Math.sin(ang) * 0.25);
      m.body.localToWorld(tmpV);
      e.glove.position.copy(tmpV);
    } else e.glove.position.copy(world);
    e.glove.visible = true;
  }
  wheel.grabbed = n > 0;
  if (wheel.grabbed) wheel.angle = clamp(sum / n, -WHEEL_MAX, WHEEL_MAX);
  else {
    const target = -stickSteer * WHEEL_MAX;
    wheel.angle += clamp(target - wheel.angle, -dt * 8, dt * 8);
  }
  m.wheelRim.rotation.z = wheel.angle;
  return -wheel.angle / WHEEL_MAX;
}

// ---------- Teclado e controle (PC) ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  if (!keys.has(e.code)) {
    if ((e.code === 'Space' || e.code === 'KeyH') && app === 'playing') sfx.horn();
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
    if (e.code === 'KeyC') { save.view = save.view === 'chase' ? 'cockpit' : 'chase'; storeSave(save); }
    if (e.code === 'KeyF') { save.fps = !save.fps; storeSave(save); }
  }
  keys.add(e.code);
  sfx.unlock();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
const padPrev = [];

function readDesktopInput() {
  const k = (c) => keys.has(c);
  let throttle = (k('ArrowUp') || k('KeyW')) ? 1 : 0;
  let brake = (k('ArrowDown') || k('KeyS')) ? 1 : 0;
  let steer = ((k('ArrowRight') || k('KeyD')) ? 1 : 0) - ((k('ArrowLeft') || k('KeyA')) ? 1 : 0);
  for (const gp of navigator.getGamepads?.() || []) {
    if (!gp || gp.mapping !== 'standard') continue;
    throttle = Math.max(throttle, gp.buttons[7]?.value || 0, gp.buttons[0]?.pressed ? 1 : 0);
    brake = Math.max(brake, gp.buttons[6]?.value || 0);
    const ax = gp.axes[0] || 0;
    if (Math.abs(ax) > 0.12) steer = ax;
    if (gp.buttons[2]?.pressed && !padPrev[2] && app === 'playing') sfx.horn();
    if (gp.buttons[9]?.pressed && !padPrev[9]) togglePause();
    gp.buttons.forEach((b, i) => { padPrev[i] = b.pressed; });
  }
  return { throttle, brake, steer };
}

function readVRInput(dt) {
  const R = hands.right?.source?.gamepad, Lg = hands.left?.source?.gamepad;
  let stick = 0;
  for (const gp of [Lg, R]) {
    const ax = gp?.axes?.[2] || 0;
    if (Math.abs(ax) > Math.abs(stick)) stick = ax;
  }
  if (Math.abs(stick) < 0.12) stick = 0;
  const steer = updateHands(dt, stick);
  const lv = lever.angle;
  const throttle = Math.max(R?.buttons[0]?.value || 0, lv > 0.05 ? lv / LEVER_FWD : 0);
  const brake = Math.max(Lg?.buttons[0]?.value || 0, lv < -0.05 ? -lv / LEVER_BACK : 0);
  return { throttle, brake, steer };
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Mouse (menu no PC) ----------
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
function setMouse(e) { mouse.set(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); }
renderer.domElement.addEventListener('pointermove', setMouse);
renderer.domElement.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  setMouse(e);
  if (!panel.visible) return;
  raycaster.setFromCamera(mouse, camera);
  doAction(panel.actionAt(panel.pick(raycaster.intersectObject(panel.mesh)[0]?.uv)));
});

// ---------- Corrida ----------
function startRace(ti = trackIndex, li = levelIndex) {
  levelIndex = li;
  save.level = li; storeSave(save);
  loadTrack(ti);
  app = 'playing';
  panel.hide();
  hud.last = '';
  updateHint();
}

function onEvent(type, d) {
  const mine = d.boat === 0;
  switch (type) {
    case 'count': banner.show(String(d.n), '', 0.9); sfx.beep(false); pulseBoth(0.2, 60); break;
    case 'go': banner.show('VAI!', '', 1.0, '#6fe08a'); sfx.beep(true); pulseBoth(0.6, 120); break;
    case 'lap':
      if (!mine) break;
      banner.show(d.final ? 'Última volta!' : `Volta ${d.lap}`, fmtTime(d.time), 1.8);
      sfx.lap(d.final);
      break;
    case 'finish':
      if (!mine) break;
      banner.show('Chegada!', d.penalty ? `${fmtTime(d.time)} + ${d.penalty} s de penalidade` : fmtTime(d.time), 3, '#ffd23a');
      sfx.fanfare(d.pos <= 3);
      if (d.pos <= 3) sfx.cheer();
      break;
    case 'gate': if (mine) { sfx.gate(); pulse('right', 0.2, 30); } break;
    case 'miss':
      if (mine) { sfx.miss(); banner.show('Portal perdido!', `+${GATE_PENALTY} s de penalidade`, 1.6, '#ff8a6a'); pulseBoth(0.5, 200); }
      break;
    case 'log':
      if (mine) { sfx.log(); banner.show('Pancada!', d.type === 'boia' ? 'Bateu numa boia solta' : 'Bateu num tronco', 1.2, '#ff8a6a'); pulseBoth(0.9, 250); }
      else { const k = race.boats[d.boat]; if (dist2(k) < 900) sfx.log(panOf(k)); }
      break;
    case 'wall': if (mine) { sfx.bump(d.power); pulseBoth(Math.min(1, d.power * 0.15), 80); } break;
    case 'bump': if (d.boat === 0 || d.other === 0) { sfx.bump(d.power * 0.7); pulseBoth(0.4, 60); } break;
    case 'jump': if (mine) sfx.jump(); break;
    case 'land': if (mine) { sfx.splash(d.power); pulseBoth(Math.min(1, d.power * 0.12), 120); } break;
    case 'over': {
      const def = TRACKS[trackIndex], lv = LEVELS[levelIndex];
      const b = save.best[def.id] || {};
      const rec = { time: b.time == null || d.total < b.time, lap: b.lap == null || d.bestLap < b.lap };
      save.best[def.id] = { time: rec.time ? d.total : b.time, lap: rec.lap ? d.bestLap : b.lap };
      const key = `${def.id}:${lv.id}`;
      save.podium[key] = Math.min(save.podium[key] || 99, d.pos);
      storeSave(save);
      lastResult = { ...d, rec, track: trackIndex, level: levelIndex };
      setTimeout(() => { if (app === 'playing' && race?.state === 'done') { app = 'result'; showScreen('result'); } }, 1500);
      break;
    }
  }
}
function dist2(k) { const p = race.player; return (k.x - p.x) ** 2 + (k.z - p.z) ** 2; }
function panOf(k) {
  const p = race.player, dx = k.x - p.x, dz = k.z - p.z;
  return clamp((Math.cos(p.h) * dx - Math.sin(p.h) * dz) / 15, -1, 1);   // lado direito da lancha: (cos h, -sen h)
}

function togglePause() {
  if (app === 'playing' && race?.state !== 'done') { app = 'paused'; showScreen('pause'); }
  else if (app === 'paused' && screen === 'pause') { app = 'playing'; panel.hide(); updateHint(); }
}

// ---------- Telas do menu ----------
const PW = 1024;
function showScreen(name) { screen = name; panel.show((p) => SCREENS[name](p)); updateHint(); }
const PODIUM = ['', '🥇', '🥈', '🥉'];

const SCREENS = {
  main(p) {
    p.title('Lanchas no Rio', 56);
    p.text('3 voltas contra 5 lanchas. Passe entre as boias: portal perdido = +2 s.', PW / 2, 104, { size: 26, color: '#a2b8c2' });
    TRACKS.forEach((t, i) => {
      const b = save.best[t.id];
      const medal = PODIUM[save.podium[`${t.id}:${LEVELS[levelIndex].id}`]] || '';
      p.row(132 + i * 100, {
        num: i + 1, name: t.name, style: ['Fácil', 'Difícil', 'Média'][i], desc: t.desc,
        status: 'open', action: 'race:' + i, color: '#' + t.theme.accent.toString(16).padStart(6, '0'),
        tag: `${medal} ${b?.time ? fmtTime(b.time) : 'Correr ▶'}`,
      });
    });
    p.text('Rivais:', 60, 470, { size: 30, bold: true, align: 'left' });
    LEVELS.forEach((lv, i) => p.button(lv.name, 'level:' + i, 230 + i * 200, 436, 186, 68, { on: i === levelIndex, size: 30 }));
    const vr = renderer.xr.isPresenting;
    p.text(vr ? 'Gatilho direito acelera, esquerdo reduz e dá ré. Segure o volante ou a manete com o botão lateral.'
      : 'Setas ou WASD para pilotar, C troca a câmera, H buzina. No Quest, use "Entrar em VR".', PW / 2, 548, { size: 21, color: '#a2b8c2' });
    p.button('Opções', 'options', PW / 2 - 150, 590, 300, 74);
  },
  options(p) {
    p.title('Opções', 58);
    const line = (y, label, items, current, key) => {
      p.text(label, 50, y + 34, { size: 30, align: 'left', bold: true });
      const x0 = 470, w = (PW - 50 - x0 - (items.length - 1) * 10) / items.length;
      items.forEach(([val, txt], i) => p.button(txt, `set:${key}:${val}`, x0 + i * (w + 10), y, w, 68, { on: String(current) === String(val), size: 28 }));
    };
    line(120, 'Conforto no VR', [[1, 'Ligado'], [0, 'Desligado']], save.comfort ? 1 : 0, 'comfort');
    p.text('Escurece as bordas da visão nas curvas, derrapagens e saltos (ajuda contra enjoo).', PW / 2, 214, { size: 21, color: '#a2b8c2' });
    line(250, 'Balanço no VR', [[1, 'Ligado'], [0, 'Desligado']], save.bob ? 1 : 0, 'bob');
    p.text('Sobe e desce no máximo 1,5 cm com as ondas, sem inclinar a visão.', PW / 2, 344, { size: 21, color: '#a2b8c2' });
    line(380, 'Câmera no PC', [['chase', 'Atrás'], ['cockpit', 'Cabine']], save.view, 'view');
    line(470, 'Mostrar FPS', [[1, 'Sim'], [0, 'Não']], save.fps ? 1 : 0, 'fps');
    p.button('Voltar', 'back', PW / 2 - 150, 600, 300, 76, { on: true });
  },
  pause(p) {
    p.title('Pausa', 64);
    const pl = race.player;
    p.text(`${TRACKS[trackIndex].name} · ${pl.pos}º lugar · volta ${Math.min(race.laps, pl.lap + 1)}/${race.laps}${pl.penalty ? ` · +${pl.penalty} s` : ''}`, PW / 2, 124, { size: 30 });
    const vr = renderer.xr.isPresenting;
    const items = [['Continuar', 'resume'], ...(vr ? [['Recentralizar', 'recenter']] : []), ['Reiniciar corrida', 'restart'], ['Opções', 'options'], ['Sair para o menu', 'quit']];
    items.forEach(([t, a], i) => p.button(t, a, PW / 2 - 230, 168 + i * 100, 460, 82, { on: i === 0 }));
  },
  result(p) {
    const r = lastResult, t = TRACKS[r.track];
    p.title(r.pos === 1 ? 'Vitória!' : `${r.pos}º lugar`, 52);
    p.text(`${t.name} · ${LEVELS[r.level].name} · melhor volta ${fmtTime(r.bestLap)}`, PW / 2, 96, { size: 24, color: '#a2b8c2' });
    p.text(r.penalty ? `Seu tempo ${fmtTime(r.time)} + ${r.penalty} s (${r.missed} portal${r.missed > 1 ? 'is' : ''} perdido${r.missed > 1 ? 's' : ''}) = ${fmtTime(r.total)}`
      : `Seu tempo ${fmtTime(r.time)}, sem penalidade`, PW / 2, 128, { size: 26, bold: true, color: r.penalty ? '#ff9a7a' : '#7fe0a0' });
    const recs = [r.rec.time && 'novo recorde do circuito', r.rec.lap && 'nova volta mais rápida'].filter(Boolean);
    if (recs.length) p.text('★ ' + recs.join(' e ') + '!', PW / 2, 160, { size: 24, color: '#ffd23a', bold: true });
    const X = 90;
    p.text('Tempo', 620, 190, { size: 20, align: 'right', color: '#a2b8c2' });
    p.text('Penal.', 750, 190, { size: 20, align: 'right', color: '#a2b8c2' });
    p.text('Total', 920, 190, { size: 20, align: 'right', color: '#a2b8c2' });
    r.results.forEach((x, i) => {
      const Y = 222 + i * 40;
      const me = x.index === 0, c = me ? '#ffd23a' : '#f2f8fa';
      p.text(`${i + 1}º`, X, Y, { size: 28, bold: true, align: 'left', color: c });
      p.ctx.fillStyle = '#' + x.color.toString(16).padStart(6, '0'); p.ctx.fillRect(X + 56, Y - 13, 14, 26);
      p.text(x.name, X + 84, Y, { size: 26, bold: me, align: 'left', color: c });
      p.text(x.estimated ? '—' : fmtTime(x.time), 620, Y, { size: 24, align: 'right', color: '#a2b8c2' });
      p.text(x.penalty ? `+${x.penalty} s` : '—', 750, Y, { size: 24, align: 'right', color: x.penalty ? '#ff9a7a' : '#a2b8c2' });
      p.text(x.estimated ? `~${fmtTime(x.total)}` : fmtTime(x.total), 920, Y, { size: 24, align: 'right', bold: me, color: c });
    });
    const btns = [];
    if (r.track < TRACKS.length - 1) btns.push([`Próximo: ${TRACKS[r.track + 1].name.split(' ao ')[0]}`, 'race:' + (r.track + 1)]);
    btns.push(['Correr de novo', 'race:' + r.track]);
    btns.push(['Menu', 'menu']);
    const w = 300, gap = 16, x0 = (PW - (btns.length * w + (btns.length - 1) * gap)) / 2;
    btns.forEach(([tx, a], i) => p.button(tx, a, x0 + i * (w + gap), 482, w, 84, { on: i === 0, size: 28 }));
    p.text(r.penalty ? 'Dica: mire no meio das boias, a seta amarela mostra o próximo portal.' : r.pos <= 3 ? 'Pódio! Tente outro nível de rivais.' : 'Dica: a lancha escorrega de lado; vire antes da curva.', PW / 2, 610, { size: 23, color: '#a2b8c2' });
  },
};

function doAction(a) {
  if (!a) return;
  sfx.unlock();
  sfx.click();
  if (a.startsWith('race:')) { startRace(Number(a.slice(5))); return; }
  if (a.startsWith('level:')) { levelIndex = Number(a.slice(6)); save.level = levelIndex; storeSave(save); showScreen('main'); return; }
  if (a.startsWith('set:')) {
    const [, key, val] = a.split(':');
    if (key === 'comfort') save.comfort = val === '1';
    else if (key === 'bob') save.bob = val === '1';
    else if (key === 'fps') save.fps = val === '1';
    else if (key === 'view') save.view = val;
    storeSave(save);
    showScreen('options');
    return;
  }
  switch (a) {
    case 'options': optionsBack = screen; showScreen('options'); break;
    case 'back': showScreen(optionsBack === 'options' ? 'main' : optionsBack); break;
    case 'menu': case 'quit': goMenu(); break;
    case 'resume': app = 'playing'; panel.hide(); updateHint(); break;
    case 'restart': startRace(trackIndex); break;
    case 'recenter': recenter(); break;
  }
}

function goMenu() {
  app = 'menu';
  loadTrack(trackIndex);
  showScreen('main');
}

function onSelect(entry) {
  sfx.unlock();
  if (panel.visible && entry.hoverIndex >= 0) doAction(panel.actionAt(entry.hoverIndex));
}

function pollVRButtons() {
  for (const e of ctrls) {
    const gp = e.source?.gamepad;
    if (!gp) continue;
    const b = gp.buttons.map(x => x.pressed);
    if (b[5] && !e.prev[5]) togglePause();
    if (b[4] && !e.prev[4] && app === 'playing') sfx.horn();
    e.prev = b;
  }
}

// ---------- Raio do menu ----------
const rayOrigin = new THREE.Vector3(), rayDir = new THREE.Vector3();
function updateMenuRays() {
  const vr = renderer.xr.isPresenting;
  let hover = -1;
  for (const e of ctrls) {
    e.hoverIndex = -1;
    e.laser.visible = vr && panel.visible && !!e.source;
    if (!e.laser.visible) continue;
    e.ctrl.getWorldPosition(rayOrigin);
    e.ctrl.getWorldQuaternion(tmpQ);
    rayDir.set(0, 0, -1).applyQuaternion(tmpQ);
    raycaster.set(rayOrigin, rayDir);
    const hit = raycaster.intersectObject(panel.mesh)[0];
    e.laser.scale.z = hit ? hit.distance : 2;
    e.hoverIndex = panel.pick(hit?.uv);
    if (e.hoverIndex >= 0) hover = e.hoverIndex;
  }
  if (!vr && panel.visible) {
    raycaster.setFromCamera(mouse, camera);
    hover = panel.pick(raycaster.intersectObject(panel.mesh)[0]?.uv);
    renderer.domElement.style.cursor = hover >= 0 && panel.actionAt(hover) ? 'pointer' : 'default';
  } else renderer.domElement.style.cursor = 'default';
  if (panel.visible) panel.setHover(hover);
}

// ---------- Lanchas na tela ----------
let seatY = null;
const waveH = (x, z) => waveHeight(x, z, time);
function syncBoats(dt) {
  const vr = renderer.xr.isPresenting;
  race.boats.forEach((k, i) => {
    const m = boatModels[i];
    const mine = i === 0;
    const onWater = !k.airborne && !k.ramp;
    const sp = Math.hypot(k.vx, k.vz);
    if (mine && vr) {
      // no VR a lancha do jogador não inclina; só sobe e desce bem pouco (opção)
      const bob = save.bob && onWater ? clamp(waveH(k.x, k.z) * 0.2, -BOB_VR, BOB_VR) : 0;
      m.group.position.set(k.x, k.y + bob, k.z);
      m.group.rotation.y = k.h;
      m.body.rotation.set(0, 0, 0);
    } else {
      const wy = onWater ? waveH(k.x, k.z) : 0;
      m.group.position.set(k.x, k.y + wy, k.z);
      m.group.rotation.y = k.h;
      // arfagem e rolagem: ondas + proa levantando ao acelerar + inclinação para dentro da curva
      const [sx, sz] = onWater ? waveSlope(k.x, k.z, time) : [0, 0];
      const slopeFwd = sx * k.fx + sz * k.fz, slopeLeft = sx * k.lx + sz * k.lz;
      const plane = clamp(sp / 8, 0, 1) * clamp(1.6 - sp / 14, 0.35, 1) * 0.07;
      const pitch = k.airborne ? clamp(k.vy * 0.05, -0.25, 0.25) : k.ramp ? Math.atan(k.ramp.h / k.ramp.len) : Math.atan(slopeFwd) * 1.5 + plane;
      const roll = -Math.atan(slopeLeft) * 1.5 + k.steer * clamp(sp / 18, 0, 1) * 0.12;
      m.body.rotation.x = lerp(m.body.rotation.x, pitch, Math.min(1, dt * 8));
      m.body.rotation.z = lerp(m.body.rotation.z, roll, Math.min(1, dt * 6));
    }
    m.motor.rotation.y = k.steer * 0.45;
    if (!mine) m.wheelRim.rotation.z = -k.steer * WHEEL_MAX;
    m.driver.visible = !(mine && (vr || save.view === 'cockpit' || app === 'menu'));
  });
  // manete: a posição da mão (VR) ou o que os gatilhos/teclas mandam
  const p = race.player;
  const m0 = boatModels[0];
  const shown = lever.held || Math.abs(lever.angle) > 0.05 ? lever.angle : (p.throttle * LEVER_FWD - (keyBrake() ? LEVER_BACK : 0));
  m0.lever.rotation.x = lerp(m0.lever.rotation.x, -shown, Math.min(1, dt * 10));
  // assento (cabeça) segue a lancha do jogador, sem inclinar
  if (seatY == null) seatY = p.y;
  seatY = lerp(seatY, p.y, Math.min(1, dt * (p.airborne ? 6 : 14)));
  const bob = vr && save.bob && !p.airborne && !p.ramp ? clamp(waveH(p.x, p.z) * 0.2, -BOB_VR, BOB_VR) : 0;
  const c = Math.cos(p.h), s = Math.sin(p.h);
  // ponto (0, headY, headZ) da lancha girado por h
  seat.position.set(p.x + s * BOAT.headZ, seatY + BOAT.headY + bob, p.z + c * BOAT.headZ);
  seat.rotation.set(0, p.h, 0);
  if (!dt) seatY = p.y;
}
let lastInput = { throttle: 0, brake: 0 };
function keyBrake() { return lastInput.brake > 0.1; }

// Câmera do PC
const chase = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };
function updateDesktopCamera(dt) {
  const p = race.player;
  if (save.view === 'cockpit' || app === 'menu') {
    boatModels[0].body.updateWorldMatrix(true, false);
    tmpV.set(0, BOAT.headY + 0.04, BOAT.headZ);
    boatModels[0].body.localToWorld(tmpV);
    camera.position.copy(tmpV);
    camera.rotation.set(-0.1, p.h, 0, 'YXZ');
    chase.init = false;
    if (app === 'menu') camera.rotation.set(-0.04, p.h, 0, 'YXZ');
    return;
  }
  const back = 8, up = 3;
  const want = tmpV.set(p.x + Math.sin(p.h) * back, p.y + up, p.z + Math.cos(p.h) * back);
  if (!chase.init) { chase.pos.copy(want); chase.init = true; }
  chase.pos.lerp(want, Math.min(1, dt * 4));
  chase.pos.y = Math.max(chase.pos.y, 1.2);
  // não deixa a câmera entrar no barranco/paredão
  const pr = race.track.project(chase.pos.x, chase.pos.z, p.proj.i);
  const lim = race.track.wall - 0.5;
  if (Math.abs(pr.lat) > lim) {
    const push = pr.lat - Math.sign(pr.lat) * lim;
    chase.pos.x -= pr.tz * push; chase.pos.z += pr.tx * push;
  }
  camera.position.copy(chase.pos);
  chase.look.set(p.x - Math.sin(p.h) * 4, p.y + 1.0, p.z - Math.cos(p.h) * 4);
  camera.lookAt(chase.look);
}

// Boias dos portais, troncos e marcador do próximo portal balançando nas ondas.
const tmpO = new THREE.Object3D();
function syncProps() {
  const g = world.gates;
  g.items.forEach((it, i) => {
    const [sx, sz] = waveSlope(it.x, it.z, time);
    tmpO.position.set(it.x, waveH(it.x, it.z) - 0.05, it.z);
    tmpO.rotation.set(-sz * 2.5, it.yaw, sx * 2.5);
    tmpO.scale.set(1, 1, 1);
    tmpO.updateMatrix();
    g.mesh.setMatrixAt(i, tmpO.matrix);
  });
  g.mesh.instanceMatrix.needsUpdate = true;
  const p = race.player, tr = race.track;
  const gt = tr.gates[p.gateN % tr.gates.length];
  g.marker.visible = !!gt && !p.finished && race.state !== 'done' && app !== 'menu';
  if (gt) {
    const q = tr.pointAt(gt.s, gt.lat);
    g.marker.position.set(q.x, 3.4 + Math.sin(time * 3) * 0.25, q.z);
    g.marker.rotation.set(0, Math.atan2(-q.tx, -q.tz), 0);
  }
  const ob = world.obstacles;
  ob.logs.forEach((o, i) => {
    tmpO.position.set(o.x, waveH(o.x, o.z) - 0.12, o.z);
    tmpO.rotation.set(Math.sin(time * 1.3 + o.rot) * 0.06, o.rot, Math.sin(time * 1.1 + o.rot) * 0.05);
    tmpO.updateMatrix(); ob.logMesh.setMatrixAt(i, tmpO.matrix);
  });
  ob.balls.forEach((o, i) => {
    tmpO.position.set(o.x, waveH(o.x, o.z) + 0.1, o.z);
    tmpO.rotation.set(0, o.rot, 0);
    tmpO.updateMatrix(); ob.ballMesh.setMatrixAt(i, tmpO.matrix);
  });
  ob.logMesh.instanceMatrix.needsUpdate = true;
  ob.ballMesh.instanceMatrix.needsUpdate = true;
  for (const m of world.waterMats) m.uniforms.uTime.value = time;
}

// ---------- HTML (PC) ----------
const hintEl = document.getElementById('hint');
const fpsEl = document.getElementById('fps');
const hudBox = document.getElementById('hudbox');
function updateHint() {
  if (renderer.xr.isPresenting) { hintEl.textContent = ''; return; }
  hintEl.textContent = app === 'playing'
    ? 'Setas/WASD pilotam · H buzina · C troca a câmera · Esc pausa'
    : 'Clique nas opções do painel · No Quest, use o botão "Entrar em VR"';
}

const vrBtn = document.getElementById('vr');
async function setupVR() {
  const ok = navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  if (!ok) {
    vrBtn.textContent = window.isSecureContext ? 'VR não disponível neste navegador' : 'VR precisa de HTTPS';
    vrBtn.disabled = true;
    return;
  }
  vrBtn.textContent = 'Entrar em VR';
  vrBtn.disabled = false;
  vrBtn.onclick = async () => {
    sfx.unlock();
    if (renderer.xr.isPresenting) { renderer.xr.getSession()?.end(); return; }
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      await renderer.xr.setSession(session);
      vrBtn.textContent = 'Sair do VR';
      session.addEventListener('end', () => { vrBtn.textContent = 'Entrar em VR'; });
    } catch (err) {
      vrBtn.textContent = 'Erro ao entrar em VR';
      console.error(err);
    }
  };
}
setupVR();

// ---------- Laço principal ----------
let acc = 0, lastT = performance.now();
let fpsFrames = 0, fpsTime = 0;
let vigOp = 0;
const skyPos = new THREE.Vector3();

function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  time += dt;
  const vr = renderer.xr.isPresenting;
  if (recenterIn > 0 && --recenterIn === 0) recenter();
  if (vr) pollVRButtons();

  const inp = vr ? readVRInput(dt) : readDesktopInput();
  lastInput = inp;
  if (!vr) boatModels[0].wheelRim.rotation.z = -race.player.steer * WHEEL_MAX;
  if (app === 'playing' && race) {
    race.robotPlayer = dev.autoplay;
    acc += dt;
    const n = Math.min(12, Math.floor(acc / DT));
    for (let i = 0; i < n; i++) race.step(inp);
    acc -= n * DT;
  } else acc = 0;

  syncBoats(dt);
  syncProps();
  wakes.update(race.boats, time, waveH);
  hud.mesh.visible = vr;
  hud.draw(race);
  banner.update();

  // som do motor e da água
  const p = race.player;
  const racing = app === 'playing';
  const sp = Math.hypot(p.vx, p.vz);
  sfx.motor(racing, sp / PHYS.vmax, race.state === 'race' ? (race.robotPlayer ? p.throttle : inp.throttle) : 0, p.airborne ? 0 : Math.min(1, sp / PHYS.vmax + Math.abs(p.w) * 0.1));

  // conforto: escurece as bordas quando a lancha gira rápido, escorrega de lado ou voa
  const want = vr && save.comfort && app === 'playing'
    ? clamp((Math.abs(p.yawRate) - 0.3) * 0.6 + Math.max(0, Math.abs(p.w) - 1.2) * 0.12 + (p.airborne ? 0.35 : 0), 0, 0.75) : 0;
  vigOp = lerp(vigOp, want, Math.min(1, dt * 8));
  vignette.material.opacity = vigOp;
  vignette.visible = vigOp > 0.01;

  if (!vr) updateDesktopCamera(dt);
  camera.getWorldPosition(skyPos);
  world.sky.position.copy(skyPos);
  hudBox.style.display = !vr && app !== 'menu' ? 'block' : 'none';
  updateMenuRays();

  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 0.5) {
    const f = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0; fpsTime = 0;
    fpsEl.style.display = save.fps && !vr ? 'block' : 'none';
    fpsEl.textContent = `${f} FPS`;
    fpsLabel.mesh.visible = save.fps && vr;
    fpsLabel.set(`${f} FPS`);
  }
  renderer.render(scene, camera);
}

// Para testes no console: lancha.startRace(0); lancha.dev.autoplay = true; lancha.dev.advance(30)
const dev = { autoplay: false };
dev.advance = (sec) => { for (let i = 0; i < sec * 72; i++) { lastT = performance.now() - 1000 / 72; frame(); } };
window.lancha = { get race() { return race; }, get app() { return app; }, save, startRace, doAction, dev, camera, renderer, scene };

placeOverlays();
goMenu();
renderer.setAnimationLoop(frame);
