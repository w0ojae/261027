/** Ordered colour bands for opaque scenery; glass and water keep their shaders. */
export const BAYER_4X4 = Object.freeze([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// These extended sRGB transfer functions deliberately retain values above one.
// The material is stylized before either direct ACES output or linear HDR capture,
// so rain, refraction and reflections never receive an extra tone-map operation.
const declarations = /* glsl */ `
uniform vec2 uOrderedDitherScale;
uniform vec2 uOrderedDitherOrigin;
uniform float uOrderedDitherLevels;
uniform float uOrderedDitherStrength;
uniform float uOrderedDitherCellSize;

vec3 orderedDitherEncode( vec3 radiance ) {
  vec3 value = max( radiance, vec3( 0.0 ) );
  return mix( value * 12.92,
    1.055 * pow( value, vec3( 1.0 / 2.4 ) ) - 0.055,
    step( vec3( 0.0031308 ), value ) );
}
vec3 orderedDitherDecode( vec3 value ) {
  value = max( value, vec3( 0.0 ) );
  return mix( value / 12.92,
    pow( ( value + 0.055 ) / 1.055, vec3( 2.4 ) ),
    step( vec3( 0.04045 ), value ) );
}
float orderedDitherThreshold( vec2 cell ) {
  vec2 position = mod( floor( cell ), 4.0 );
  vec4 row;
  if ( position.y < 1.0 ) row = vec4( ${BAYER_4X4.slice(0, 4).map(n => `${n}.0`).join(', ')} );
  else if ( position.y < 2.0 ) row = vec4( ${BAYER_4X4.slice(4, 8).map(n => `${n}.0`).join(', ')} );
  else if ( position.y < 3.0 ) row = vec4( ${BAYER_4X4.slice(8, 12).map(n => `${n}.0`).join(', ')} );
  else row = vec4( ${BAYER_4X4.slice(12, 16).map(n => `${n}.0`).join(', ')} );
  return ( row[ int( position.x ) ] + 0.5 ) / 16.0;
}
vec3 orderedDitherColour( vec3 radiance ) {
  vec2 cssPosition = ( gl_FragCoord.xy - uOrderedDitherOrigin ) * uOrderedDitherScale;
  float threshold = orderedDitherThreshold( cssPosition / uOrderedDitherCellSize );
  vec3 perceptual = orderedDitherEncode( radiance );
  float bands = uOrderedDitherLevels - 1.0;
  vec3 quantized = floor( perceptual * bands + threshold ) / bands;
  return mix( max( radiance, vec3( 0.0 ) ), orderedDitherDecode( quantized ), uOrderedDitherStrength );
}
`;

/** CPU reference for checking HDR palette changes and transfer-function edges. */
export function orderedDitherRadiance(value, threshold, levels = 9, strength = .35) {
  const radiance = Math.max(0, finite(value, 0));
  const count = clamp(Math.round(finite(levels, 9)), 2, 64) - 1;
  const amount = clamp(finite(strength, .35), 0, 1);
  const encoded = radiance <= .0031308 ? radiance * 12.92 : 1.055 * radiance ** (1 / 2.4) - .055;
  const quantized = Math.floor(encoded * count + clamp(finite(threshold, .5), 0, 1 - Number.EPSILON)) / count;
  const decoded = quantized <= .04045 ? quantized / 12.92 : ((quantized + .055) / 1.055) ** 2.4;
  return radiance + (decoded - radiance) * amount;
}

export function createOrderedDither(THREE, renderer, {levels = 9, strength = .35, cellSize = 1} = {}) {
  const levelCount = clamp(Math.round(finite(levels, 9)), 2, 64);
  const amount = clamp(finite(strength, .35), 0, 1);
  const cell = clamp(finite(cellSize, 1), .5, 16);
  const variants = new WeakMap();
  const applied = new WeakSet();
  const owned = new Set();
  const bindings = [];
  const cssSize = new THREE.Vector2();
  const viewport = new THREE.Vector4();
  const stats = {meshes: 0, materials: 0, skipped: 0};
  let disposed = false;

  function eligible(material, object) {
    if (!material || !(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial || material.isMeshBasicMaterial)) return false;
    if (material.transparent || material.opacity < .999 || material.transmission > 0) return false;
    if (object.userData?.rainSurface || material.userData?.rainSurface || object.userData?.outlineShell || material.userData?.outlineShell || object.userData?.modelOutline || material.userData?.modelOutline || object.userData?.styleEffect === 'outline' || material.userData?.styleEffect === 'outline') return false;
    if (/glass|\bpane\b|bulb|light pool|lamp glow|flame|water surface|raindrop|puddle|splash/i.test(`${object.name} ${material.name}`)) return false;
    if (material.emissiveIntensity > 0 && (material.emissiveMap || (material.emissive && Math.max(material.emissive.r, material.emissive.g, material.emissive.b) > .005))) return false;
    return true;
  }

  function cloneFor(original) {
    if (variants.has(original)) return variants.get(original);
    const material = original.clone();
    const previousCompile = original.onBeforeCompile;
    const previousCacheKey = original.customProgramCacheKey;
    const previousRender = original.onBeforeRender;
    const uniforms = {
      uOrderedDitherScale: {value: new THREE.Vector2(1, 1)},
      uOrderedDitherOrigin: {value: new THREE.Vector2()},
      uOrderedDitherLevels: {value: levelCount},
      uOrderedDitherStrength: {value: amount},
      uOrderedDitherCellSize: {value: cell},
    };
    material.name = `${original.name || original.type} · ordered colour`;
    material.onBeforeCompile = function (shader, activeRenderer) {
      // Material.clone() does not preserve custom shader callbacks. Explicitly
      // retain the rain detail and any authored hooks before adding colour bands.
      previousCompile.call(this, shader, activeRenderer);
      if (!shader.fragmentShader.includes('#include <opaque_fragment>')) return;
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = declarations + shader.fragmentShader.replace('#include <opaque_fragment>',
        'outgoingLight = orderedDitherColour( outgoingLight );\n#include <opaque_fragment>');
    };
    material.customProgramCacheKey = function () {
      return `${previousCacheKey.call(original)}|ordered-colour-v1`;
    };
    material.onBeforeRender = function (activeRenderer, ...args) {
      previousRender.call(this, activeRenderer, ...args);
      const current = activeRenderer || renderer;
      current.getSize(cssSize);
      current.getCurrentViewport(viewport);
      // Current viewport is in physical target pixels. This also compensates
      // for reduced-size glass/rain captures, rather than assuming canvas DPR.
      uniforms.uOrderedDitherScale.value.set(
        Math.max(1, cssSize.x) / Math.max(1, viewport.z),
        Math.max(1, cssSize.y) / Math.max(1, viewport.w));
      uniforms.uOrderedDitherOrigin.value.set(viewport.x, viewport.y);
    };
    variants.set(original, material);
    owned.add(material);
    stats.materials++;
    return material;
  }

  function apply(root) {
    if (disposed || !root) return;
    root.traverse(object => {
      if (!object.isMesh || applied.has(object) || !object.geometry?.getAttribute('position')) return;
      const original = object.material;
      const materials = Array.isArray(original) ? original : [original];
      let changed = false;
      const replacements = materials.map(material => {
        if (!eligible(material, object)) return material;
        changed = true;
        return cloneFor(material);
      });
      if (!changed) {stats.skipped++; return;}
      object.material = Array.isArray(original) ? replacements : replacements[0];
      bindings.push({object, original, replacement: object.material});
      applied.add(object);
      stats.meshes++;
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    bindings.forEach(({object, original, replacement}) => {
      if (object.material === replacement) object.material = original;
    });
    owned.forEach(material => material.dispose());
    owned.clear();
    bindings.length = 0;
  }

  return {apply, dispose, stats};
}
