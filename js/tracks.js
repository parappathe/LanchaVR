// Os 3 circuitos. Pontos [x, z] em metros, no sentido da corrida; a largada fica no primeiro
// ponto; scale aumenta tudo na horizontal. width = largura do canal navegável; shallow = faixa
// rasa antes da margem (reduz a velocidade). ramps = rampas flutuantes de salto (f = onde
// começa, em fração da volta; len = comprimento; h = altura; hw = meia largura). gates = portais
// de boias (fração da volta). obstacles = [fração, lat em fração da meia largura, tipo].
// aiPace = multiplica a velocidade dos rivais neste circuito (calibragem).
// Sem navegador.
export const TRACKS = [
  {
    id: 'rio', name: 'Rio Manso', desc: 'Rio largo com mata nas margens. Bom para começar.',
    width: 24, shallow: 2.5, scale: 1.25,
    points: [[0, 0], [0, -90], [15, -170], [60, -215], [125, -220], [175, -185], [190, -125], [165, -70],
      [175, -15], [220, 20], [235, 85], [205, 140], [140, 160], [80, 135], [45, 90], [10, 60]],
    ramps: [{ f: 0.045, len: 8, h: 1.1 }],
    gates: [0.12, 0.25, 0.37, 0.5, 0.63, 0.76, 0.9],
    obstacles: [[0.19, 0.55, 'tronco'], [0.31, -0.6, 'boia'], [0.44, 0.6, 'tronco'], [0.57, -0.55, 'boia'],
      [0.7, 0.6, 'tronco'], [0.83, -0.6, 'tronco'], [0.96, 0.55, 'boia']],
    theme: {
      kind: 'rio',
      skyTop: 0x3f8fe0, skyHorizon: 0xc4e4fa, sunGlow: 0xfff6dc, sunDir: [0.4, 0.75, 0.3],
      fog: 0xc4e4fa, fogNear: 120, fogFar: 650,
      water: 0x2f6e6a, waterDeep: 0x1d4f55, waterShallow: 0x6f7a4a, foam: 0xe8f0ea,
      bank: 0x7a5a3a, land: 0x4f8f3a, landFar: 0x5f9a45,
      sun: 0xfff2d6, sunI: 1.9, hemiSky: 0xcfeaff, hemiGround: 0x4d6a35, hemiI: 1.5,
      tree: 'mata', treeColors: [0x2f7a3a, 0x3f8a32, 0x26663a, 0x4f9a3a, 0x356f2a],
      accent: 0x2f9fd6,
    },
  },
  {
    id: 'canion', name: 'Cânion', desc: 'Rio estreito entre paredões de pedra. Curvas fechadas.',
    width: 17, shallow: 0.6, scale: 1.32,
    points: [[0, 0], [0, -70], [-20, -110], [-60, -120], [-80, -150], [-70, -190], [-30, -205], [10, -185],
      [45, -200], [85, -190], [95, -150], [70, -115], [80, -75], [115, -55], [120, -10], [95, 25], [55, 30], [25, 25]],
    ramps: [{ f: 0.035, len: 7, h: 1.0, hw: 3.8 }],
    gates: [0.13, 0.27, 0.4, 0.53, 0.66, 0.8, 0.92],
    gateHalf: 3.4,
    aiPace: 0.97,     // rivais um pouco mais lentos: no cânion estreito quase não dá para ultrapassar
    obstacles: [[0.2, 0.55, 'tronco'], [0.34, 0.5, 'boia'], [0.47, 0.5, 'boia'], [0.6, -0.55, 'tronco'],
      [0.73, 0.55, 'tronco'], [0.86, 0.55, 'boia']],
    theme: {
      kind: 'canion',
      skyTop: 0x4a86d0, skyHorizon: 0xe8d2b0, sunGlow: 0xfff0d0, sunDir: [-0.3, 0.8, -0.5],
      fog: 0xe0c8a6, fogNear: 90, fogFar: 520,
      water: 0x2a6a78, waterDeep: 0x184a58, waterShallow: 0x5a7a70, foam: 0xf0f4f2,
      bank: 0x9a5a3a, land: 0xb07a4a, landFar: 0xa86e42,
      rock: 0xa45c3a, rockDark: 0x7a4030,
      sun: 0xfff0d8, sunI: 2.0, hemiSky: 0xffe0c0, hemiGround: 0x6a3a28, hemiI: 1.4,
      tree: 'pedras', accent: 0xe8783a,
    },
  },
  {
    id: 'pantanal', name: 'Pantanal ao Pôr do Sol', desc: 'Lagoas e canais com aguapés, céu laranja e duas rampas.',
    width: 20, shallow: 3.5, scale: 1.4,
    points: [[0, 0], [-10, -80], [-50, -140], [-110, -160], [-170, -140], [-200, -90], [-190, -30], [-150, 10],
      [-150, 60], [-185, 100], [-170, 160], [-110, 185], [-50, 165], [-20, 120], [10, 70]],
    ramps: [{ f: 0.035, len: 8, h: 1.1 }, { f: 0.585, len: 8, h: 1.2 }],
    gates: [0.12, 0.24, 0.36, 0.48, 0.67, 0.79, 0.9],
    obstacles: [[0.18, -0.55, 'tronco'], [0.3, 0.55, 'boia'], [0.42, -0.6, 'tronco'], [0.54, 0.55, 'boia'],
      [0.73, -0.55, 'tronco'], [0.85, 0.6, 'tronco'], [0.95, -0.5, 'boia']],
    theme: {
      kind: 'pantanal',
      skyTop: 0x4a3a7a, skyHorizon: 0xff9a4a, sunGlow: 0xffd27a, sunDir: [0.75, 0.12, -0.65],
      fog: 0xe8925a, fogNear: 110, fogFar: 600,
      water: 0x5a4a5a, waterDeep: 0x2e2c48, waterShallow: 0x5a5a3a, foam: 0xffe8d0,
      bank: 0x5a5030, land: 0x5a6a2a, landFar: 0x4a5a28,
      sun: 0xffb070, sunI: 1.7, hemiSky: 0xffb890, hemiGround: 0x3a3a28, hemiI: 1.3,
      tree: 'pantanal', treeColors: [0x3a5a26, 0x4a6a2a, 0x2f4a22],
      accent: 0xff8a3a,
    },
  },
];
