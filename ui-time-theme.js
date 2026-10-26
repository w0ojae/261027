const clampNight = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
export const UI_THEME_TRANSITION_SECONDS = 6;

// Give the interface its own long twilight, independent of the steeper lighting
// curve. A five-minute day spends fifty real seconds crossing each color ramp.
export function getUiNightForMinutes(minutes) {
  if (!Number.isFinite(minutes)) return 0;
  const hour = ((minutes % 1440 + 1440) % 1440) / 60;
  if (hour < 4 || hour >= 20) return 1;
  if (hour < 8) return (8 - hour) / 4;
  if (hour <= 16) return 0;
  return (hour - 16) / 4;
}

// These pairs retain the existing day/night palette, including translucent borders.
const COLORS = {
  '--ink': [[45, 68, 59, 1], [237, 240, 219, 1]],
  '--soft': [[112, 128, 117, 1], [175, 188, 173, 1]],
  '--line': [[61, 82, 61, .13], [235, 240, 219, .13]],
  '--glass': [[255, 255, 247, .84], [35, 54, 51, .88]],
  '--accent': [[85, 115, 81, 1], [183, 204, 151, 1]],
  '--icon-background': [[255, 255, 248, .3], [48, 76, 69, 48 / 255]],
  '--view-active': [[223, 230, 211, 1], [97, 117, 91, 85 / 255]],
  '--view-hover': [[229, 234, 220, 1], [97, 117, 91, 68 / 255]],
  '--weather-active': [[229, 235, 220, 1], [97, 117, 91, 85 / 255]],
  '--dock-border': [[255, 255, 255, .75], [240, 244, 224, 21 / 255]],
  '--tools-border': [[255, 255, 255, .6], [240, 244, 224, 21 / 255]],
  '--live-dot': [[107, 140, 80, 1], [190, 209, 138, 1]],
  '--dither-active': [[223, 230, 211, 1], [97, 117, 91, 136 / 255]],
  '--dither-border': [[106, 130, 85, 64 / 255], [175, 195, 145, 80 / 255]],
};

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
const serialize = color => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3]})`;

/** CSS token values for a single, continuous day/night position. */
export function getTimeTheme(night) {
  const position = clampNight(night);
  const theme = {};
  for (const [name, [day, dark]] of Object.entries(COLORS)) {
    if (position === 0 || position === 1) {
      theme[name] = serialize(position === 0 ? day : dark);
    } else {
      theme[name] = serialize(day.map((channel, index) =>
        round(channel + (dark[index] - channel) * position, index === 3 ? 6 : 3)));
    }
  }
  // A temporary dark halo keeps lettering legible when both foreground and glass
  // cross their middle values. It disappears at the unchanged day/night endpoints.
  const halo = position === 0 || position === 1 ? 0 : round(Math.sin(Math.PI * position) ** 2 * .85, 6);
  theme['--text-halo'] = `rgba(8, 20, 16, ${halo})`;
  return theme;
}

/** Move every token together, with six seconds of visible color for a full jump. */
export function createTimeTheme(rootStyle, {initialNight = 0} = {}) {
  let night = clampNight(initialNight);
  let target = night;
  const previous = new Map();

  function writeTheme() {
    for (const [name, value] of Object.entries(getTimeTheme(night))) {
      if (previous.get(name) === value) continue;
      rootStyle.setProperty(name, value);
      previous.set(name, value);
    }
  }

  writeTheme();

  return {
    setNight(value) {
      target = clampNight(value);
    },
    update(delta) {
      if (night === target || !Number.isFinite(delta) || delta <= 0) return night;
      const remaining = target - night;
      night += Math.sign(remaining) * Math.min(Math.abs(remaining), delta / UI_THEME_TRANSITION_SECONDS);
      if (Math.abs(target - night) < 1e-9) night = target;
      writeTheme();
      return night;
    },
    get night() { return night; },
    get target() { return target; },
  };
}
