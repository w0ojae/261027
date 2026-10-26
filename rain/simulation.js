// Surface-water adaptation of Over-the-Window. See THIRD_PARTY_NOTICES.md.
import {CodropsPhysics, DROP_SCALE} from './codrops-physics.js?v=10';
import {HeartfeltRain} from './heartfelt-rain.js';
import {WaterMap} from './raindrops.js?v=37';
import {RAIN_ZOOM} from './heartfelt-field.js?v=10';

export {RAIN_ZOOM, DROP_SCALE};
export const SIMULATION_STEP = 1 / 30;
let spriteImages;

function loadImage(name) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load rain sprite: ${name}`));
    image.src = new URL(`./assets/${name}`, import.meta.url).href;
  });
}

function loadSprites() {
  return spriteImages ??= Promise.all([
    loadImage('drop-alpha.png'), loadImage('drop-color.png'),
  ]).catch(error => { spriteImages = undefined; throw error; });
}

// Width/height are fixed logical glass coordinates, independent of camera and DPR.
// This module owns CPU maps. Its consumer owns and disposes Three.js textures.
export async function createRainPane({width, height}) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new RangeError('Rain pane width and height must be positive finite pixels.');
  }
  width = Math.round(width); height = Math.round(height);
  const [alpha, color] = await loadSprites();
  const physics = new CodropsPhysics(width, height);
  const rain = new HeartfeltRain();
  const map = new WaterMap(alpha, color, {surfaceDensity: .12});
  map.physics = physics;
  map.field.rain = rain;
  map.resize(width, height);
  map.draw(physics.drops);
  const microGrid = [map.field.originX, map.field.originY, map.field.cols, map.field.rows];
  let active = true, disposed = false, accumulator = 0;
  const trail = (...args) => map.trail(...args);
  const absorb = (...args) => map.absorb(...args);

  function update(delta) {
    if (disposed || !active || !Number.isFinite(delta) || delta <= 0) return false;
    const dt = Math.min(delta, .08);
    const revision = map.revision, maskRevision = map.maskRevision, fieldRevision = map.field.revision;
    accumulator = Math.min(accumulator + dt, SIMULATION_STEP * 2);
    let stepped = false;
    while (accumulator >= SIMULATION_STEP) {
      rain.update(SIMULATION_STEP);
      map.updateRain(rain, physics);
      physics.step(SIMULATION_STEP, trail, absorb);
      // Surface growth and trail age share the same clock as the water bodies.
      // Extra display frames must not redraw canvases or upload new map states.
      map.decay(SIMULATION_STEP);
      map.condense(SIMULATION_STEP);
      map.dirty = true;
      stepped = true;
      accumulator -= SIMULATION_STEP;
    }
    if (!stepped) return false;
    // A bounded catch-up may advance two ticks; only its final maps are visible.
    map.draw(physics.drops);
    return revision !== map.revision || maskRevision !== map.maskRevision || fieldRevision !== map.field.revision;
  }

  function setActive(value) {
    if (disposed) return;
    const next = Boolean(value);
    if (active === next) return;
    active = next;
    physics.active = active;
    accumulator = 0;
  }

  function dispose() {
    if (disposed) return;
    disposed = true; active = false; accumulator = 0;
    physics.active = false; physics.drops.length = 0;
    const canvases = new Set([
      map.canvas, map.mask, map.heightMap, map.residueMap, map.droplets,
      map.heightSprite, map.field.texture, ...map.sprites, ...map.heightSprites,
      ...map.shapedSprites.values(),
    ]);
    for (const canvas of canvases) { canvas.width = 1; canvas.height = 1; }
    map.beads.cells.clear(); map.beads.count = 0;
    map.field.heads.clear(); map.field.consumed.clear(); map.field.records.length = 0;
    map.field.pixels = null; map.field.rain = null;
    map.shapedSprites.clear(); map.deformedPixels.clear();
    map.spritePixels.length = 0; map.trailContours.normal.length = 0; map.trailContours.heartfelt.length = 0;
    map.maskPixels = null;
    map.trailMemory.resize(1, 1);
    map.trailBeads.paths = new WeakMap();
  }

  return {width, height, map, rain, physics, rainZoom: RAIN_ZOOM, dropScale: DROP_SCALE,
    microGrid, update, setActive, dispose};
}
