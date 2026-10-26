const clamp = value => Math.max(0, Math.min(1, value));

function smootherRange(progress, start, end) {
  const p = clamp((progress - start) / (end - start));
  return p * p * p * (p * (p * 6 - 15) + 10);
}

/** Every visual follows the same reversible scroll position, without timers. */
export function getIntroVisuals(progress, {reducedMotion = false} = {}) {
  const p = Number.isFinite(progress) ? clamp(progress) : 0;
  if (reducedMotion) {
    return {
      sceneOpacity: p,
      logoOpacity: 1 - p,
      veilOpacity: 0,
      logoScale: 1,
      logoY: 0,
      logoBlur: 0,
      hintOpacity: 1 - p,
      approachProgress: p,
    };
  }
  const logoMotion = smootherRange(p, 0, .45);
  return {
    sceneOpacity: smootherRange(p, .48, .95),
    logoOpacity: 1 - smootherRange(p, .05, .40),
    veilOpacity: smootherRange(p, .16, .46) * (1 - smootherRange(p, .56, .92)),
    logoScale: 1 - .06 * logoMotion,
    logoY: logoMotion > 0 ? -20 * logoMotion : 0,
    logoBlur: 4 * smootherRange(p, .06, .42),
    hintOpacity: 1 - smootherRange(p, 0, .20),
    approachProgress: clamp((p - .38) / .62),
  };
}
