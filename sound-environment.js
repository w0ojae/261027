// Keep the original outdoor sound; only indoor rain is heard through the building.
export function createSoundEnvironment(context, { filter, gain }) {
  let previousCutoff;
  let previousVolume;
  let wasMuffled = false;

  return {
    update({ weather = 'clear', indoor = false, enabled = false } = {}) {
      const rain = weather === 'rain';
      const muffled = rain && indoor;
      const cutoff = muffled ? 650 : rain ? 2100 : 600;
      const volume = enabled ? (muffled ? .045 : rain ? .16 : .06) : 0;
      const changingMuffling = muffled !== wasMuffled;
      const now = context.currentTime;

      // AudioParam targets start from the current sound, even during rapid changes.
      // Cache each target so time-of-day animation cannot continually reschedule it.
      if (cutoff !== previousCutoff) {
        filter.frequency.setTargetAtTime(cutoff, now, changingMuffling ? .35 : 1);
        previousCutoff = cutoff;
      }
      if (volume !== previousVolume) {
        gain.gain.setTargetAtTime(volume, now, changingMuffling ? .35 : .5);
        previousVolume = volume;
      }
      wasMuffled = muffled;
    },
  };
}
