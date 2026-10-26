const MIN_SCALE = .18;

/** Scale the overview around the viewport center with a gentle start and stop. */
export function getIntroApproachScale(progress, {reducedMotion = false} = {}) {
  if (reducedMotion || !Number.isFinite(progress)) return 1;
  const p = Math.max(0, Math.min(1, progress));
  const eased = p * p * p * (p * (p * 6 - 15) + 10);
  return MIN_SCALE + (1 - MIN_SCALE) * eased;
}

/**
 * Render-only overview framing. World placement, the user's zoom, and all
 * first-person cameras retain their original values outside this callback.
 */
export function createIntroApproach(THREE, {reducedMotion = false} = {}) {
  const originalProjection = new THREE.Matrix4();
  const originalInverse = new THREE.Matrix4();
  const motionOptions = {reducedMotion};

  function render(camera, progress, renderFrame) {
    const scale = getIntroApproachScale(progress, motionOptions);
    if (!camera?.isOrthographicCamera || scale === 1) return renderFrame();
    originalProjection.copy(camera.projectionMatrix);
    originalInverse.copy(camera.projectionMatrixInverse);
    try {
      const elements = camera.projectionMatrix.elements;
      // Include the view-offset translation, so the already-centered garden
      // shrinks around the screen center rather than drifting to one side.
      for (let column = 0; column < 4; column++) {
        elements[column * 4] *= scale;
        elements[column * 4 + 1] *= scale;
      }
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      return renderFrame();
    } finally {
      camera.projectionMatrix.copy(originalProjection);
      camera.projectionMatrixInverse.copy(originalInverse);
    }
  }

  return {render};
}
