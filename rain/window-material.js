/*
 * World-pane adapter for the supplied Over-the-Window rain optics.
 * Codrops RainEffect: Lucas Bebber, MIT (see THIRD_PARTY_NOTICES.md).
 * Heartfelt: Martijn Steinrucken / BigWings, 2017, CC BY-NC-SA 3.0.
 * https://www.shadertoy.com/view/ltffzl
 * https://creativecommons.org/licenses/by-nc-sa/3.0/
 * Adaptations: pane-local water UVs, live scene capture, projected refraction,
 * revision-based Three.js textures, and linear-light output. Wind is omitted.
 */

const vertexShader = /* glsl */`
  varying vec2 vPaneUV;
  varying vec3 vPaneViewPosition;
  varying vec3 vPaneViewNormal;
  void main() {
    vPaneUV = uv;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vPaneViewPosition = viewPosition.xyz;
    vPaneViewNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const fragmentShader = /* glsl */`
  uniform sampler2D u_waterMap;
  uniform sampler2D u_clear;
  uniform sampler2D u_microSeeds;
  uniform sampler2D u_heartfelt;
  uniform sampler2D u_scene;
  uniform sampler2D u_background;
  uniform sampler2D u_lens;
  uniform sampler2D u_fog;
  uniform sampler2D u_depth;
  uniform vec4 u_microGrid;
  uniform vec4 u_rain;
  uniform vec2 u_cssSize;
  uniform vec2 u_resolution;
  uniform float u_rainZoom;
  uniform float u_dropScale;
  uniform float u_fogLevel;
  uniform float u_hasDepth;
  uniform mat4 u_projectionInverse;
  uniform float u_depthMargin;
  uniform vec3 u_fogTint;
  varying vec2 vPaneUV;
  varying vec3 vPaneViewPosition;
  varying vec3 vPaneViewNormal;

  // Portable Heartfelt smoothstep: descending edges are intentional.
  float S(float a, float b, float value) {
    if (abs(b - a) < 0.00001) return 0.0;
    float t = clamp((value - a) / (b - a), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  float Saw(float b, float t) {
    return S(0.0, b, t) * S(1.0, b, t);
  }

  // Heartfelt's static bead field shares the CPU simulation's collision seeds.
  float StaticDrops(vec2 uv, float t) {
    uv *= 40.0;
    vec2 id = floor(uv);
    uv = fract(uv) - 0.5;
    vec4 seed = texture2D(u_microSeeds, (id - u_microGrid.xy + 0.5) / u_microGrid.zw);
    vec3 n = seed.rgb;
    vec2 p = (n.xy - 0.5) * 0.7;
    float d = length(uv - p);
    float fade = Saw(0.025, fract(t + n.z));
    float c = S(0.3, 0.0, d) * fract(n.z * 10.0) * fade;
    return c * seed.a;
  }

  vec2 Drops(vec2 uv, float t, float l0, float l1, float l2) {
    float s = StaticDrops(uv, u_rain.y) * l0;
    // Flowing heads and their runoff come from the actual CPU water bodies.
    vec2 mapUV = vec2(
      uv.x * u_cssSize.y / (u_cssSize.x * u_rainZoom) + 0.5,
      0.5 - uv.y / u_rainZoom
    );
    vec4 moving = texture2D(u_heartfelt, mapUV);
    float c = S(0.3, 1.0, s + moving.a);
    return vec2(c, moving.r * moving.a);
  }

  // Convert a Canvas-UV displacement into the current projected pane's screen
  // displacement. Inverting the local UV Jacobian also handles back views and
  // oblique panes, without making the rain slide when the camera turns.
  vec2 projectGlassOffset(vec2 canvasOffset, vec2 dx, vec2 dy) {
    vec2 offset = vec2(canvasOffset.x, -canvasOffset.y);
    float determinant = dx.x * dy.y - dy.x * dx.y;
    if (abs(determinant) < 0.000000000001) return vec2(0.0);
    vec2 pixelOffset = vec2(
      dy.y * offset.x - dy.x * offset.y,
      -dx.y * offset.x + dx.x * offset.y
    ) / determinant;
    // Close-up and near-edge views must not pull samples across the whole view.
    return clamp(pixelOffset / u_resolution, vec2(-0.12), vec2(0.12));
  }

  bool surfaceBlocksGlass(vec2 sceneUV) {
    if (u_hasDepth < 0.5) return false;
    float depth = texture2D(u_depth, sceneUV).r;
    if (depth >= 1.0) return false;
    vec4 capturedPosition = u_projectionInverse * vec4(sceneUV * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec3 capturedPoint = capturedPosition.xyz / capturedPosition.w;
    vec3 planeNormal = normalize(vPaneViewNormal);
    float planeDistance = dot(planeNormal, vPaneViewPosition);
    // Normal distance is independent of viewing angle and normal orientation.
    // Positive separation means the captured surface lies behind this pane.
    float separation = (dot(planeNormal, capturedPoint) - planeDistance) *
      (planeDistance < 0.0 ? -1.0 : 1.0);
    // Include frames slightly behind the synthetic pane as well as foreground
    // furniture: both must retain their original, dry opaque rendering.
    return separation <= u_depthMargin;
  }

  vec2 sceneSampleUV(vec2 sceneUV, vec2 offset) {
    // Half a final pixel keeps all lookups inside the captured scene's edges.
    vec2 edge = 0.5 / u_resolution;
    vec2 sampleUV = clamp(sceneUV + offset, edge, vec2(1.0) - edge);
    return surfaceBlocksGlass(sampleUV) ? sceneUV : sampleUV;
  }

  void main() {
    // Data canvases use Y-down coordinates and are uploaded without a Y flip.
    // Scene render targets use the framebuffer's Y-up coordinates instead.
    vec2 glassUV = vec2(vPaneUV.x, 1.0 - vPaneUV.y);
    vec2 sceneUV = gl_FragCoord.xy / u_resolution;
    // Evaluate derivatives before the non-uniform droplet coverage branch.
    vec2 paneDx = dFdx(vPaneUV);
    vec2 paneDy = dFdy(vPaneUV);
    if (surfaceBlocksGlass(sceneUV)) discard;

    vec2 rainUV = (glassUV - 0.5) * vec2(u_cssSize.x / u_cssSize.y, -1.0) * u_rainZoom;
    float l0 = S(-0.5, 1.0, u_rain.z) * 2.0;
    float l1 = S(0.25, 0.75, u_rain.z);
    float l2 = S(0.0, 0.5, u_rain.z);
    vec2 drops = Drops(rainUV, u_rain.x, l0, l1, l2);
    vec2 e = vec2(0.001, 0.0);
    vec2 normal = vec2(
      Drops(rainUV + e, u_rain.x, l0, l1, l2).x - drops.x,
      Drops(rainUV + e.yx, u_rain.x, l0, l1, l2).x - drops.x
    );
    vec2 rainBend = vec2(normal.x, -normal.y) / u_rainZoom;
    float trail = max(drops.y, S(0.1, 0.2, drops.x));
    float clear = max(S(0.08, 0.85, texture2D(u_clear, glassUV).a), clamp(trail, 0.0, 1.0));
    vec2 rainSceneUV = sceneSampleUV(sceneUV, projectGlassOffset(rainBend, paneDx, paneDy));
    vec3 sharp = texture2D(u_scene, rainSceneUV).rgb;
    vec3 base = mix(texture2D(u_background, rainSceneUV).rgb, sharp, clear);
    float mist = u_fogLevel * (1.0 - clear);
    if (mist > 0.0) {
      base = mix(base, texture2D(u_fog, rainSceneUV).rgb, mist);
      base = mix(base, u_fogTint, mist * 0.10);
    }

    // Codrops' original G/R direction, B thickness and alpha correction.
    vec4 water = texture2D(u_waterMap, glassUV);
    vec2 refraction = (water.gr - 0.5) * 2.0;
    vec2 bend = refraction * (256.0 + water.b * 256.0) * u_dropScale / u_cssSize;
    float coverage = clamp(water.a * 6.0 - 3.0, 0.0, 1.0);
    if (coverage > 0.0) {
      vec2 lensUV = sceneSampleUV(sceneUV, projectGlassOffset(bend, paneDx, paneDy));
      base = mix(base, texture2D(u_lens, lensUV).rgb * 1.04, coverage);
    }

    // Captures contain linear scene radiance. Convert once, at final output.
    gl_FragColor = vec4(base, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

/**
 * Wet-glass material for one existing world-space pane.
 *
 * simulation: createRainPane() result, with initialized map/rain canvases.
 * update(sceneTexture, {width,height}, {blurTexture,lensTexture,fogLevel,
 *   depthTexture,projectionInverse,depthMargin}):
 * width/height are the FINAL framebuffer size in physical pixels, even when the
 * scene capture is downsampled. All supplied scene textures contain linear color
 * and remain owned by the caller, including an optional perspective depth
 * texture with its camera's inverse projection matrix. depthMargin defaults to
 * 0.06 world units, measured normal to the pane. Only this material's data
 * textures are disposed.
 */
export function createRainWindow(THREE, simulation) {
  const map = simulation?.map;
  if (!map?.canvas || !map.mask || !map.heightMap || !map.field?.texture) {
    throw new TypeError('A rain window requires initialized water-map canvases.');
  }

  let disposed = false;
  function dataTexture(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.premultiplyAlpha = false;
    return texture;
  }

  const bindings = [
    { name: 'u_waterMap', source: () => map.canvas, revision: () => map.revision },
    { name: 'u_clear', source: () => map.mask, revision: () => map.maskRevision },
    { name: 'u_microSeeds', source: () => map.field.texture, revision: () => map.field.revision },
    { name: 'u_heartfelt', source: () => map.heightMap, revision: () => map.revision },
  ].map(binding => ({ ...binding, texture: dataTexture(binding.source()), lastRevision: null, width: 0, height: 0 }));

  const uniforms = {
    u_scene: { value: null },
    u_background: { value: null },
    u_lens: { value: null },
    u_fog: { value: null },
    u_depth: { value: null },
    u_cssSize: { value: new THREE.Vector2(positive(simulation.width, map.width || 1), positive(simulation.height, map.height || 1)) },
    u_resolution: { value: new THREE.Vector2(1, 1) },
    u_microGrid: { value: new THREE.Vector4(map.field.originX, map.field.originY, map.field.cols, map.field.rows) },
    u_rain: { value: new THREE.Vector4(12, 12, 0.65, 0) },
    u_rainZoom: { value: positive(simulation.rainZoom, 2.7) },
    u_dropScale: { value: positive(simulation.dropScale, 0.4) },
    u_fogLevel: { value: 0 },
    u_hasDepth: { value: 0 },
    u_projectionInverse: { value: new THREE.Matrix4() },
    u_depthMargin: { value: 0.06 },
    u_fogTint: { value: new THREE.Color().setRGB(0.87, 0.91, 0.92, THREE.SRGBColorSpace) },
  };
  bindings.forEach(binding => { uniforms[binding.name] = { value: binding.texture }; });

  const material = new THREE.ShaderMaterial({
    name: 'Rain window — pane-local optics',
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    blending: THREE.NoBlending,
    forceSinglePass: true,
    toneMapped: true,
    fog: false,
  });

  function update(sceneColorTexture, sceneResolution, options = {}) {
    if (disposed) return;
    const width = positive(sceneResolution?.width ?? sceneResolution?.x, 1);
    const height = positive(sceneResolution?.height ?? sceneResolution?.y, 1);
    uniforms.u_resolution.value.set(width, height);
    uniforms.u_scene.value = sceneColorTexture;
    uniforms.u_background.value = options.blurTexture || sceneColorTexture;
    uniforms.u_lens.value = options.lensTexture || sceneColorTexture;
    uniforms.u_fog.value = options.fogTexture || options.blurTexture || sceneColorTexture;
    uniforms.u_depth.value = options.depthTexture || sceneColorTexture;
    uniforms.u_hasDepth.value = options.depthTexture ? 1 : 0;
    if (options.projectionInverse) uniforms.u_projectionInverse.value.copy(options.projectionInverse);
    uniforms.u_depthMargin.value = Number.isFinite(options.depthMargin) ? Math.max(0, options.depthMargin) : 0.06;
    uniforms.u_fogLevel.value = Math.max(0, Math.min(0.65, Number.isFinite(options.fogLevel) ? options.fogLevel : 0));
    uniforms.u_cssSize.value.set(positive(simulation.width, map.width || 1), positive(simulation.height, map.height || 1));
    uniforms.u_microGrid.value.set(map.field.originX, map.field.originY, map.field.cols, map.field.rows);
    const rain = simulation.rain || map.rain || {};
    uniforms.u_rain.value.set(rain.time ?? 12, rain.staticTime ?? 12, rain.amount ?? 0.65, 0);

    for (const binding of bindings) {
      const source = binding.source();
      const revision = binding.revision();
      if (binding.texture.image !== source || binding.lastRevision !== revision || binding.width !== source.width || binding.height !== source.height) {
        binding.texture.image = source;
        binding.texture.needsUpdate = true;
        binding.lastRevision = revision;
        binding.width = source.width;
        binding.height = source.height;
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    bindings.forEach(binding => binding.texture.dispose());
    material.dispose();
  }

  return { material, update, dispose };
}
