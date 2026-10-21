// Monta o mundo 3D de um circuito: céu, água com ondas (no shader), margens (barranco, paredão
// ou pantanal), vegetação, boias dos portais, troncos, rampas, pórtico de largada, as lanchas e
// a esteira de espuma. Materiais simples, instâncias e geometria juntada por material, para
// rodar liso no Quest (sem sombras em tempo real).
import * as THREE from '../vendor/three/three.module.js';
import { rng } from './util.js';
import { WAVES } from './waves.js';

const col = new THREE.Color();
const STEP = 2;            // metros entre "estações" da malha das margens e da água

// ---------- Utilidades ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function instanced(geo, mat, items, place, color) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  m.count = items.length;
  const o = new THREE.Object3D();
  items.forEach((it, i) => {
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
    place(o, it, i); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    if (color) m.setColorAt(i, col.set(color(it, i)));
  });
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  return m;
}

// Junta geometrias (cada uma com sua matriz e cor) numa só, sem índice, com cor por vértice.
function mergeColored(parts) {
  const pos = [], nor = [], cols = [];
  for (const { geo, matrix, color } of parts) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    col.set(color);
    for (let i = 0; i < g.attributes.position.count; i++) cols.push(col.r, col.g, col.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// Ruído suave 1D (para o paredão e o barranco não ficarem retos), periódico na volta.
function smoothNoise(n, seed, rad) {
  const r = rng(seed), raw = Array.from({ length: n }, () => r());
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -rad; k <= rad; k++) s += raw[((i + k) % n + n) % n];
    out[i] = s / (2 * rad + 1);
  }
  let a = Infinity, b = -Infinity;
  for (const v of out) { a = Math.min(a, v); b = Math.max(b, v); }
  for (let i = 0; i < n; i++) out[i] = (out[i] - a) / Math.max(1e-6, b - a);
  return out;
}

// ---------- Estações ao longo do canal ----------
function stationsOf(track) {
  const n = Math.round(track.length / STEP), st = [];
  for (let j = 0; j < n; j++) {
    const s = j * track.length / n;
    const p = track.pointAt(s, 0);
    st.push({ s, x: p.x, z: p.z, lx: p.tz, lz: -p.tx });
  }
  return st;
}

// Quanto a margem de cada lado pode se estender para fora sem invadir outro trecho do canal.
function outerExtents(track, st, maxOut, slope) {
  const sub = [];
  for (let i = 0; i < track.N; i += 4) sub.push(i);
  const res = st.map(() => [0, 0]);
  st.forEach((q, j) => {
    const ci = Math.round(q.s / track.step) % track.N;
    for (const [k, side] of [[0, -1], [1, 1]]) {
      let best = 4;
      for (let D = 4; D <= maxOut; D += 4) {
        const d = track.wall + D + slope;
        const px = q.x + q.lx * d * side, pz = q.z + q.lz * d * side;
        let ok = true;
        for (const i of sub) {
          const along = Math.min(Math.abs(i - ci), track.N - Math.abs(i - ci)) * track.step;
          if (along < 50) continue;
          if (Math.hypot(track.x[i] - px, track.z[i] - pz) < track.wall + 9) { ok = false; break; }
        }
        if (!ok) break;
        best = D;
      }
      res[j][k] = best;
    }
  });
  // suaviza (mínimo dos vizinhos) para a borda não ficar serrilhada
  const n = st.length, out = st.map(() => [0, 0]);
  for (let j = 0; j < n; j++) for (let k = 0; k < 2; k++) {
    let m = Infinity;
    for (let d = -3; d <= 3; d++) m = Math.min(m, res[((j + d) % n + n) % n][k]);
    out[j][k] = m;
  }
  return out;
}

// Malha das margens: para cada estação e lado, um perfil [deslocamento a partir da margem, altura, cor].
function buildBanks(track, st, profile) {
  const pos = [], cols = [];
  const n = st.length;
  const prof = st.map((q, j) => [profile(j, 0, -1), profile(j, 1, 1)]);
  const P = (q, side, off, y) => {
    const d = (track.wall + off) * side;
    return [q.x + q.lx * d, y, q.z + q.lz * d];
  };
  for (let j = 0; j < n; j++) {
    const a = st[j], b = st[(j + 1) % n];
    for (const [k, side] of [[0, -1], [1, 1]]) {
      const pa = prof[j][k], pb = prof[(j + 1) % n][k];
      for (let i = 0; i < pa.length - 1; i++) {
        const v = [P(a, side, pa[i][0], pa[i][1]), P(a, side, pa[i + 1][0], pa[i + 1][1]),
          P(b, side, pb[i][0], pb[i][1]), P(b, side, pb[i + 1][0], pb[i + 1][1])];
        const ca = pa[i][2], cb = pa[i + 1][2];
        // ordem dos vértices para a face ficar virada para cima/para o canal
        const order = side > 0 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2];
        for (const vi of order) {
          pos.push(...v[vi]);
          const c = vi === 0 || vi === 2 ? ca : cb;
          cols.push(c.r, c.g, c.b);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

// ---------- Água ----------
const WATER_VS = `
uniform float uTime;
uniform float uDisp;
attribute float edge;
varying vec3 vWorld;
varying float vEdge;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = 0.0;
${WAVES.slice(0, 2).map(([dx, dz, k, w, a]) => `  h += ${a.toFixed(4)} * sin(dot(wp.xz, vec2(${dx.toFixed(3)}, ${dz.toFixed(3)})) * ${k.toFixed(3)} + uTime * ${w.toFixed(3)});`).join('\n')}
  wp.y += h * uDisp;
  vWorld = wp.xyz;
  vEdge = edge;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FS = `
uniform float uTime;
uniform vec3 uDeep, uShallow, uSky, uHorizon, uSunDir, uSunCol, uFoam;
varying vec3 vWorld;
varying float vEdge;
#include <fog_pars_fragment>
void main() {
  vec2 p = vWorld.xz;
  vec2 g = vec2(0.0);
${WAVES.map(([dx, dz, k, w, a]) => `  g += ${(a * k).toFixed(4)} * cos(dot(p, vec2(${dx.toFixed(3)}, ${dz.toFixed(3)})) * ${k.toFixed(3)} + uTime * ${w.toFixed(3)}) * vec2(${dx.toFixed(3)}, ${dz.toFixed(3)});`).join('\n')}
  // marolinhas finas só na luz
  g += 0.035 * cos(dot(p, vec2(0.6, -0.8)) * 2.3 + uTime * 3.1) * vec2(0.6, -0.8);
  g += 0.025 * cos(dot(p, vec2(-0.9, -0.4)) * 3.4 + uTime * 3.7) * vec2(-0.9, -0.4);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 base = mix(uDeep, uShallow, smoothstep(0.35, 1.0, vEdge));
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uHorizon, uSky, clamp(R.y * 2.5, 0.0, 1.0));
  vec3 c = mix(base, sky, 0.1 + 0.7 * fres);
  float spec = pow(max(dot(R, uSunDir), 0.0), 140.0);
  c += uSunCol * spec * 1.6;
  float foam = smoothstep(0.88, 1.0, vEdge) * (0.55 + 0.45 * sin(p.x * 1.3 + p.y * 1.7 + uTime * 2.0));
  c = mix(c, uFoam, foam * 0.55);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function makeWaterMaterial(th, disp = 1) {
  const sun = new THREE.Vector3(...th.sunDir).normalize();
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uDisp: { value: disp },
      uDeep: { value: new THREE.Color(th.waterDeep) }, uShallow: { value: new THREE.Color(th.waterShallow) },
      uSky: { value: new THREE.Color(th.skyTop) }, uHorizon: { value: new THREE.Color(th.skyHorizon) },
      uSunDir: { value: sun }, uSunCol: { value: new THREE.Color(th.sunGlow) }, uFoam: { value: new THREE.Color(th.foam) },
    }]),
  });
}

function buildWater(track, st, mat) {
  const cols = 8, W = track.wall + 2.5, n = st.length;
  const pos = [], edge = [], idx = [];
  for (let j = 0; j < n; j++) {
    const q = st[j];
    for (let c = 0; c <= cols; c++) {
      const lat = -W + 2 * W * c / cols;
      pos.push(q.x + q.lx * lat, 0, q.z + q.lz * lat);
      edge.push(Math.min(1.2, Math.max(0, (Math.abs(lat) - track.halfWidth * 0.5) / (track.wall - track.halfWidth * 0.5))));
    }
  }
  for (let j = 0; j < n; j++) {
    const a = j * (cols + 1), b = ((j + 1) % n) * (cols + 1);
    for (let c = 0; c < cols; c++) idx.push(a + c, b + c, a + c + 1, a + c + 1, b + c, b + c + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

// ---------- Céu ----------
function buildSky(th) {
  const sun = new THREE.Vector3(...th.sunDir).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(th.skyTop) }, uHor: { value: new THREE.Color(th.skyHorizon) },
      uSun: { value: sun }, uGlow: { value: new THREE.Color(th.sunGlow) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uTop, uHor, uSun, uGlow; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(uHor, uTop, pow(h, 0.55));
        float s = max(dot(d, uSun), 0.0);
        c += uGlow * (pow(s, 6.0) * 0.35 + pow(s, 60.0) * 0.5);
        c = mix(c, uGlow * 1.2, smoothstep(0.9975, 0.999, s));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 12), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

// ---------- Margens por tema ----------
function landRio(track, st, th, out) {
  const n = st.length, nz = smoothNoise(n, 3, 4), nz2 = smoothNoise(n, 8, 2);
  const mud = new THREE.Color(th.bank), grass = new THREE.Color(th.land), far = new THREE.Color(th.landFar);
  const dark = grass.clone().multiplyScalar(0.8), wet = mud.clone().multiplyScalar(0.7);
  return buildBanks(track, st, (j, k) => {
    const o = out[j][k], e = nz[(j + k * 37) % n], e2 = nz2[(j + k * 51) % n];
    return [[-1.6, -0.7, wet], [0.3 + e, 0.25, mud], [1.8 + e * 2, 0.8 + e2 * 0.4, mud], [4 + e * 2, 1.3 + e2 * 0.3, dark],
      [4 + o * 0.5, 1.5 + e * 0.6, grass], [4 + o, 1.4, grass], [4 + o + 18, -1.5, far]];
  });
}

function landCanion(track, st, th, out) {
  const n = st.length;
  const H = smoothNoise(n, 4, 6), a = smoothNoise(n, 5, 1), b = smoothNoise(n, 6, 2), c = smoothNoise(n, 7, 3);
  const rock = new THREE.Color(th.rock), dark = new THREE.Color(th.rockDark), top = new THREE.Color(th.land);
  const band = rock.clone().lerp(new THREE.Color(0xd9a070), 0.35);
  return buildBanks(track, st, (j, k) => {
    const q = (j + k * 41) % n, h = 21 + H[q] * 9;
    return [[-1.2, -1.4, dark], [0.15, -0.3, dark], [0.2 + a[q] * 0.6, 3 + a[q] * 2, rock], [0.8 + b[q] * 1.6, 8 + b[q] * 2, band],
      [1.4 + c[q] * 2.2, 14 + c[q] * 3, rock], [2.4 + a[q] * 2.5, h, band], [4 + out[j][k], h + 1, top], [4 + out[j][k] + 10, 19, top]];
  });
}

function landPantanal(track, st, th, out) {
  const n = st.length, nz = smoothNoise(n, 9, 3);
  const mud = new THREE.Color(th.bank), marsh = new THREE.Color(th.land), far = new THREE.Color(th.landFar);
  return buildBanks(track, st, (j, k) => {
    const o = out[j][k], e = nz[(j + k * 29) % n];
    return [[-1.5, -0.6, mud], [0.5 + e, 0.12, mud], [2.5 + e * 2, 0.32, marsh], [3 + o * 0.6, 0.45, marsh], [3 + o, 0.35, far], [3 + o + 6, -0.6, mud]];
  });
}

// Pontos espalhados em terra firme, entre a margem e "out" metros para fora.
function scatterLand(track, st, out, count, minOff, seed, extra = 0) {
  const r = rng(seed), res = [];
  let tries = 0;
  while (res.length < count && tries++ < count * 20) {
    const j = Math.floor(r() * st.length), k = r() < 0.5 ? 0 : 1, side = k ? 1 : -1;
    const o = out[j][k] + extra;
    if (o <= minOff) continue;
    const off = minOff + r() * (o - minOff);
    const q = st[j], d = (track.wall + off) * side;
    const x = q.x + q.lx * d, z = q.z + q.lz * d;
    const pr = track.project(x, z, -1);
    if (Math.abs(pr.lat) < track.wall + minOff - 0.5) continue;
    res.push({ x, z, r: r(), r2: r(), off });
  }
  return res;
}

// Pontos na faixa rasa do canal (aguapés, pedras na base do paredão).
function scatterShallow(track, count, seed, latFrom, latTo) {
  const r = rng(seed), res = [];
  for (let i = 0; i < count; i++) {
    const s = r() * track.length, side = r() < 0.5 ? -1 : 1;
    const lat = side * (latFrom + r() * (latTo - latFrom));
    const p = track.pointAt(s, lat);
    res.push({ x: p.x, z: p.z, r: r(), r2: r(), s, lat });
  }
  return res;
}

function bounds(track) {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (let i = 0; i < track.N; i++) { a = Math.min(a, track.x[i]); b = Math.max(b, track.x[i]); c = Math.min(c, track.z[i]); d = Math.max(d, track.z[i]); }
  return { minX: a, maxX: b, minZ: c, maxZ: d, cx: (a + b) / 2, cz: (c + d) / 2, size: Math.max(b - a, d - c) };
}

function buildVegetation(track, st, th, out, B, waterMat) {
  const grp = new THREE.Group();
  const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  if (th.kind === 'rio') {
    // mata ciliar: muitas árvores coladas na margem, algumas mais para dentro
    const trees = scatterLand(track, st, out, 330, 3.5, 11).concat(scatterLand(track, st, out, 90, 14, 12));
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 1, 5);
    grp.add(instanced(trunk, lam(0x5a4028), trees, (o, t) => { const h = 3 + t.r * 4; o.position.set(t.x, 1.4 + h / 2, t.z); o.scale.set(1, h, 1); }));
    const crown = new THREE.IcosahedronGeometry(1, 0);
    grp.add(instanced(crown, lam(0xffffff, { flatShading: true }), trees, (o, t) => {
      const h = 3 + t.r * 4, w = 2.2 + t.r2 * 2.4;
      o.position.set(t.x, 1.4 + h + w * 0.5, t.z); o.rotation.set(t.r * 3, t.r2 * 6, 0); o.scale.set(w, w * (0.8 + t.r * 0.5), w);
    }, (t) => th.treeColors[Math.floor(t.r2 * th.treeColors.length)]));
    // juncos na beira d'água
    const reeds = scatterShallow(track, 260, 13, track.wall - 0.6, track.wall + 0.6);
    grp.add(instanced(new THREE.ConeGeometry(0.35, 1.6, 4), lam(0x6a8a3a, { flatShading: true }), reeds,
      (o, t) => { o.position.set(t.x, 0.5, t.z); o.rotation.set((t.r - 0.5) * 0.3, t.r2 * 6, 0); o.scale.setScalar(0.7 + t.r * 0.7); }));
    // morros ao longe
    const hills = [];
    const r = rng(14);
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + r(); hills.push({ x: B.cx + Math.cos(a) * (B.size * 0.5 + 260 + r() * 120), z: B.cz + Math.sin(a) * (B.size * 0.5 + 260 + r() * 120), r: r() }); }
    grp.add(instanced(new THREE.ConeGeometry(1, 1, 9), lam(0x4f7a52, { flatShading: true }), hills,
      (o, t) => { const s = 90 + t.r * 90; o.position.set(t.x, s * 0.18 - 2, t.z); o.scale.set(s, s * 0.4, s); }));
  } else if (th.kind === 'canion') {
    // pedras na base do paredão, meio afundadas
    const rocks = scatterShallow(track, 170, 21, track.wall - 0.4, track.wall + 0.8);
    grp.add(instanced(new THREE.DodecahedronGeometry(1, 0), lam(th.rockDark, { flatShading: true }), rocks,
      (o, t) => { const s = 0.6 + t.r * 1.4; o.position.set(t.x, -0.2 + s * 0.2, t.z); o.rotation.set(t.r * 3, t.r2 * 6, t.r * 2); o.scale.set(s, s * 0.7, s); }));
    // mesas de pedra ao longe
    const mesas = [], r = rng(23);
    for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + r(); mesas.push({ x: B.cx + Math.cos(a) * (B.size * 0.5 + 200 + r() * 160), z: B.cz + Math.sin(a) * (B.size * 0.5 + 200 + r() * 160), r: r() }); }
    grp.add(instanced(new THREE.CylinderGeometry(0.75, 1, 1, 7), lam(th.rock, { flatShading: true }), mesas,
      (o, t) => { const s = 50 + t.r * 70; o.position.set(t.x, 19 + s * 0.45, t.z); o.rotation.y = t.r * 3; o.scale.set(s, s * 0.9, s * (0.7 + t.r * 0.5)); }));
    // planalto em volta (no alto do cânion; visto de baixo não aparece)
    const plat = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), lam(th.landFar));
    plat.rotation.x = -Math.PI / 2; plat.position.set(B.cx, 19.2, B.cz);
    grp.add(plat);
  } else {
    // Pantanal: aguapés na faixa rasa e nas lagoas, capim, ipês e carandás
    const lagoon = [];
    const r = rng(31);
    for (let i = 0; i < 300; i++) {
      const x = B.cx + (r() - 0.5) * (B.size + 300), z = B.cz + (r() - 0.5) * (B.size + 300);
      const pr = track.project(x, z, -1);
      if (Math.abs(pr.lat) > track.wall + 26) lagoon.push({ x, z, r: r(), r2: r(), y: -0.28 });
    }
    const pads = scatterShallow(track, 620, 32, track.halfWidth + 0.4, track.wall + 0.4).map(t => ({ ...t, y: 0.03 }))
      .concat(lagoon);
    const pad = new THREE.CircleGeometry(1, 7); pad.rotateX(-Math.PI / 2);
    grp.add(instanced(pad, lam(0x3f7a2a), pads, (o, t) => { const s = 0.5 + t.r * 0.9; o.position.set(t.x, t.y + 0.06, t.z); o.rotation.y = t.r2 * 6; o.scale.set(s, 1, s * (0.7 + t.r2 * 0.4)); },
      (t) => t.r2 < 0.5 ? 0x3f7a2a : 0x4f8a32));
    const flowers = pads.filter(t => t.r < 0.35);
    grp.add(instanced(new THREE.ConeGeometry(0.16, 0.35, 5), lam(0xb07ae0), flowers, (o, t) => { o.position.set(t.x + 0.2, t.y + 0.25, t.z); }));
    const grass = scatterLand(track, st, out, 420, 1.5, 33);
    grp.add(instanced(new THREE.ConeGeometry(0.4, 1.4, 4), lam(0x7a8a3a, { flatShading: true }), grass,
      (o, t) => { o.position.set(t.x, 0.9, t.z); o.rotation.set((t.r - 0.5) * 0.4, t.r2 * 6, 0); o.scale.setScalar(0.7 + t.r); }));
    const trees = scatterLand(track, st, out, 70, 5, 34);
    const ipe = trees.filter(t => t.r2 < 0.55), palm = trees.filter(t => t.r2 >= 0.55);
    grp.add(instanced(new THREE.CylinderGeometry(0.15, 0.25, 1, 5), lam(0x4a3a2a), trees,
      (o, t) => { const h = t.r2 < 0.55 ? 3 + t.r * 2 : 6 + t.r * 3; o.position.set(t.x, 0.4 + h / 2, t.z); o.scale.set(1, h, 1); }));
    grp.add(instanced(new THREE.IcosahedronGeometry(1, 0), lam(0xffffff, { flatShading: true }), ipe, (o, t) => {
      const h = 3 + t.r * 2, w = 2.2 + t.r * 1.6; o.position.set(t.x, 0.4 + h + w * 0.4, t.z); o.scale.set(w, w * 0.65, w);
    }, (t) => t.r < 0.4 ? 0xe85ab8 : t.r < 0.7 ? 0xf2c518 : th.treeColors[0]));
    const fan = new THREE.ConeGeometry(2.2, 1.0, 7); fan.rotateX(Math.PI);
    grp.add(instanced(fan, lam(0x3a5a2a, { flatShading: true }), palm, (o, t) => { const h = 6 + t.r * 3; o.position.set(t.x, 0.4 + h + 0.2, t.z); o.rotation.y = t.r * 6; }));
    // lagoa em volta (a mesma água, mais baixa e sem ondular a malha)
    const lag = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400, 4, 4), makeWaterMaterial(th, 0));
    lag.rotation.x = -Math.PI / 2; lag.position.set(B.cx, -0.3, B.cz);
    lag.userData.water = true;
    grp.add(lag);
    // ilhas de mata ao longe (silhuetas no pôr do sol)
    const isl = [];
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2 + r(); isl.push({ x: B.cx + Math.cos(a) * (B.size * 0.5 + 180 + r() * 200), z: B.cz + Math.sin(a) * (B.size * 0.5 + 180 + r() * 200), r: r() }); }
    grp.add(instanced(new THREE.IcosahedronGeometry(1, 0), lam(0x2a3420, { flatShading: true }), isl,
      (o, t) => { const s = 18 + t.r * 30; o.position.set(t.x, 0, t.z); o.scale.set(s * 1.6, s * 0.45, s); }));
  }
  return grp;
}

// ---------- Boias, obstáculos, rampas, largada ----------
function buoyGeometry() {
  const parts = [
    { geo: new THREE.CylinderGeometry(0.42, 0.5, 0.9, 8), matrix: M(0, 0.25, 0), color: 0xffffff },
    { geo: new THREE.ConeGeometry(0.42, 0.7, 8), matrix: M(0, 1.05, 0), color: 0xffffff },
    { geo: new THREE.CylinderGeometry(0.04, 0.04, 1.4, 4), matrix: M(0, 1.9, 0), color: 0x333333 },
    { geo: new THREE.BoxGeometry(0.02, 0.35, 0.5), matrix: M(0, 2.4, 0.25), color: 0xffffff },
  ];
  return mergeColored(parts);
}

export function buildGates(track) {
  const geo = buoyGeometry();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const items = [];
  track.gates.forEach((g, gi) => {
    for (const side of [-1, 1]) {
      const p = track.pointAt(g.s, g.lat + side * (g.hw + 0.35));
      items.push({ x: p.x, z: p.z, yaw: Math.atan2(-p.tx, -p.tz), color: side > 0 ? 0x2fbf4f : 0xe23b3b, gi, ph: gi * 1.7 + side });
    }
  });
  const mesh = instanced(geo, mat, items, (o, t) => { o.position.set(t.x, 0, t.z); o.rotation.y = t.yaw; }, (t) => t.color);
  // marcador do próximo portal: seta para baixo, flutuando sobre o centro
  const tri = new THREE.Shape([new THREE.Vector2(-0.9, 0.7), new THREE.Vector2(0.9, 0.7), new THREE.Vector2(0, -0.6)]);
  const marker = new THREE.Mesh(new THREE.ShapeGeometry(tri), new THREE.MeshBasicMaterial({ color: 0xffd23a, side: THREE.DoubleSide, transparent: true, opacity: 0.85, fog: false }));
  return { mesh, items, marker };
}

export function buildObstacles(track) {
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const logs = track.obstacles.filter(o => o.type === 'tronco'), balls = track.obstacles.filter(o => o.type !== 'tronco');
  const logGeo = new THREE.CylinderGeometry(0.32, 0.38, 3.2, 7); logGeo.rotateZ(Math.PI / 2);
  const logMesh = instanced(logGeo, lam(0x5a3e26), logs, () => {});
  const ballMesh = instanced(new THREE.SphereGeometry(0.6, 10, 7), lam(0xff7a1e), balls, () => {});
  return { logs, balls, logMesh, ballMesh };
}

function buildRamp(track, r) {
  const parts = [];
  const len = r.len, hw = r.hw, h = r.h;
  // rampa no sistema local: começa em z = +len/2 (água) e sobe até z = -len/2
  const ang = Math.atan2(h, len), slope = Math.hypot(h, len);
  const stripes = 6;
  for (let i = 0; i < stripes; i++) {
    const f0 = i / stripes, f1 = (i + 1) / stripes, fm = (f0 + f1) / 2;
    const z = len / 2 - fm * len, y = fm * h;
    parts.push({ geo: new THREE.BoxGeometry(hw * 2, 0.08, slope / stripes), matrix: M(0, y + 0.04, z, ang, 0, 0), color: i % 2 ? 0x222222 : 0xf2c518 });
  }
  for (const sx of [-1, 1]) {
    // lateral em triângulo e boias de flutuação (tambores azuis)
    const sh = new THREE.Shape([new THREE.Vector2(-len / 2, 0), new THREE.Vector2(len / 2, 0), new THREE.Vector2(len / 2, h)]);
    const side = new THREE.ShapeGeometry(sh);
    parts.push({ geo: side, matrix: M(sx * hw, 0, 0, 0, Math.PI / 2 * (sx > 0 ? 1 : 1), 0), color: 0xe8e8e8 });
    parts.push({ geo: new THREE.CylinderGeometry(0.4, 0.4, len, 8), matrix: M(sx * (hw - 0.5), 0.05, 0, Math.PI / 2, 0, 0), color: 0x2f6fd6 });
  }
  parts.push({ geo: new THREE.BoxGeometry(hw * 2, h, 0.12), matrix: M(0, h / 2, -len / 2, 0, 0, 0), color: 0xe8e8e8 });
  const g = mergeColored(parts);
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const p = track.pointAt(r.s + len / 2, r.lat);
  mesh.position.set(p.x, -0.05, p.z);
  mesh.rotation.y = Math.atan2(-p.tx, -p.tz);
  return mesh;
}

function startArch(track, th) {
  const grp = new THREE.Group();
  const p = track.pointAt(0, 0);
  const yaw = Math.atan2(-p.tx, -p.tz);
  const W = track.wall + 0.8;
  const tex = canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = '#' + th.accent.toString(16).padStart(6, '0'); g.fillRect(0, 0, w, h);
    for (let i = 0; i < 32; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * w / 32, j * 12 + (j ? h - 24 : 0), w / 32, 12); }
    g.fillStyle = '#fff'; g.font = 'bold 70px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('LANCHAS NO RIO', w / 2, h / 2 + 4);
  });
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push({ geo: new THREE.CylinderGeometry(0.3, 0.4, 8, 6), matrix: M(sx * W, 3.5, 0), color: 0x333a44 });
    parts.push({ geo: new THREE.CylinderGeometry(1.2, 1.2, 0.8, 10), matrix: M(sx * W, -0.1, 0), color: 0xf2f2f2 });
  }
  const posts = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  const ban = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.6, 1.4, 0.3), new THREE.MeshBasicMaterial({ map: tex }));
  ban.position.y = 7.2;
  grp.add(posts, ban);
  grp.position.set(p.x, 0, p.z);
  grp.rotation.y = yaw;
  return grp;
}

// Tudo de um circuito num grupo (trocar de circuito = tirar um grupo e pôr outro).
export function buildWorld(track, th) {
  const group = new THREE.Group();
  group.add(new THREE.HemisphereLight(th.hemiSky, th.hemiGround, th.hemiI));
  const sun = new THREE.DirectionalLight(th.sun, th.sunI);
  sun.position.set(...th.sunDir).multiplyScalar(100);
  group.add(sun);
  const B = bounds(track);
  const st = stationsOf(track);
  const maxOut = th.kind === 'rio' ? 60 : th.kind === 'canion' ? 36 : 20;
  const slope = th.kind === 'rio' ? 22 : th.kind === 'canion' ? 14 : 9;
  const out = outerExtents(track, st, maxOut, slope);

  const waterMat = makeWaterMaterial(th, 1);
  const water = buildWater(track, st, waterMat);
  group.add(water);
  if (th.kind === 'rio') {
    group.add(landRio(track, st, th, out));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshLambertMaterial({ color: th.landFar }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(B.cx, -1.5, B.cz);
    group.add(ground);
  } else if (th.kind === 'canion') group.add(landCanion(track, st, th, out));
  else group.add(landPantanal(track, st, th, out));
  const veg = buildVegetation(track, st, th, out, B, waterMat);
  group.add(veg);
  for (const r of track.ramps) group.add(buildRamp(track, r));
  group.add(startArch(track, th));
  const gates = buildGates(track);
  group.add(gates.mesh, gates.marker);
  const obstacles = buildObstacles(track);
  group.add(obstacles.logMesh, obstacles.ballMesh);
  const sky = buildSky(th);
  group.add(sky);
  const waterMats = [waterMat];
  veg.traverse(o => { if (o.userData.water) waterMats.push(o.material); });
  return {
    group, sky, gates, obstacles, waterMats, bounds: B,
    fog: new THREE.Fog(th.fog, th.fogNear, th.fogFar), background: new THREE.Color(th.fog),
  };
}

export function disposeGroup(g) {
  g.traverse(o => {
    o.geometry?.dispose();
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) { m.map?.dispose(); m.dispose(); }
  });
}

// ---------- Lancha ----------
export const BOAT = { headY: 1.22, headZ: 0.42, wheelY: 0.9, wheelZ: -0.22, wheelR: 0.17, wheelTilt: 0.75, leverX: 0.4, leverY: 0.78, leverZ: -0.05 };

// Casco em V: seções da proa (z negativo) à popa. [z, meia boca, altura do convés, altura da quilha]
const HULL = [[-2.7, 0.02, 0.92, 0.6], [-2.25, 0.5, 0.86, 0.12], [-1.6, 0.86, 0.8, -0.14], [-0.8, 1.0, 0.76, -0.26],
  [0.4, 1.04, 0.74, -0.3], [1.6, 1.02, 0.72, -0.3], [2.4, 0.98, 0.72, -0.28]];

function hullGeometry(color) {
  const pos = [], cols = [];
  const paint = new THREE.Color(color), white = new THREE.Color(0xf4f4f0), bottom = new THREE.Color(0xd8dde2);
  const stripe = new THREE.Color(0x1a1a22), floor = new THREE.Color(0x8a9aa8), inner = new THREE.Color(0xe6e6e0);
  const tri = (a, b, c, cl) => { pos.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) cols.push(cl.r, cl.g, cl.b); };
  const quad = (a, b, c, d, cl) => { tri(a, b, c, cl); tri(a, c, d, cl); };
  const chine = (s) => s[3] + (s[2] - s[3]) * 0.42;
  for (let i = 0; i < HULL.length - 1; i++) {
    const A = HULL[i], Bs = HULL[i + 1];
    for (const sx of [-1, 1]) {
      const dA = [sx * A[1], A[2], A[0]], dB = [sx * Bs[1], Bs[2], Bs[0]];
      const mA = [sx * A[1] * 0.98, chine(A) + 0.14, A[0]], mB = [sx * Bs[1] * 0.98, chine(Bs) + 0.14, Bs[0]];
      const cA = [sx * A[1] * 0.92, chine(A), A[0]], cB = [sx * Bs[1] * 0.92, chine(Bs), Bs[0]];
      const kA = [0, A[3], A[0]], kB = [0, Bs[3], Bs[0]];
      const f = sx > 0 ? (a, b, c, d, cl) => quad(a, b, c, d, cl) : (a, b, c, d, cl) => quad(a, d, c, b, cl);
      f(dA, dB, mB, mA, paint);           // costado pintado
      f(mA, mB, cB, cA, stripe);          // faixa escura
      f(cA, cB, kB, kA, bottom);          // fundo em V
    }
  }
  // espelho de popa
  const S = HULL.at(-1), zS = S[0];
  for (const sx of [-1, 1]) {
    const d = [sx * S[1], S[2], zS], c = [sx * S[1] * 0.92, chine(S), zS], k = [0, S[3], zS], top = [0, S[2], zS];
    if (sx > 0) { tri(top, d, c, white); tri(top, c, k, white); } else { tri(top, c, d, white); tri(top, k, c, white); }
  }
  // convés de proa (até o para-brisa) e plataforma de popa
  const deckEnd = 3;      // índice da seção onde começa o cockpit
  for (let i = 0; i < deckEnd; i++) {
    const A = HULL[i], Bs = HULL[i + 1];
    quad([-A[1], A[2], A[0]], [-Bs[1], Bs[2], Bs[0]], [Bs[1], Bs[2], Bs[0]], [A[1], A[2], A[0]], white);
  }
  // cockpit: bordas brancas, paredes internas e piso
  const zc0 = HULL[deckEnd][0], zc1 = 1.85, yF = 0.28, gw = 0.16;
  for (const sx of [-1, 1]) {
    const w = 1.02;
    const a = [sx * w, 0.74, zc0], b = [sx * w, 0.73, zc1], c = [sx * (w - gw), 0.73, zc1], d = [sx * (w - gw), 0.74, zc0];
    if (sx > 0) quad(a, d, c, b, white); else quad(a, b, c, d, white);
    const e = [sx * (w - gw), yF, zc0], f2 = [sx * (w - gw), yF, zc1];
    if (sx > 0) quad(d, e, f2, c, inner); else quad(d, c, f2, e, inner);
  }
  quad([-(1.02 - gw), yF, zc0], [-(1.02 - gw), yF, zc1], [1.02 - gw, yF, zc1], [1.02 - gw, yF, zc0], floor);
  quad([-(1.02 - gw), 0.74, zc0], [-(1.02 - gw), yF, zc0], [1.02 - gw, yF, zc0], [1.02 - gw, 0.74, zc0], inner);
  quad([-(1.02 - gw), 0.73, zc1], [1.02 - gw, 0.73, zc1], [1.02 - gw, yF, zc1], [-(1.02 - gw), yF, zc1], inner);
  quad([-0.98, 0.72, zc1], [-0.98, 0.72, 2.4], [0.98, 0.72, 2.4], [0.98, 0.72, zc1], white);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

export function makeBoat(color, { player = false } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Group();          // balanço (arfagem/rolagem) mexe aqui
  g.add(body);
  const hull = new THREE.Mesh(hullGeometry(color), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  body.add(hull);
  // peças paradas, juntadas num só objeto com cor por vértice
  const zc0 = HULL[3][0];
  const fixed = [
    { geo: new THREE.BoxGeometry(1.2, 0.42, 0.32), matrix: M(0, 0.5, -0.62), color: 0x2a2e36 },                 // painel
    { geo: new THREE.BoxGeometry(1.2, 0.05, 0.3), matrix: M(0, 0.72, -0.6, 0.35, 0, 0), color: 0x1a1c22 },       // tampo do painel
    { geo: new THREE.BoxGeometry(0.6, 0.12, 0.5), matrix: M(0, 0.4, BOAT.headZ - 0.02), color: 0xf4f4f0 },        // banco
    { geo: new THREE.BoxGeometry(0.6, 0.55, 0.12), matrix: M(0, 0.7, BOAT.headZ + 0.27, -0.12, 0, 0), color: 0xf4f4f0 },
    { geo: new THREE.BoxGeometry(1.6, 0.12, 0.5), matrix: M(0, 0.4, 1.45), color: 0xf4f4f0 },                    // banco de trás
    { geo: new THREE.BoxGeometry(1.6, 0.4, 0.1), matrix: M(0, 0.62, 1.72), color: 0xf4f4f0 },
    { geo: new THREE.BoxGeometry(0.1, 0.06, 0.55), matrix: M(-0.62, 0.8, -1.9), color: 0xb8bcc4 },              // cunho / corrimão
    { geo: new THREE.BoxGeometry(0.1, 0.06, 0.55), matrix: M(0.62, 0.8, -1.9), color: 0xb8bcc4 },
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.18, 6), matrix: M(BOAT.leverX, 0.7, BOAT.leverZ), color: 0x22252c }, // base da manete
  ];
  body.add(new THREE.Mesh(mergeColored(fixed), new THREE.MeshLambertMaterial({ vertexColors: true })));
  // para-brisa baixo, inclinado, meio transparente
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.36), new THREE.MeshLambertMaterial({ color: 0x9ac8e8, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
  glass.position.set(0, 0.88, zc0 + 0.15); glass.rotation.x = -0.75;
  body.add(glass);
  // motor de popa (gira com o leme)
  const motor = new THREE.Group();
  motor.position.set(0, 0.72, 2.45);
  const mparts = [
    { geo: new THREE.BoxGeometry(0.48, 0.55, 0.62), matrix: M(0, 0.3, 0.25), color: 0x1c1e24 },
    { geo: new THREE.BoxGeometry(0.4, 0.08, 0.5), matrix: M(0, 0.6, 0.25), color: color },
    { geo: new THREE.BoxGeometry(0.14, 0.9, 0.2), matrix: M(0, -0.4, 0.3), color: 0x2a2c32 },
    { geo: new THREE.BoxGeometry(0.06, 0.25, 0.32), matrix: M(0, -0.9, 0.36), color: 0x2a2c32 },
  ];
  motor.add(new THREE.Mesh(mergeColored(mparts), new THREE.MeshLambertMaterial({ vertexColors: true })));
  body.add(motor);
  // volante
  const wheelPivot = new THREE.Group();
  wheelPivot.position.set(0, BOAT.wheelY, BOAT.wheelZ);
  wheelPivot.rotation.x = BOAT.wheelTilt;
  body.add(wheelPivot);
  const wheelRim = new THREE.Group(); wheelPivot.add(wheelRim);
  const wparts = [
    { geo: new THREE.TorusGeometry(BOAT.wheelR, 0.02, 6, 20), color: 0xd8d8d8 },
    { geo: new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8), matrix: M(0, 0, 0, Math.PI / 2, 0, 0), color: 0x2a2a30 },
    { geo: new THREE.CylinderGeometry(0.02, 0.02, 0.3, 5), matrix: M(0, 0, -0.15, Math.PI / 2, 0, 0), color: 0x2a2a30 },
    { geo: new THREE.BoxGeometry(0.04, 0.04, 0.03), matrix: M(0, BOAT.wheelR, 0), color: 0xf2c518 },
  ];
  for (const a of [0, Math.PI / 3, Math.PI * 2 / 3, Math.PI, Math.PI * 4 / 3, Math.PI * 5 / 3])
    wparts.push({ geo: new THREE.BoxGeometry(0.015, BOAT.wheelR, 0.015), matrix: M(Math.sin(a) * BOAT.wheelR / 2, -Math.cos(a) * BOAT.wheelR / 2, 0, 0, 0, a), color: 0xb8bcc4 });
  wheelRim.add(new THREE.Mesh(mergeColored(wparts), new THREE.MeshLambertMaterial({ vertexColors: true })));
  // manete (acelerador): alavanca que vai para frente
  const lever = new THREE.Group();
  lever.position.set(BOAT.leverX, BOAT.leverY, BOAT.leverZ);
  const lparts = [
    { geo: new THREE.CylinderGeometry(0.018, 0.018, 0.24, 5), matrix: M(0, 0.12, 0), color: 0xb8bcc4 },
    { geo: new THREE.SphereGeometry(0.045, 8, 6), matrix: M(0, 0.25, 0), color: 0xe23b3b },
  ];
  lever.add(new THREE.Mesh(mergeColored(lparts), new THREE.MeshLambertMaterial({ vertexColors: true })));
  body.add(lever);
  // piloto
  const driver = new THREE.Group();
  const dparts = [
    { geo: new THREE.CapsuleGeometry(0.2, 0.32, 3, 8), matrix: M(0, 0.78, BOAT.headZ + 0.05), color: color },
    { geo: new THREE.SphereGeometry(0.17, 10, 8), matrix: M(0, BOAT.headY, BOAT.headZ), color: 0xf4f4f4 },
    { geo: new THREE.BoxGeometry(0.24, 0.08, 0.06), matrix: M(0, BOAT.headY + 0.02, BOAT.headZ - 0.15), color: 0x1a2a3a },
    { geo: new THREE.CapsuleGeometry(0.055, 0.34, 3, 6), matrix: M(-0.17, 0.88, BOAT.headZ - 0.25, 1.15, 0, 0), color: color },
    { geo: new THREE.CapsuleGeometry(0.055, 0.34, 3, 6), matrix: M(0.17, 0.88, BOAT.headZ - 0.25, 1.15, 0, 0), color: color },
    { geo: new THREE.BoxGeometry(0.35, 0.1, 0.18), matrix: M(0, 0.98, BOAT.headZ + 0.08), color: 0xff8a1e },     // colete salva-vidas
  ];
  driver.add(new THREE.Mesh(mergeColored(dparts), new THREE.MeshLambertMaterial({ vertexColors: true })));
  body.add(driver);
  return { group: g, body, motor, wheelPivot, wheelRim, lever, driver, player };
}

// ---------- Esteira de espuma ----------
// Um rastro de quads atrás de cada lancha, numa malha só (1 chamada de desenho para todas).
export class Wakes {
  constructor(n, foam = 0xffffff) {
    this.n = n; this.P = 26; this.life = 3.2;
    this.trails = Array.from({ length: n }, () => ({ pts: [], lastX: null, lastZ: null }));
    const verts = n * (this.P - 1) * 6;
    this.pos = new Float32Array(verts * 3);
    this.uv = new Float32Array(verts * 2);
    this.col = new Float32Array(verts * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const tex = canvasTex(64, 64, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      gr.addColorStop(0.8, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      const r = rng(4);
      for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.5})`; c.fillRect(r() * w, r() * h, 2 + r() * 4, 2 + r() * 6); }
    });
    tex.wrapT = THREE.RepeatWrapping;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false, color: foam }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  reset() { for (const t of this.trails) { t.pts.length = 0; t.lastX = null; } }

  // boats: lanchas da corrida; waveH(x, z) = altura da onda ali; t = tempo
  update(boats, t, waveH) {
    const { P, life } = this;
    boats.forEach((b, i) => {
      const tr = this.trails[i];
      const sx = b.x - b.fx * 2.3, sz = b.z - b.fz * 2.3;       // popa
      const sp = Math.hypot(b.vx, b.vz);
      if (tr.lastX == null || Math.hypot(sx - tr.lastX, sz - tr.lastZ) > 1.1) {
        tr.pts.unshift({ x: sx, z: sz, lx: b.lx, lz: b.lz, t, k: b.airborne || b.y > 0.2 ? 0 : Math.min(1, sp / 12) });
        if (tr.pts.length > P) tr.pts.pop();
        tr.lastX = sx; tr.lastZ = sz;
      }
    });
    let v = 0;
    const put = (x, y, z, u, w, a) => {
      this.pos[v * 3] = x; this.pos[v * 3 + 1] = y; this.pos[v * 3 + 2] = z;
      this.uv[v * 2] = u; this.uv[v * 2 + 1] = w;
      this.col[v * 4] = 1; this.col[v * 4 + 1] = 1; this.col[v * 4 + 2] = 1; this.col[v * 4 + 3] = a;
      v++;
    };
    for (const tr of this.trails) {
      const pts = tr.pts;
      for (let j = 0; j < P - 1; j++) {
        const a = pts[j], b = pts[j + 1];
        if (!a || !b) { for (let q = 0; q < 6; q++) put(0, -50, 0, 0, 0, 0); continue; }
        const corners = [];
        for (const p of [a, b]) {
          const age = (t - p.t) / life, w = 0.55 + age * 1.8;
          const al = Math.max(0, 1 - age) ** 1.5 * p.k * 0.6;
          const y = waveH(p.x, p.z) + 0.05;
          corners.push([p.x + p.lx * w, y, p.z + p.lz * w, 0, p.t * 0.6, al], [p.x - p.lx * w, y, p.z - p.lz * w, 1, p.t * 0.6, al]);
        }
        for (const q of [0, 2, 1, 1, 2, 3]) { const c = corners[q]; put(c[0], c[1], c[2], c[3], c[4], c[5]); }
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.uv.needsUpdate = true; g.attributes.color.needsUpdate = true;
  }
}

// Escurecimento nas bordas da visão (conforto no VR).
export function makeVignette() {
  const tex = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w * 0.5);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  m.position.z = -0.2;
  m.renderOrder = 20;
  return m;
}
