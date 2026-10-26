import {createWetGroundVisibility} from './wet-ground-visibility.js?v=36';

/**
 * Original rain-soaked garden surface. All masks and ripple shapes are procedural;
 * no assets or shader code from the visual reference are used.
 */
export function createWetGround(THREE, scene, {
  width = 17, depth = 18.5, groundY = -0.055, mobile = false, reducedMotion = false,
} = {}) {
  const group = new THREE.Group();
  group.name = 'Rain puddles and small splashes';
  group.visible = false;
  scene.add(group);
  const waterY = groundY + 0.012;
  const maxResolution = mobile ? 384 : 768;
  const reflectionTarget = new THREE.WebGLRenderTarget(maxResolution, maxResolution, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true, stencilBuffer: false, type: THREE.HalfFloatType,
  });
  reflectionTarget.texture.name = 'Shared linear wet-ground reflection';
  reflectionTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
  reflectionTarget.texture.generateMipmaps = false;
  const reflectionMatrix = new THREE.Matrix4();
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uReflection: { value: null },
      uReflectionMatrix: { value: reflectionMatrix },
      uTexel: { value: new THREE.Vector2(1 / maxResolution, 1 / maxResolution) },
      uSize: { value: new THREE.Vector2(width, depth) },
      uTime: { value: 0 }, uNight: { value: 0 }, uHasReflection: { value: 0 },
    },
  ]);
  // Bind render-target resources after merging: they must never be cloned.
  uniforms.uReflection.value = reflectionTarget.texture;
  uniforms.uReflectionMatrix.value = reflectionMatrix;
  const material = new THREE.ShaderMaterial({
    name: 'Original puddle Fresnel and impact-ripple material',
    uniforms, transparent: true, depthWrite: false, depthTest: true,
    side: THREE.FrontSide, fog: true,
    vertexShader: /* glsl */ `
      uniform mat4 uReflectionMatrix;
      varying vec3 vWorld;
      varying vec4 vReflection;
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vReflection = uReflectionMatrix * world;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uReflection;
      uniform vec2 uTexel;
      uniform vec2 uSize;
      uniform float uTime;
      uniform float uNight;
      uniform float uHasReflection;
      varying vec3 vWorld;
      varying vec4 vReflection;
      #include <fog_pars_fragment>
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise21(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
      }
      float terrainNoise(vec2 p) {
        return noise21(p) * 0.57 + noise21(p * 2.03 + 7.1) * 0.28
          + noise21(p * 4.17 - 3.2) * 0.15;
      }
      float pool(vec2 p, vec2 center, vec2 radius, float grain) {
        float d = length((p - center) / radius);
        return 1.0 - smoothstep(0.64 + grain * 0.3, 0.98 + grain * 0.3, d);
      }
      float wetMask(vec2 p) {
        // Rounded island border, and the entire sheltered building footprint.
        vec2 q = abs(p) - (uSize * 0.5 - vec2(0.88));
        float islandDistance = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.78;
        float island = 1.0 - smoothstep(-0.17, 0.0, islandDistance);
        float shelter = (1.0 - smoothstep(2.83, 3.04, abs(p.x - 0.03)))
          * (1.0 - smoothstep(2.46, 2.67, abs(p.y)));
        float grain = terrainNoise(p * 1.47);
        float path = smoothstep(2.95, 3.55, p.y)
          * (1.0 - smoothstep(0.72, 1.84, abs(p.x + sin(p.y * 0.8) * 0.18)));
        float result = path * smoothstep(0.35, 0.62, grain);
        result = max(result, pool(p, vec2(-3.8, 4.1), vec2(0.96, 0.53), grain) * 0.73);
        result = max(result, pool(p, vec2(3.7, 5.9), vec2(0.65, 1.13), grain) * 0.78);
        result = max(result, pool(p, vec2(-4.9, -4.8), vec2(0.88, 0.69), grain) * 0.62);
        result = max(result, pool(p, vec2(3.9, -4.4), vec2(0.69, 0.97), grain) * 0.63);
        result = max(result, pool(p, vec2(0.7, -6.8), vec2(1.11, 0.49), grain) * 0.58);
        result = max(result, pool(p, vec2(-4.2, 0.1), vec2(0.55, 0.79), grain) * 0.56);
        return result * island * (1.0 - shelter);
      }
      vec2 impactSlopes(vec2 p) {
        vec2 cell = floor(p / 0.77);
        vec2 slopes = vec2(0.0);
        for (int x = -1; x <= 1; x++) {
          for (int y = -1; y <= 1; y++) {
            vec2 c = cell + vec2(float(x), float(y));
            float seed = hash21(c);
            vec2 center = (c + vec2(hash21(c + 11.7), hash21(c + 31.2))) * 0.77;
            float age = fract(uTime * (0.68 + seed * 0.3) + seed * 7.1);
            vec2 relative = p - center;
            float distanceToCenter = length(relative);
            float edge = distanceToCenter - age * 0.58;
            float envelope = exp(-abs(edge) * 33.0) * pow(1.0 - age, 2.4)
              * smoothstep(0.0, 0.07, age);
            slopes += relative / max(distanceToCenter, 0.025)
              * cos(edge * 97.0) * envelope * 0.08;
          }
        }
        // Very shallow long water undulations, anchored in world coordinates.
        slopes += vec2(sin(p.y * 11.0 + uTime * 1.25), cos(p.x * 13.0 - uTime)) * 0.0028;
        return slopes;
      }
      void main() {
        float wet = wetMask(vWorld.xz);
        if (wet < 0.035) discard;
        vec2 ripple = impactSlopes(vWorld.xz);
        vec3 normal = normalize(vec3(-ripple.x, 1.0, -ripple.y));
        vec3 toEye = normalize(cameraPosition - vWorld);
        float fresnel = 0.10 + 0.90 * pow(1.0 - max(dot(normal, toEye), 0.0), 4.0);
        vec2 projected = vReflection.xy / max(vReflection.w, 0.0001);
        projected += ripple * 0.018;
        float inside = step(0.002, projected.x) * step(0.002, projected.y)
          * step(projected.x, 0.998) * step(projected.y, 0.998)
          * step(0.0, vReflection.w) * uHasReflection;
        projected = clamp(projected, uTexel * 2.0, vec2(1.0) - uTexel * 2.0);
        vec2 blur = uTexel * (1.4 + (1.0 - wet) * 2.4);
        vec3 reflected = texture2D(uReflection, projected).rgb * 0.40;
        reflected += texture2D(uReflection, projected + vec2(blur.x, 0.0)).rgb * 0.15;
        reflected += texture2D(uReflection, projected - vec2(blur.x, 0.0)).rgb * 0.15;
        reflected += texture2D(uReflection, projected + vec2(0.0, blur.y)).rgb * 0.15;
        reflected += texture2D(uReflection, projected - vec2(0.0, blur.y)).rgb * 0.15;
        vec3 waterTint = mix(vec3(0.055, 0.073, 0.067), vec3(0.015, 0.025, 0.032), uNight);
        vec3 color = mix(waterTint, reflected * vec3(0.86, 0.95, 1.0),
          inside * (0.34 + fresnel * 0.54));
        color += vec3(0.15, 0.21, 0.23) * length(ripple) * (0.45 + fresnel);
        float alpha = wet * (0.38 + fresnel * 0.48);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const geometry = new THREE.PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = waterY;
  mesh.name = 'Sparse entrance and garden puddles';
  mesh.renderOrder = 2;
  group.add(mesh);

  // A deliberately small, fixed population; particles never accumulate.
  const splashCount = mobile ? 18 : 42;
  const splashGeometry = new THREE.BufferGeometry();
  const positions = new Float32Array(splashCount * 3);
  const seeds = new Float32Array(splashCount);
  let randomState = 92841;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const patches = [[-3.8, 4.1], [3.7, 5.9], [-4.9, -4.8], [3.9, -4.4], [0.7, -6.8], [-4.2, 0.1]];
  for (let i = 0; i < splashCount; i++) {
    const onPath = i % 3 !== 0;
    const patch = patches[i % patches.length];
    positions[i * 3] = onPath ? (random() - 0.5) * 2.0 : patch[0] + (random() - 0.5) * 0.9;
    positions[i * 3 + 1] = waterY + 0.022;
    positions[i * 3 + 2] = onPath ? 3.35 + random() * Math.max(0.1, depth / 2 - 4.0) : patch[1] + (random() - 0.5) * 0.7;
    seeds[i] = random();
  }
  splashGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  splashGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const splashUniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    { uTime: { value: 0 }, uNight: { value: 0 }, uHeight: { value: 720 }, uMotion: { value: reducedMotion ? 0 : 1 } },
  ]);
  const splashMaterial = new THREE.ShaderMaterial({
    name: 'Bounded tiny impact splash droplets', uniforms: splashUniforms,
    transparent: true, depthWrite: false, depthTest: true, fog: true,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime, uHeight, uMotion;
      varying float vAlpha;
      #include <fog_pars_vertex>
      void main() {
        float age = fract(uTime * (0.57 + aSeed * 0.4) + aSeed * 7.5);
        float splashVisible = 1.0 - step(0.32, age);
        float phase = age / 0.32;
        vec3 point = position;
        point.y += sin(phase * 3.14159265) * (0.05 + aSeed * 0.055) * splashVisible;
        vec4 mvPosition = modelViewMatrix * vec4(point, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float distanceScale = isOrthographic ? 1.0 : max(-mvPosition.z, 0.1);
        gl_PointSize = clamp(0.018 * uHeight * projectionMatrix[1][1] / distanceScale, 1.0, 3.5);
        vAlpha = sin(phase * 3.14159265) * splashVisible * 0.42 * uMotion;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying float vAlpha;
      #include <fog_pars_fragment>
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float alpha = (1.0 - smoothstep(0.13, 0.49, d)) * max(vAlpha, 0.0);
        if (alpha < 0.015) discard;
        gl_FragColor = vec4(mix(vec3(0.5, 0.67, 0.71), vec3(0.23, 0.33, 0.41), uNight), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const splashes = new THREE.Points(splashGeometry, splashMaterial);
  splashes.name = 'Small rain impact accents';
  splashes.renderOrder = 3;
  splashes.frustumCulled = false;
  group.add(splashes);

  const mirrorPerspective = new THREE.PerspectiveCamera();
  const mirrorOrthographic = new THREE.OrthographicCamera();
  const eye = new THREE.Vector3(), forward = new THREE.Vector3(), up = new THREE.Vector3();
  const targetPoint = new THREE.Vector3(), viewport = new THREE.Vector4(), scissor = new THREE.Vector4();
  const drawingBuffer = new THREE.Vector2(), plane = new THREE.Plane();
  const clip = new THREE.Vector4(), farCorner = new THREE.Vector4();
  const inverseProjection = new THREE.Matrix4();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  let enabled = false, capturing = false, disposed = false, frameCounter = 0, hasCapture = false;
  let reflectionVisibility;

  function update(elapsed, delta, { enabled: nextEnabled = false, night = 0 } = {}) {
    if (disposed) return;
    enabled = Boolean(nextEnabled);
    group.visible = enabled;
    uniforms.uTime.value = reducedMotion ? 0 : elapsed;
    splashUniforms.uTime.value = reducedMotion ? 0 : elapsed;
    uniforms.uNight.value = splashUniforms.uNight.value = Math.max(0, Math.min(1, night));
    if (!enabled) {frameCounter = 0; reflectionVisibility?.reset();}
  }

  function reflect(renderer, camera, { hide = [] } = {}) {
    if (disposed || !enabled || capturing || !group.visible || !camera) return false;
    camera.updateMatrixWorld();
    eye.setFromMatrixPosition(camera.matrixWorld);
    if (eye.y <= waterY + 0.025) return false;
    reflectionVisibility ??= createWetGroundVisibility(THREE, renderer, mesh);
    if (!reflectionVisibility.visible(camera)) return false;
    if (hasCapture && frameCounter++ % (mobile ? 3 : 2) !== 0) return false;
    const mirror = camera.isOrthographicCamera ? mirrorOrthographic : mirrorPerspective;
    mirror.near = camera.near;
    mirror.far = camera.far;
    mirror.layers.mask = camera.layers.mask;
    mirror.position.copy(eye);
    mirror.position.y = 2 * waterY - eye.y;
    camera.getWorldDirection(forward);
    forward.y *= -1;
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    up.y *= -1;
    mirror.up.copy(up);
    targetPoint.copy(mirror.position).add(forward);
    mirror.lookAt(targetPoint);
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);
    mirror.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    reflectionMatrix.copy(bias).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

    // General oblique near plane: unlike the perspective-only closed form,
    // inverse-projection far corners also work for the exterior orthographic view.
    plane.set(new THREE.Vector3(0, 1, 0), -(waterY + 0.012));
    plane.applyMatrix4(mirror.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    inverseProjection.copy(mirror.projectionMatrix).invert();
    farCorner.set(Math.sign(clip.x) || 1, Math.sign(clip.y) || 1, 1, 1).applyMatrix4(inverseProjection);
    const divisor = clip.dot(farCorner);
    if (!Number.isFinite(divisor) || Math.abs(divisor) < 0.000001) return false;
    clip.multiplyScalar(2 / divisor);
    const projection = mirror.projectionMatrix.elements;
    projection[2] = clip.x - projection[3];
    projection[6] = clip.y - projection[7];
    projection[10] = clip.z - projection[11];
    projection[14] = clip.w - projection[15];
    mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();

    const aspect = camera.isOrthographicCamera
      ? Math.abs((camera.right - camera.left) / (camera.top - camera.bottom))
      : camera.aspect || 1;
    const targetWidth = Math.max(128, Math.round(maxResolution * Math.min(1, aspect)));
    const targetHeight = Math.max(128, Math.round(maxResolution * Math.min(1, 1 / aspect)));
    if (reflectionTarget.width !== targetWidth || reflectionTarget.height !== targetHeight) {
      reflectionTarget.setSize(targetWidth, targetHeight);
      uniforms.uTexel.value.set(1 / targetWidth, 1 / targetHeight);
    }
    if (reflectionTarget.texture.type === THREE.HalfFloatType && !renderer.extensions.has('EXT_color_buffer_float')) {
      reflectionTarget.texture.type = THREE.UnsignedByteType;
      reflectionTarget.dispose();
    }
    renderer.getDrawingBufferSize(drawingBuffer);
    splashUniforms.uHeight.value = drawingBuffer.y;
    const oldTarget = renderer.getRenderTarget();
    renderer.getViewport(viewport);
    renderer.getScissor(scissor);
    const oldScissorTest = renderer.getScissorTest();
    const oldAutoUpdate = renderer.shadowMap.autoUpdate;
    const oldNeedsUpdate = renderer.shadowMap.needsUpdate;
    const oldToneMapping = renderer.toneMapping;
    const oldAutoClear = renderer.autoClear;
    const oldXrEnabled = renderer.xr.enabled;
    const visibility = new Map();
    for (const object of [group, ...hide]) {
      if (object && !visibility.has(object)) {
        visibility.set(object, object.visible);
        object.visible = false;
      }
    }
    capturing = true;
    try {
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.autoClear = true;
      renderer.setRenderTarget(reflectionTarget);
      renderer.setScissorTest(false);
      renderer.render(scene, mirror);
      hasCapture = true;
      uniforms.uHasReflection.value = 1;
      return true;
    } finally {
      for (const [object, visible] of visibility) object.visible = visible;
      renderer.xr.enabled = oldXrEnabled;
      renderer.shadowMap.autoUpdate = oldAutoUpdate;
      renderer.shadowMap.needsUpdate = oldNeedsUpdate;
      renderer.toneMapping = oldToneMapping;
      renderer.autoClear = oldAutoClear;
      renderer.setRenderTarget(oldTarget);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(oldScissorTest);
      capturing = false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    geometry.dispose();
    material.dispose();
    splashGeometry.dispose();
    splashMaterial.dispose();
    reflectionTarget.dispose();
    reflectionVisibility?.dispose();
  }
  function renderVisibility(camera, draw) {
    return reflectionVisibility ? reflectionVisibility.render(camera, draw) : draw();
  }
  return { group, mesh, update, reflect, renderVisibility, dispose,
    get visibilityStats() {return reflectionVisibility?.stats ?? null;} };
}
