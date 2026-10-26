/**
 * Original, world-space wet surface detail. No external image assets are used.
 * Existing PBR materials, maps and render settings remain the source of truth;
 * shader changes have exactly zero strength outside rainy weather.
 */
export function createWetMaterials(THREE, { reducedMotion = false } = {}) {
  const wetness = { value: 0 };
  const inverseBuilding = { value: new THREE.Matrix4() };
  const owned = new Set();
  const variants = new WeakMap();
  const applied = new WeakSet();
  const bindings = [];
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  let building = null;
  let disposed = false;
  const stats = { environmentMeshes: 0, modelMeshes: 0, materials: 0, kinds: {}, examples: [] };

  // kind, minimum wet roughness, absorption, relief (world metres), frequency.
  const profiles = {
    stone: [0, .19, .27, .0042, 5.5],
    wood: [1, .27, .22, .0028, 5.0],
    roof: [2, .16, .17, .0017, 7.0],
    foliage: [3, .48, .15, .0004, 7.0],
    soil: [4, .58, .25, .0040, 6.5],
    metal: [5, .23, .10, .0006, 8.0],
  };

  // The current GLB combines several pieces in each material. Excluding these
  // authored café furnishings also protects pieces outside the room bounds,
  // such as the upstairs sofa beside the balcony.
  const dryFurnishings = new Set([
    'Material.007', 'Material.030', 'Material.031', 'Material.038',
    'Material.039', 'Material.040', 'Material.041', 'Material.042',
    'Material.043', 'Material.044', 'Material.045', 'Material.046',
  ]);
  const buildingStructure = new Set([
    'Material.017', 'Material.018', 'Material.019', 'Material.020',
    'Material.021', 'Material.022', 'Material.023', 'Material.024',
    'Material.025', 'Material.026', 'Material.028', 'Material.032',
    'Material.033', 'Material.034', 'Material.035', 'Material.036',
  ]);

  function eligible(material, object) {
    if (!material || !(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial)) return false;
    if (material.transparent || material.opacity < .98 || material.transmission > 0) return false;
    if (/glass|pane|bulb|light pool|warm.*lamp|flame|screen|coffee|cup|chair|sofa/i.test(`${object.name} ${material.name}`)) return false;
    if (material.emissive && material.emissiveIntensity > 0 && Math.max(material.emissive.r, material.emissive.g, material.emissive.b) > .005) return false;
    return true;
  }

  function kindFor(material, object, scope) {
    const name = `${object.name} ${material.name}`.toLowerCase();
    const c = material.color || { r: .5, g: .5, b: .5 };
    if (/leaf|crown|shrub|grass|planting|flower.*stem/.test(name)) return 'foliage';
    if (/soil|garden ground/.test(name)) return 'soil';
    if (/trunk|bark|wood|timber/.test(name)) return 'wood';
    if (/stone|path|foundation|concrete|plaster|brick/.test(name)) return 'stone';
    if (/roof|tile|material\.020\b/.test(name)) return 'roof';
    if (/metal|lamp post|lamp cap|wire|cable/.test(name) || material.metalness > .15) return 'metal';
    if (scope === 'environment' && object.geometry.type === 'ExtrudeGeometry') {
      return c.r > c.g && c.g > c.b * 1.12 ? 'soil' : 'stone';
    }
    if (scope === 'model') {
      if (['Material.019', 'Material.025', 'Material.035'].includes(material.name)) return 'stone';
      if (['Material.018', 'Material.036'].includes(material.name)) return 'metal';
    }
    if (c.r > c.b * 1.3 && c.g > c.b * 1.12 && c.r >= c.g) return 'wood';
    if (c.g > c.r * 1.2 && c.g > c.b * 1.15) return 'foliage';
    return 'stone';
  }

  const vertexDeclarations = `
varying vec3 vWetWorldPosition;
`;
  const vertexPosition = `
#include <project_vertex>
vec4 wetLocalPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  wetLocalPosition = batchingMatrix * wetLocalPosition;
#endif
#ifdef USE_INSTANCING
  wetLocalPosition = instanceMatrix * wetLocalPosition;
#endif
vWetWorldPosition = ( modelMatrix * wetLocalPosition ).xyz;
`;
  const fragmentDeclarations = `
varying vec3 vWetWorldPosition;
uniform float uSurfaceWetness;
uniform vec4 uWetProfile;
uniform float uWetFrequency;
uniform float uWetBuilding;
uniform mat4 uWetBuildingInverse;

float wetHash( vec3 p ) {
  p = fract( p * .1031 );
  p += dot( p, p.yzx + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}
float wetNoise( vec3 p ) {
  vec3 cell = floor( p );
  vec3 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( wetHash( cell ), wetHash( cell + vec3( 1., 0., 0. ) ), f.x ),
         mix( wetHash( cell + vec3( 0., 1., 0. ) ), wetHash( cell + vec3( 1., 1., 0. ) ), f.x ), f.y ),
    mix( mix( wetHash( cell + vec3( 0., 0., 1. ) ), wetHash( cell + vec3( 1., 0., 1. ) ), f.x ),
         mix( wetHash( cell + vec3( 0., 1., 1. ) ), wetHash( cell + vec3( 1., 1., 1. ) ), f.x ), f.y ), f.z );
}
float wetExteriorExposure( vec3 worldPosition, vec3 worldNormal ) {
  if ( uWetBuilding < .5 ) return 1.0;
  vec3 p = ( uWetBuildingInverse * vec4( worldPosition, 1.0 ) ).xyz;
  vec3 n = normalize( mat3( uWetBuildingInverse ) * worldNormal );
  // Building-local coordinates after the GLB source-height normalization.
  // Upstairs projects farther to the right than the ground-floor café.
  float rightEdge = mix( 2.20, 3.08, smoothstep( 3.30, 4.10, p.y ) );
  float outside = max( max( -2.63 - p.x, p.x - rightEdge ),
                       max( -5.64 - p.z, p.z + .68 ) );
  float openAir = smoothstep( .035, .16, outside );
  float rightFace = smoothstep( rightEdge - .16, rightEdge + .03, p.x ) * smoothstep( .12, .72, n.x );
  float leftFace = ( 1.0 - smoothstep( -2.66, -2.47, p.x ) ) * smoothstep( .12, .72, -n.x );
  float frontFace = smoothstep( -.84, -.65, p.z ) * smoothstep( .12, .72, n.z );
  float rearFace = ( 1.0 - smoothstep( -5.67, -5.48, p.z ) ) * smoothstep( .12, .72, -n.z );
  float roofFace = smoothstep( 5.95, 6.40, p.y ) * smoothstep( .12, .70, n.y );
  float exposed = max( openAir, max( roofFace, max( max( rightFace, leftFace ), max( frontFace, rearFace ) ) ) );
  // Sheltered undersides receive much less of the water film.
  return exposed * mix( .30, 1.0, smoothstep( -.22, .25, n.y ) );
}
`;
  const fragmentSurface = `
#include <normal_fragment_maps>
vec3 wetWorldNormal = inverseTransformDirection( normal, viewMatrix );
float wetAmount = uSurfaceWetness * wetExteriorExposure( vWetWorldPosition, wetWorldNormal );
vec3 wetP = vWetWorldPosition * uWetFrequency;
float wetCoarse = wetNoise( wetP );
float wetFine = wetNoise( wetP * 4.3 + vec3( 7.2, 1.5, 3.8 ) );
float wetFootprint = max( length( dFdx( wetP ) ), length( dFdy( wetP ) ) );
float wetDetail = 1.0 - smoothstep( .12, .65, wetFootprint );
float wetRelief = .64 * wetCoarse + .36 * wetFine * wetDetail;
float wetVariation = wetCoarse;
if ( uWetProfile.x > .5 && uWetProfile.x < 1.5 ) {
  // Uneven, long grain rather than a repeated wood photograph.
  float wetGrainNoise = wetNoise( wetP * vec3( .24, .055, .24 ) );
  float wetGrain = .5 + .5 * sin( ( wetP.x + wetP.z * .71 ) * 13.0 + wetGrainNoise * 16.0 );
  wetRelief = mix( wetCoarse, wetGrain, .56 * wetDetail );
  wetVariation = mix( wetCoarse, wetGrain, .28 * wetDetail );
} else if ( uWetProfile.x > 1.5 && uWetProfile.x < 2.5 ) {
  // Fine vertical water tracks on the metal roof; no wind simulation.
  float wetTracks = .5 + .5 * sin( wetP.x * 17.0 + wetCoarse * 5.0 );
  wetRelief = mix( wetCoarse, wetTracks, .35 * wetDetail );
}
float wetFilm = wetAmount * ( .83 + .17 * wetCoarse );
float wetTargetRoughness = clamp( uWetProfile.y + ( wetFine - .5 ) * .09, .12, .8 );
roughnessFactor = mix( roughnessFactor, min( roughnessFactor, wetTargetRoughness ), wetFilm );
diffuseColor.rgb *= 1.0 - wetAmount * ( uWetProfile.z + ( wetVariation - .5 ) * .10 );
float wetHeight = wetRelief * uWetProfile.w * wetAmount;
vec2 wetHeightGradient = vec2( dFdx( wetHeight ), dFdy( wetHeight ) );
vec3 wetDx = dFdx( -vViewPosition );
vec3 wetDy = dFdy( -vViewPosition );
vec3 wetRx = cross( wetDy, normal );
vec3 wetRy = cross( normal, wetDx );
float wetDet = dot( wetDx, wetRx );
vec3 wetGradient = sign( wetDet ) * ( wetHeightGradient.x * wetRx + wetHeightGradient.y * wetRy );
wetGradient /= max( abs( wetDet ), 1e-7 );
if ( wetAmount > 0.0 ) normal = normalize( normal - clamp( wetGradient, vec3( -.18 ), vec3( .18 ) ) );
`;

  function cloneFor(original, kind, scope) {
    let cache = variants.get(original);
    if (!cache) { cache = new Map(); variants.set(original, cache); }
    const key = `${scope}:${kind}`;
    if (cache.has(key)) return cache.get(key);
    const material = original.clone();
    material.name = `${original.name || kind} · rain detail`;
    const baseHook = original.onBeforeCompile;
    const baseKey = original.customProgramCacheKey();
    const profile = profiles[kind];
    const profileUniform = { value: new THREE.Vector4(...profile.slice(0, 4)) };
    const frequencyUniform = { value: profile[4] };
    const buildingUniform = { value: scope === 'model' ? 1 : 0 };
    material.onBeforeCompile = function (shader, renderer) {
      baseHook.call(this, shader, renderer);
      if (!shader.vertexShader.includes('#include <project_vertex>') || !shader.fragmentShader.includes('#include <normal_fragment_maps>')) {
        console.warn('Wet material skipped: incompatible material shader', original.name);
        return;
      }
      Object.assign(shader.uniforms, {
        uSurfaceWetness: wetness,
        uWetProfile: profileUniform,
        uWetFrequency: frequencyUniform,
        uWetBuilding: buildingUniform,
        uWetBuildingInverse: inverseBuilding,
      });
      shader.vertexShader = vertexDeclarations + shader.vertexShader.replace('#include <project_vertex>', vertexPosition);
      shader.fragmentShader = fragmentDeclarations + shader.fragmentShader.replace('#include <normal_fragment_maps>', fragmentSurface);
    };
    material.customProgramCacheKey = () => `${baseKey}|original-wet-surface-v1|${key}`;
    cache.set(key, material);
    owned.add(material);
    stats.materials++;
    stats.kinds[kind] = (stats.kinds[kind] || 0) + 1;
    return material;
  }

  function apply(group, scope) {
    if (disposed || !group) return;
    group.updateWorldMatrix(true, true);
    group.traverse(object => {
      if (!object.isMesh || applied.has(object) || !object.geometry?.getAttribute('position')) return;
      const original = object.material;
      const originals = Array.isArray(original) ? original : [original];
      let structural = true;
      if (scope === 'model') {
        box.setFromObject(object, false);
        box.applyMatrix4(inverseBuilding.value);
        box.getSize(size);
        box.getCenter(center);
        const extent = Math.max(size.x, size.y, size.z);
        const outsideRoom = center.x < -2.7 || center.x > 3.2 || center.z < -5.7 || center.z > -.60 || center.y > 6.2;
        structural = extent > 1.85 || (outsideRoom && extent > .45);
      }
      let changed = false;
      const replacements = originals.map(material => {
        if (!eligible(material, object)) return material;
        if (scope === 'model' && (dryFurnishings.has(material.name) || (!structural && !buildingStructure.has(material.name)))) return material;
        if (scope === 'environment' && /small wildflower/i.test(object.name)) return material;
        changed = true;
        return cloneFor(material, kindFor(material, object, scope), scope);
      });
      if (!changed) return;
      object.material = Array.isArray(original) ? replacements : replacements[0];
      bindings.push({ object, original, replacement: object.material });
      applied.add(object);
      stats[scope === 'model' ? 'modelMeshes' : 'environmentMeshes']++;
      if (stats.examples.length < 24) stats.examples.push(`${scope}: ${object.name || '(unnamed)'} → ${replacements.map(m => m.name).join(', ')}`);
    });
  }

  function applyModel(model) {
    if (disposed || !model) return;
    building = model;
    building.updateWorldMatrix(true, true);
    inverseBuilding.value.copy(building.matrixWorld).invert();
    apply(model, 'model');
  }

  function update(elapsed = 0, delta = .016, { enabled = false } = {}) {
    if (disposed) return;
    // Disabling rain restores the authored dry colour, normals and roughness
    // immediately; enabling gently develops the film without mutating them.
    const dt = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), .1) : 0;
    wetness.value = enabled ? (reducedMotion ? 1 : wetness.value + (1 - wetness.value) * (1 - Math.exp(-dt * 3.8))) : 0;
    if (building) {
      building.updateWorldMatrix(true, false);
      inverseBuilding.value.copy(building.matrixWorld).invert();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    bindings.forEach(({ object, original, replacement }) => {
      if (object.material === replacement) object.material = original;
    });
    owned.forEach(material => material.dispose());
    bindings.length = 0;
    owned.clear();
    building = null;
  }

  return { applyEnvironment: group => apply(group, 'environment'), applyModel, update, dispose, stats };
}
