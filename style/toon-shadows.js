/** Three diffuse light bands and fixed-size ordered ink confined to shade. */
export const TOON_BAYER_4X4 = Object.freeze([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function softEdge(value, threshold, width = 0) {
  if (!(width > 0)) return value >= threshold ? 1 : 0;
  const t = clamp((value - threshold + width) / (2 * width), 0, 1);
  return t * t * (3 - 2 * t);
}

// CPU references also make it possible to tune shade without using material
// RGB as a surrogate for light. A dark painted wall is not itself a shadow.
export function shadeBand(ndotl, {shadow = 1, normalWidth = 0, shadowWidth = 0} = {}) {
  const normal = clamp(finite(ndotl, 0), 0, 1);
  const visibility = clamp(finite(shadow, 1), 0, 1);
  const band = .55 * softEdge(normal, .25, normalWidth) + .45 * softEdge(normal, .7, normalWidth);
  return band * softEdge(visibility, .5, shadowWidth);
}
export function shadowDensity(brightness, {weather = 'clear', night = 0, maxDensity = .72} = {}) {
  const shade = clamp((.7 - finite(brightness, 1)) / .7, 0, 1);
  const quiet = 1 - .15 * (weather === 'rain' ? 1 : 0) - .18 * clamp(finite(night, 0), 0, 1);
  return clamp(finite(maxDensity, .72), 0, .85) * quiet * shade;
}
export function dotMask(cssX, cssY, density, cellSize = 1.25) {
  const cell = clamp(finite(cellSize, 1.25), .5, 16);
  const x = ((Math.floor(finite(cssX, 0) / cell) % 4) + 4) % 4;
  const y = ((Math.floor(finite(cssY, 0) / cell) % 4) + 4) % 4;
  return (TOON_BAYER_4X4[y * 4 + x] + .5) / 16 <= clamp(finite(density, 0), 0, 1) ? 1 : 0;
}

const declarations = /* glsl */ `
uniform vec2 uToonGridScale;
uniform vec2 uToonGridOrigin;
uniform float uToonCellSize;
uniform float uToonStrength;
uniform float uToonMaxDensity;
uniform float uToonInk;
uniform float uToonDitherEnabled;
uniform float uToonRain;
uniform float uToonNight;

// One assignment per light, not a new declaration inside Three's unrolled loops.
vec3 toonRawColor;
float toonPotential;
float toonVisible;

float toonEnergy( vec3 lightColor ) {
  return max( dot( lightColor, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.0 );
}
float toonEdge( float value, float threshold ) {
  float halfWidth = max( fwidth( value ) * 0.5, 0.0001 );
  return smoothstep( threshold - halfWidth, threshold + halfWidth, value );
}
float toonBand( float ndotl ) {
  return 0.55 * toonEdge( ndotl, 0.25 ) + 0.45 * toonEdge( ndotl, 0.70 );
}
float toonThreshold( vec2 cell ) {
  vec2 p = mod( floor( cell ), 4.0 );
  vec4 row;
  if ( p.y < 1.0 ) row = vec4( ${TOON_BAYER_4X4.slice(0, 4).map(n => `${n}.0`).join(', ')} );
  else if ( p.y < 2.0 ) row = vec4( ${TOON_BAYER_4X4.slice(4, 8).map(n => `${n}.0`).join(', ')} );
  else if ( p.y < 3.0 ) row = vec4( ${TOON_BAYER_4X4.slice(8, 12).map(n => `${n}.0`).join(', ')} );
  else row = vec4( ${TOON_BAYER_4X4.slice(12, 16).map(n => `${n}.0`).join(', ')} );
  return ( row[ int( p.x ) ] + 0.5 ) / 16.0;
}
`;

// This replaces only the Lambert diffuse contribution inside RE_Direct_Physical.
// Native irradiance, BRDF_GGX, clearcoat and sheen continue using the original
// shadowed light and the wet surface's original roughness and normal.
const directDiffuse = /* glsl */ `
float toonRawEnergy = toonEnergy( toonRawColor );
float toonVisibility = toonRawEnergy > 0.00001
  ? clamp( toonEnergy( directLight.color ) / toonRawEnergy, 0.0, 1.0 ) : 1.0;
toonPotential += toonRawEnergy;
toonVisible += toonRawEnergy * dotNL * toonVisibility;
vec3 toonIrradiance = toonRawColor * toonBand( dotNL ) * toonEdge( toonVisibility, 0.5 );
float toonAmount = uToonStrength * ( 1.0 - 0.12 * uToonRain - 0.10 * uToonNight );
reflectedLight.directDiffuse += mix( irradiance, toonIrradiance, toonAmount ) * BRDF_Lambert( material.diffuseColor );
`;

const shadeInk = /* glsl */ `
// These measures contain light energy and surface orientation, never albedo.
// With no active direct lights, ambient-only scenery remains clean.
float toonBrightness = toonPotential > 0.00001 ? clamp( toonVisible / toonPotential, 0.0, 1.0 ) : 1.0;
float toonShade = clamp( ( 0.70 - toonBrightness ) / 0.70, 0.0, 1.0 );
float toonDensity = uToonMaxDensity * toonShade * ( 1.0 - 0.15 * uToonRain - 0.18 * uToonNight );
vec2 toonCss = ( gl_FragCoord.xy - uToonGridOrigin ) * uToonGridScale;
float toonDot = step( toonThreshold( toonCss / uToonCellSize ), toonDensity );
float toonInkStrength = ( 1.0 - uToonInk ) * ( 1.0 - 0.18 * uToonRain - 0.20 * uToonNight );
float toonDiffuseInk = 1.0 - toonDot * toonInkStrength * uToonDitherEnabled;
reflectedLight.directDiffuse *= toonDiffuseInk;
reflectedLight.indirectDiffuse *= toonDiffuseInk;
`;

export function createToonShadows(THREE, renderer, {
  cellSize = 1.25, strength = 1, maxDensity = .72, ink = .6,
} = {}) {
  const uniforms = {
    uToonGridScale: {value: new THREE.Vector2(1, 1)},
    uToonGridOrigin: {value: new THREE.Vector2()},
    uToonCellSize: {value: clamp(finite(cellSize, 1.25), .5, 16)},
    uToonStrength: {value: clamp(finite(strength, 1), 0, 1)},
    uToonMaxDensity: {value: clamp(finite(maxDensity, .72), 0, .85)},
    uToonInk: {value: clamp(finite(ink, .6), 0, 1)},
    uToonDitherEnabled: {value: 1},
    uToonRain: {value: 0},
    uToonNight: {value: 0},
  };
  const variants = new WeakMap(), applied = new WeakSet(), owned = new Set(), bindings = [];
  const cssSize = new THREE.Vector2(), viewport = new THREE.Vector4();
  const stats = {meshes: 0, materials: 0, skipped: 0, shaderPrograms: 0, unsupportedPrograms: 0};
  let disposed = false;

  // Work on local copies. Changing Three's global ShaderChunk would also alter
  // excluded glass, water and future unrelated scenes.
  const nativePhysical = THREE.ShaderChunk.lights_physical_pars_fragment;
  const nativeBegin = THREE.ShaderChunk.lights_fragment_begin;
  const diffuseAnchor = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';
  const pointAnchor = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
  const spotAnchor = '#undef SPOT_LIGHT_MAP_INDEX';
  const directionalAnchor = 'getDirectionalLightInfo( directionalLight, directLight );';
  const chunksSupported = typeof nativePhysical === 'string' && typeof nativeBegin === 'string'
    && nativePhysical.includes(diffuseAnchor) && [pointAnchor, spotAnchor, directionalAnchor].every(anchor => nativeBegin.includes(anchor));
  const physical = chunksSupported ? nativePhysical.replace(diffuseAnchor, directDiffuse) : '';
  const begin = chunksSupported ? 'toonPotential = 0.0;\ntoonVisible = 0.0;\n' + nativeBegin
    .replace(pointAnchor, `${pointAnchor}\ntoonRawColor = directLight.color;`)
    // A spot cookie is part of the light source, so capture after the cookie
    // multiplication and before the actual shadow-map multiplication.
    .replace(spotAnchor, `${spotAnchor}\ntoonRawColor = directLight.color;`)
    .replace(directionalAnchor, `${directionalAnchor}\ntoonRawColor = directLight.color;`) : '';

  function eligible(material, object) {
    if (!material || !(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial)) return false;
    if (material.transparent || material.opacity < .999 || material.transmission > 0) return false;
    const metadata = [object.userData, material.userData];
    if (metadata.some(data => data?.rainSurface || data?.outlineShell || data?.modelOutline || data?.styleEffect === 'outline')) return false;
    if (/glass|\bpane\b|bulb|light pool|lamp glow|flame|water surface|raindrop|puddle|splash/i.test(`${object.name} ${material.name}`)) return false;
    if (material.emissiveIntensity > 0 && (material.emissiveMap || (material.emissive && Math.max(material.emissive.r, material.emissive.g, material.emissive.b) > .005))) return false;
    return true;
  }

  function cloneFor(original) {
    if (variants.has(original)) return variants.get(original);
    const material = original.clone();
    const previousCompile = original.onBeforeCompile, previousRender = original.onBeforeRender;
    const previousCacheKey = original.customProgramCacheKey;
    material.name = `${original.name || original.type} · toon shade`;
    material.onBeforeCompile = function (shader, activeRenderer) {
      previousCompile.call(this, shader, activeRenderer);
      const totalDiffuse = 'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;';
      if (!chunksSupported || !['#include <lights_physical_pars_fragment>', '#include <lights_fragment_begin>', totalDiffuse].every(anchor => shader.fragmentShader.includes(anchor))) {
        stats.unsupportedPrograms++;
        return;
      }
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = declarations + shader.fragmentShader
        .replace('#include <lights_physical_pars_fragment>', physical)
        .replace('#include <lights_fragment_begin>', begin)
        .replace(totalDiffuse, `${shadeInk}\n${totalDiffuse}`);
      stats.shaderPrograms++;
    };
    material.customProgramCacheKey = function () {
      return `${previousCacheKey.call(original)}|toon-shade-v2`;
    };
    material.onBeforeRender = function (activeRenderer, ...args) {
      previousRender.call(this, activeRenderer, ...args);
      const current = activeRenderer || renderer;
      current.getSize(cssSize); current.getCurrentViewport(viewport);
      uniforms.uToonGridScale.value.set(Math.max(1, cssSize.x) / Math.max(1, viewport.z), Math.max(1, cssSize.y) / Math.max(1, viewport.w));
      uniforms.uToonGridOrigin.value.set(viewport.x, viewport.y);
    };
    variants.set(original, material); owned.add(material); stats.materials++;
    return material;
  }

  function apply(root) {
    if (disposed || !root) return;
    root.traverse(object => {
      if (!object.isMesh || applied.has(object) || !object.geometry?.getAttribute('position')) return;
      const original = object.material, materials = Array.isArray(original) ? original : [original];
      let changed = false;
      const replacements = materials.map(material => {
        if (!eligible(material, object)) return material;
        changed = true; return cloneFor(material);
      });
      if (!changed) {stats.skipped++; return;}
      object.material = Array.isArray(original) ? replacements : replacements[0];
      bindings.push({object, original, replacement: object.material});
      applied.add(object); stats.meshes++;
    });
  }
  function setConditions({weather = 'clear', night = 0} = {}) {
    if (disposed) return;
    uniforms.uToonRain.value = weather === 'rain' ? 1 : 0;
    uniforms.uToonNight.value = clamp(finite(night, 0), 0, 1);
  }
  function setDitherEnabled(enabled) {
    if (disposed) return;
    uniforms.uToonDitherEnabled.value = enabled ? 1 : 0;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    bindings.forEach(({object, original, replacement}) => {
      if (object.material === replacement) object.material = original;
    });
    owned.forEach(material => material.dispose()); owned.clear(); bindings.length = 0;
  }
  return {apply, setConditions, setDitherEnabled, dispose, stats};
}
