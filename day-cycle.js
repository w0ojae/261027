export const DAY_CYCLE_SECONDS = 300;

const DAY_MINUTES = 1440;
const wrapMinutes = value => {
  const wrapped = value % DAY_MINUTES;
  return wrapped < 0 ? wrapped + DAY_MINUTES : wrapped;
};

/** Advance the scene clock through one full day in five real minutes. */
export function advanceDayMinutes(minutes, delta) {
  const current = Number.isFinite(minutes) ? wrapMinutes(minutes) : 0;
  const seconds = Number.isFinite(delta) && delta > 0 ? delta % DAY_CYCLE_SECONDS : 0;
  const next = wrapMinutes(current + seconds * DAY_MINUTES / DAY_CYCLE_SECONDS);
  // Keep repeated fractional frames from leaving a completed day just below 24:00.
  return next < 1e-7 || DAY_MINUTES - next < 1e-7 ? 0 : next;
}
