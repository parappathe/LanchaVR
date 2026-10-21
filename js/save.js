// Recordes e opções, salvos no navegador.
const KEY = 'lanchavr.v1';
const DEFAULTS = {
  best: {},        // por circuito: { time, lap } (melhor tempo final com penalidades e melhor volta)
  podium: {},      // por circuito e nível: melhor posição { 'rio:medio': 1 }
  level: 1,        // último nível escolhido
  comfort: true,   // escurece as bordas da visão nas curvas (VR)
  bob: true,       // balanço leve da lancha do jogador no VR (±1,5 cm, sem inclinar)
  fps: false,
  view: 'chase',   // câmera no PC: 'chase' (atrás) | 'cockpit' (cabine)
};

export function loadSave() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export function storeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sem armazenamento: segue sem salvar */ }
}
