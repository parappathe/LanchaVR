// Ondulação da água: a mesma fórmula roda no shader da água (scene.js) e aqui, para as lanchas
// balançarem junto com as ondas. Só visual (a física considera a água plana). Sem navegador.
// Cada onda: [direção x, direção z, número de onda (rad/m), velocidade (rad/s), amplitude (m)]
export const WAVES = [
  [0.8, 0.6, 0.32, 1.5, 0.07],
  [-0.5, 0.86, 0.52, 2.0, 0.045],
  [0.2, -0.98, 0.85, 2.6, 0.025],
];

export function waveHeight(x, z, t) {
  let h = 0;
  for (const [dx, dz, k, w, a] of WAVES) h += a * Math.sin((dx * x + dz * z) * k + t * w);
  return h;
}

// Inclinação da superfície (derivadas em x e z), para os barcos dos outros balançarem.
export function waveSlope(x, z, t) {
  let sx = 0, sz = 0;
  for (const [dx, dz, k, w, a] of WAVES) {
    const c = a * k * Math.cos((dx * x + dz * z) * k + t * w);
    sx += c * dx; sz += c * dz;
  }
  return [sx, sz];
}
