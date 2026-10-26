/** Original instanced rain: GPU motion and a procedural water profile, no image assets. */
export function createExteriorRain(THREE, scene, {
  width = 17,
  depth = 18.5,
  groundY = -0.055,
  shelter = { minX: -2.85, maxX: 2.91, minZ: -2.47, maxZ: 2.47, topY: 4.45 },
  buildingYOffset = 0,
  reducedMotion = false,
  mobile = false,
} = {}) {
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const volumeWidth = Math.max(1, finite(width, 17));
  const volumeDepth = Math.max(1, finite(depth, 18.5));
  const floor = finite(groundY, -0.055);
  const height = 13.8;
  const count = mobile ? 1200 : 2400;
  const validShelter = shelter && ['minX', 'maxX', 'minZ', 'maxZ', 'topY'].every(key => Number.isFinite(shelter[key])) &&
    shelter.minX < shelter.maxX && shelter.minZ < shelter.maxZ;
  const group = new THREE.Group();
  group.name = 'GPU exterior rain';
  group.visible = false;
  scene.add(group);

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const seeds = new Float32Array(count * 4);
  const anchors = new Float32Array(count * 2);
  let seed = 0x523ea27b;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    anchors[i * 2] = (random() - 0.5) * (volumeWidth + 2);
    anchors[i * 2 + 1] = (random() - 0.5) * (volumeDepth + 2);
    seeds[i * 4] = random();
    seeds[i * 4 + 1] = random();
    seeds[i * 4 + 2] = random();
    seeds[i * 4 + 3] = random();
  }
  geometry.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(anchors, 2));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = count;

  const uniforms = {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uBuildingYOffset: { value: finite(buildingYOffset, 0) },
    uGround: { value: floor },
    uHeight: { value: height },
    uShelter: { value: new THREE.Vector4(validShelter ? shelter.minX : 0, validShelter ? shelter.maxX : 0,
      validShelter ? shelter.minZ : 0, validShelter ? shelter.maxZ : 0) },
    uRoof: { value: validShelter ? shelter.topY : -10000 },
    uHasShelter: { value: validShelter ? 1 : 0 },
    uBackground: { value: null },
    uHasBackground: { value: 0 },
    uBackgroundSize: { value: new THREE.Vector2(1, 1) },
  };
  const material = new THREE.ShaderMaterial({
    name: 'Procedural lit rain droplets',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    fog: true,
    toneMapped: true,
    vertexShader: /* glsl */`
      attribute vec2 aAnchor;
      attribute vec4 aSeed;
      uniform float uTime;
      uniform float uNight;
      uniform float uGround;
      uniform float uHeight;
      varying vec2 vRainUv;
      varying vec3 vWorldPosition;
      varying vec4 vClipPosition;
      varying float vVisibility;
      varying float vSeed;
      #include <fog_pars_vertex>
      void main() {
        float speed = mix(7.8, 12.8, aSeed.y);
        float cycle = fract(aSeed.x + uTime * speed / uHeight);
        float y = uGround + (1.0 - cycle) * uHeight;
        // A fixed slight slant is geometry, not a simulated wind field.
        vec3 center = vec3(aAnchor.x + (y - uGround) * 0.045, y, aAnchor.y + (y - uGround) * 0.018);
        vec4 worldCenter = modelMatrix * vec4(center, 1.0);
        vec3 lineDirection = mat3(viewMatrix) * normalize(vec3(0.045, 1.0, 0.018));
        float projectedLength = length(lineDirection.xy);
        vec2 longAxis = projectedLength > 0.001 ? lineDirection.xy / projectedLength : vec2(0.0, 1.0);
        vec2 shortAxis = vec2(longAxis.y, -longAxis.x);
        float dropLength = mix(0.10, 0.34, aSeed.z);
        float dropWidth = mix(0.0055, 0.0115, aSeed.w);
        vec2 viewOffset = shortAxis * position.x * dropWidth + longAxis * position.y * dropLength * max(0.12, projectedLength);
        vec4 mvPosition = viewMatrix * worldCenter;
        mvPosition.xy += viewOffset;
        // Transpose the rigid view rotation to retain world-space roof clipping.
        vec3 offset = vec3(viewOffset, 0.0);
        vWorldPosition = worldCenter.xyz + vec3(dot(viewMatrix[0].xyz, offset), dot(viewMatrix[1].xyz, offset), dot(viewMatrix[2].xyz, offset));
        gl_Position = projectionMatrix * mvPosition;
        vClipPosition = gl_Position;
        vRainUv = uv * 2.0 - 1.0;
        float distanceToEye = distance(cameraPosition, worldCenter.xyz);
        vVisibility = smoothstep(0.24, 0.85, distanceToEye) * (1.0 - smoothstep(35.0, 65.0, distanceToEye));
        vVisibility *= smoothstep(uGround + 0.035, uGround + 0.24, y);
        vVisibility *= 1.0 - smoothstep(uGround + uHeight - 1.3, uGround + uHeight, y);
        vVisibility *= mix(0.72, 1.0, aSeed.w);
        vSeed = aSeed.z;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uNight;
      uniform float uBuildingYOffset;
      uniform float uGround;
      uniform vec4 uShelter;
      uniform float uRoof;
      uniform float uHasShelter;
      uniform sampler2D uBackground;
      uniform float uHasBackground;
      uniform vec2 uBackgroundSize;
      varying vec2 vRainUv;
      varying vec3 vWorldPosition;
      varying vec4 vClipPosition;
      varying float vVisibility;
      varying float vSeed;
      #include <fog_pars_fragment>
      void main() {
        if (vVisibility < 0.001 || vWorldPosition.y <= uGround + 0.015) discard;
        if (uHasShelter > 0.5 && vWorldPosition.x > uShelter.x && vWorldPosition.x < uShelter.y &&
            vWorldPosition.z > uShelter.z && vWorldPosition.z < uShelter.w && vWorldPosition.y < uRoof) discard;
        vec2 capsule = vec2(vRainUv.x, max(abs(vRainUv.y) - 0.70, 0.0) / 0.30);
        float silhouette = 1.0 - smoothstep(0.32, 1.0, length(capsule));
        float alpha = silhouette * vVisibility * mix(0.43, 0.56, uNight);
        if (alpha < 0.005) discard;

        vec3 normal = normalize(vec3(vRainUv.x * 0.84, vRainUv.y * 0.13, sqrt(max(0.025, 1.0 - vRainUv.x * vRainUv.x))));
        float rim = pow(1.0 - max(normal.z, 0.0), 2.0);
        float specular = pow(max(dot(normal, normalize(vec3(-0.45, 0.40, 0.78))), 0.0), 11.0);
        vec3 buildingRelativePosition = vWorldPosition - vec3(0.0, uBuildingYOffset, 0.0);
        float cafeGlow = exp(-distance(buildingRelativePosition, vec3(1.35, 2.1, 0.25)) * 0.42) +
                         exp(-distance(buildingRelativePosition, vec3(0.8, 4.0, 0.0)) * 0.48) * 0.58;
        vec3 water = mix(vec3(0.42, 0.58, 0.65), vec3(0.22, 0.42, 0.56), uNight);
        vec3 warm = vec3(1.0, 0.54, 0.22) * cafeGlow * mix(0.08, 0.80, uNight);
        vec3 color = water * (0.48 + rim * 0.65) + vec3(0.58, 0.76, 0.88) * specular * 0.75 + warm;
        if (uHasBackground > 0.5) {
          vec2 screenUv = vClipPosition.xy / vClipPosition.w * 0.5 + 0.5;
          vec2 texel = 1.0 / max(uBackgroundSize, vec2(1.0));
          vec2 refractedUv = clamp(screenUv + normal.xy * texel * mix(0.55, 1.1, vSeed), texel, vec2(1.0) - texel);
          vec3 background = texture2D(uBackground, refractedUv).rgb;
          color = mix(color, background * 0.88 + color * 0.40, 0.58);
        }
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Instanced exterior water streaks';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  group.add(mesh);
  let disposed = false;
  let time = 0;

  function update(elapsed = 0, delta = 0, { enabled = false, night = 0, camera } = {}) {
    if (disposed) return;
    group.visible = Boolean(enabled);
    material.uniforms.uNight.value = THREE.MathUtils.clamp(finite(night, night ? 1 : 0), 0, 1);
    if (!reducedMotion && group.visible) {
      // Absolute elapsed avoids frame-dependent motion; fallback stays bounded.
      time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : time + Math.min(0.05, Math.max(0, finite(delta, 0)));
      material.uniforms.uTime.value = time % 3600;
    }
    // The camera parameter is accepted for the shared weather-controller API.
    // Three supplies cameraPosition/viewMatrix for either camera at draw time.
    void camera;
  }

  function setBackground(texture, { width: bufferWidth = 1, height: bufferHeight = 1 } = {}) {
    if (disposed) return;
    material.uniforms.uBackground.value = texture || null;
    material.uniforms.uHasBackground.value = texture ? 1 : 0;
    material.uniforms.uBackgroundSize.value.set(Math.max(1, finite(bufferWidth, 1)), Math.max(1, finite(bufferHeight, 1)));
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    geometry.dispose();
    material.dispose();
    // The controller owns the shared background render target.
  }

  return { group, mesh, update, setBackground, dispose };
}
