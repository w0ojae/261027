// Camera changes happen only after the black veil reaches full opacity.
export function createWalkDissolve({
  reducedMotion = false,
  onBusy = () => {},
  onOpacity = () => {},
  onComplete = () => {},
} = {}) {
  const fadeOut = reducedMotion ? .08 : .32;
  const hold = reducedMotion ? .04 : .12;
  const fadeIn = reducedMotion ? .10 : .46;
  const total = fadeOut + hold + fadeIn;
  const smooth = value => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
  };
  let transition = null;

  function cancel() {
    transition = null;
    onOpacity(0);
    onBusy(false);
  }

  return {
    get active() { return transition !== null; },

    start(onSwap) {
      if (transition) return false;
      if (typeof onSwap !== 'function') throw new TypeError('A camera swap callback is required.');
      transition = { elapsed: 0, swapped: false, onSwap };
      onBusy(true);
      onOpacity(0);
      return true;
    },

    cancel,

    update(delta) {
      const current = transition;
      if (!current || !Number.isFinite(delta) || delta <= 0) return;
      const t = current.elapsed += delta;
      if (t < fadeOut) {
        onOpacity(smooth(t / fadeOut));
        return;
      }

      let justSwapped = false;
      if (!current.swapped) {
        // A long frame can span every phase. Cover the scene before swapping,
        // even when this update also needs to finish the fade back in.
        onOpacity(1);
        if (transition !== current) return;
        current.swapped = true;
        justSwapped = true;
        try {
          current.onSwap();
        } catch (error) {
          cancel();
          throw error;
        }
        if (transition !== current) return;
      }

      if (t >= total) {
        transition = null;
        onOpacity(0);
        onBusy(false);
        onComplete();
      } else if (t < fadeOut + hold) {
        if (!justSwapped) onOpacity(1);
      } else {
        onOpacity(1 - smooth((t - fadeOut - hold) / fadeIn));
      }
    },
  };
}
