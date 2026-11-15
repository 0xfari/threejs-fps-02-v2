// Emberline Yard: dusk-industrial look plan. Six values and one accent hue; the
// lighting makes every shade the game needs, so no other colour appears in code.
// The same six names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#191411', // dusk sky / fog
  surface: '#2e2822', // concrete and steel, light enough to read at dusk
  hairline: '#4a3e30', // crates, trim
  ink: '#ece5d8', // warm off-white
  muted: '#a89a86', // dust and distant walls
  accent: '#ff7a1a', // ember orange: sites, tracers, CTAs
  ally: '#57b6ff', // friendly markers and tracers
  enemy: '#ff5340', // hostile markers
};

export function shade(name) {
  return PALETTE[name];
}
