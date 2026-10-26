/** Silhouettes and sharp feature edges; authored shading and water stay intact. */
export function createModelOutlines(THREE, renderer, {width = 1.7, color = '#37473e'} = {}) {
  const pixelWidth = Number.isFinite(width) ? Math.max(0, Math.min(4, width)) : 1.7;
  const cssSize = new THREE.Vector2(1, 1);
  const geometryCache = new Map();
  const edgeCache = new Map();
  const extraMaterials = new Map();
  const applied = new WeakSet();
  const ownedInstanceMatrices = new WeakMap();
  const hulls = [];
  let disposed = false;
  const stats = {meshes: 0, instances: 0, geometries: 0, drawCalls: 0, skipped: 0, featureMeshes: 0, segments: 0};

  const material = new THREE.ShaderMaterial({
    name: 'Medium model outline',
    uniforms: {
      uOutlineColor: {value: new THREE.Color(color)},
      uOutlineWidth: {value: pixelWidth},
      uOutlineCssSize: {value: cssSize},
    },
    vertexShader: `
attribute vec3 outlineNormal;
uniform vec2 uOutlineCssSize;
uniform float uOutlineWidth;
void main() {
  vec4 localPosition = vec4(position, 1.0);
  vec3 localNormal = outlineNormal;
  #ifdef USE_INSTANCING
    mat3 instanceBasis = mat3(instanceMatrix);
    // Inverse transpose for the orthogonal, nonuniform instance scales used
    // by the garden. This is also how Three transforms its instance normals.
    localNormal /= max(vec3(dot(instanceBasis[0], instanceBasis[0]),
      dot(instanceBasis[1], instanceBasis[1]), dot(instanceBasis[2], instanceBasis[2])), vec3(1e-12));
    localNormal = instanceBasis * localNormal;
    localPosition = instanceMatrix * localPosition;
  #endif
  vec4 viewPosition = modelViewMatrix * localPosition;
  vec4 clipPosition = projectionMatrix * viewPosition;
  vec3 viewNormal = normalMatrix * localNormal;
  float normalLength = length(viewNormal);
  if (normalLength > 1e-8 && clipPosition.w > 1e-6) {
    vec4 projectedNormal = projectionMatrix * vec4(viewNormal / normalLength, 0.0);
    vec2 screenNormal = (projectedNormal.xy * clipPosition.w
      - clipPosition.xy * projectedNormal.w) * uOutlineCssSize;
    float screenLength = length(screenNormal);
    if (screenLength > 1e-8) {
      clipPosition.xy += screenNormal / screenLength *
        (2.0 * uOutlineWidth / max(uOutlineCssSize, vec2(1.0))) * clipPosition.w;
    }
  }
  gl_Position = clipPosition;
}`,
    fragmentShader: `
uniform vec3 uOutlineColor;
void main() {
  gl_FragColor = vec4(uOutlineColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    side: THREE.BackSide,
    depthTest: true,
    depthFunc: THREE.LessDepth,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    toneMapped: true,
    fog: false,
  });
  material.userData.modelOutline = true;
  const hiddenMaterial = new THREE.MeshBasicMaterial({visible: false});
  hiddenMaterial.name = 'Excluded outline groups';

  const edgeMaterial = new THREE.ShaderMaterial({
    name: 'Model feature edges',
    uniforms: {
      uOutlineColor: {value: new THREE.Color(color)},
      uOutlineWidth: {value: pixelWidth * .72},
      uOutlineCssSize: {value: cssSize},
      uOutlineNear: {value: .025},
    },
    vertexShader: `
attribute vec3 edgeStart;
attribute vec3 edgeEnd;
attribute vec2 edgeCorner;
uniform vec2 uOutlineCssSize;
uniform float uOutlineWidth;
uniform float uOutlineNear;
varying float vEdgeVisible;
void main() {
  vec4 start = vec4(edgeStart, 1.0);
  vec4 end = vec4(edgeEnd, 1.0);
  #ifdef USE_INSTANCING
    start = instanceMatrix * start;
    end = instanceMatrix * end;
  #endif
  start = modelViewMatrix * start;
  end = modelViewMatrix * end;
  float nearZ = -max(uOutlineNear, .00001);
  vEdgeVisible = 1.0;
  if (start.z > nearZ && end.z > nearZ) {
    vEdgeVisible = 0.0;
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  } else {
    // Trim before dividing by w: a line crossing the eye cannot expand into
    // an enormous screen quad during first-person movement.
    if (start.z > nearZ) {
      start = mix(start, end, clamp((nearZ - start.z) / (end.z - start.z), 0.0, 1.0));
    } else if (end.z > nearZ) {
      end = mix(end, start, clamp((nearZ - end.z) / (start.z - end.z), 0.0, 1.0));
    }
    vec4 clipStart = projectionMatrix * start;
    vec4 clipEnd = projectionMatrix * end;
    vec2 screenDirection = (clipEnd.xy / max(clipEnd.w, 1e-6)
      - clipStart.xy / max(clipStart.w, 1e-6)) * uOutlineCssSize;
    float segmentLength = length(screenDirection);
    vec4 clipPosition = mix(clipStart, clipEnd, edgeCorner.x);
    if (segmentLength > 1e-6) {
      vec2 perpendicular = vec2(-screenDirection.y, screenDirection.x) / segmentLength;
      clipPosition.xy += perpendicular * edgeCorner.y * uOutlineWidth /
        max(uOutlineCssSize, vec2(1.0)) * clipPosition.w;
    } else {
      vEdgeVisible = 0.0;
    }
    gl_Position = clipPosition;
  }
}`,
    fragmentShader: `
uniform vec3 uOutlineColor;
varying float vEdgeVisible;
void main() {
  if (vEdgeVisible < .5) discard;
  gl_FragColor = vec4(uOutlineColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    side: THREE.DoubleSide,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: true,
    fog: false,
  });
  edgeMaterial.userData.modelOutline = true;

  function scaledMaterial(base, scale) {
    if (scale === 1) return base;
    const key = `${base.id}:${scale}`;
    if (!extraMaterials.has(key)) {
      const variant = base.clone();
      variant.uniforms.uOutlineWidth.value = base.uniforms.uOutlineWidth.value * scale;
      // Keep every variant on the same live CSS size across render targets.
      variant.uniforms.uOutlineCssSize.value = cssSize;
      extraMaterials.set(key, variant);
    }
    return extraMaterials.get(key);
  }

  function materialEligible(candidate, object) {
    if (!candidate || candidate.visible === false || candidate.isShaderMaterial || candidate.isRawShaderMaterial) return false;
    if (!(candidate.isMeshStandardMaterial || candidate.isMeshPhysicalMaterial ||
      candidate.isMeshLambertMaterial || candidate.isMeshPhongMaterial || candidate.isMeshBasicMaterial)) return false;
    if (candidate.transparent || candidate.opacity < .98 || candidate.transmission > 0) return false;
    return true;
  }

  function geometryInfo(geometry) {
    const position = geometry?.getAttribute('position');
    if (!position || position.count < 3 || (geometry.morphAttributes.position?.length ?? 0) > 0) return null;
    // Planar objects receive feature edges only, avoiding black back faces.
    const bounds = new THREE.Box3().setFromBufferAttribute(position);
    const extent = bounds.getSize(new THREE.Vector3());
    const maximum = Math.max(extent.x, extent.y, extent.z);
    return maximum > 1e-8 ? {planar: Math.min(extent.x, extent.y, extent.z) <= maximum * 1e-5} : null;
  }

  function smoothGeometry(source) {
    if (geometryCache.has(source)) return geometryCache.get(source);
    const geometry = source.clone();
    const positions = geometry.getAttribute('position');
    const index = geometry.getIndex();
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const originals = geometry.getAttribute('normal');
    const bounds = new THREE.Box3().setFromBufferAttribute(positions);
    const extent = bounds.getSize(new THREE.Vector3());
    const tolerance = Math.max(1e-7, Math.max(extent.x, extent.y, extent.z) * 1e-6);
    const keys = new Array(positions.count);
    const sums = new Map();
    for (let i = 0; i < positions.count; i++) {
      const key = `${Math.round(positions.getX(i) / tolerance)},${Math.round(positions.getY(i) / tolerance)},${Math.round(positions.getZ(i) / tolerance)}`;
      keys[i] = key;
      if (!sums.has(key)) sums.set(key, new THREE.Vector3());
    }
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
    const edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3(), cross = new THREE.Vector3();
    const count = index ? index.count : positions.count;
    // Corner-angle weighting makes duplicated UV/hard-edge vertices agree,
    // without bias from triangulation or replacing the original shading normals.
    for (let start = 0; start + 2 < count; start += 3) {
      const ia = index ? index.getX(start) : start;
      const ib = index ? index.getX(start + 1) : start + 1;
      const ic = index ? index.getX(start + 2) : start + 2;
      a.fromBufferAttribute(positions, ia); b.fromBufferAttribute(positions, ib); c.fromBufferAttribute(positions, ic);
      ab.subVectors(b, a); ac.subVectors(c, a); normal.crossVectors(ab, ac);
      const length = normal.length();
      if (length < 1e-14) continue;
      normal.divideScalar(length);
      for (const [vertex, center, first, second] of [[ia, a, b, c], [ib, b, c, a], [ic, c, a, b]]) {
        edge1.subVectors(first, center); edge2.subVectors(second, center);
        const angle = Math.atan2(cross.crossVectors(edge1, edge2).length(), edge1.dot(edge2));
        sums.get(keys[vertex]).addScaledVector(normal, angle);
      }
    }
    const normals = new Float32Array(positions.count * 3);
    const direction = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      direction.copy(sums.get(keys[i]));
      if (direction.lengthSq() < 1e-14) direction.fromBufferAttribute(originals, i);
      if (direction.lengthSq() < 1e-14) direction.set(0, 1, 0);
      direction.normalize().toArray(normals, i * 3);
    }
    geometry.setAttribute('outlineNormal', new THREE.BufferAttribute(normals, 3));
    geometryCache.set(source, geometry);
    stats.geometries++;
    return geometry;
  }

  function featureGeometry(source, eligible, grouped) {
    const key = `${grouped ? eligible.map(Number).join('') : 'all'}:${source.drawRange.start}:${source.drawRange.count}`;
    let variants = edgeCache.get(source);
    if (!variants) {variants = new Map(); edgeCache.set(source, variants);}
    if (variants.has(key)) return variants.get(key);
    const positions = source.getAttribute('position'), sourceIndex = source.getIndex();
    const count = sourceIndex ? sourceIndex.count : positions.count;
    const start = Math.max(0, source.drawRange.start);
    const end = Math.min(count, start + source.drawRange.count);
    const selectedIndices = [];
    for (let i = start; i + 2 < end; i += 3) {
      if (grouped && !source.groups.some(group => eligible[group.materialIndex] && i >= group.start && i + 2 < group.start + group.count)) continue;
      selectedIndices.push(sourceIndex ? sourceIndex.getX(i) : i,
        sourceIndex ? sourceIndex.getX(i + 1) : i + 1, sourceIndex ? sourceIndex.getX(i + 2) : i + 2);
    }
    const selected = new THREE.BufferGeometry();
    // EdgesGeometry only reads these positions. The output owns independent
    // buffers, and neither the authored geometry nor material groups change.
    selected.setAttribute('position', positions);
    selected.setIndex(selectedIndices);
    const edges = new THREE.EdgesGeometry(selected, 40);
    const endpoints = edges.getAttribute('position');
    const segments = endpoints ? endpoints.count / 2 : 0;
    const vertexCount = segments * 4;
    const position = new Float32Array(vertexCount * 3);
    const edgeStart = new Float32Array(vertexCount * 3);
    const edgeEnd = new Float32Array(vertexCount * 3);
    const corners = new Float32Array(vertexCount * 2);
    const indices = vertexCount > 65535 ? new Uint32Array(segments * 6) : new Uint16Array(segments * 6);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let segment = 0; segment < segments; segment++) {
      a.fromBufferAttribute(endpoints, segment * 2);
      b.fromBufferAttribute(endpoints, segment * 2 + 1);
      const vertex = segment * 4;
      for (let corner = 0; corner < 4; corner++) {
        const along = corner < 2 ? 0 : 1;
        (along ? b : a).toArray(position, (vertex + corner) * 3);
        a.toArray(edgeStart, (vertex + corner) * 3);
        b.toArray(edgeEnd, (vertex + corner) * 3);
        corners[(vertex + corner) * 2] = along;
        corners[(vertex + corner) * 2 + 1] = corner % 2 ? 1 : -1;
      }
      indices.set([vertex, vertex + 2, vertex + 1, vertex + 2, vertex + 3, vertex + 1], segment * 6);
    }
    edges.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('edgeStart', new THREE.BufferAttribute(edgeStart, 3));
    geometry.setAttribute('edgeEnd', new THREE.BufferAttribute(edgeEnd, 3));
    geometry.setAttribute('edgeCorner', new THREE.BufferAttribute(corners, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.userData.outlineSegments = segments;
    variants.set(key, geometry);
    stats.geometries++;
    return geometry;
  }

  function attach(source, geometry, outlinedMaterial, kind) {
    const overlay = source.isInstancedMesh
      ? new THREE.InstancedMesh(geometry, outlinedMaterial, source.count)
      : new THREE.Mesh(geometry, outlinedMaterial);
    if (source.isInstancedMesh) {
      ownedInstanceMatrices.set(overlay, overlay.instanceMatrix);
      overlay.instanceMatrix = source.instanceMatrix;
      overlay.instanceColor = source.instanceColor;
      overlay.boundingBox = source.boundingBox?.clone() ?? null;
      overlay.boundingSphere = source.boundingSphere?.clone() ?? null;
    }
    overlay.name = `${source.name || 'Model'} ${kind}`;
    overlay.userData.modelOutline = true;
    overlay.userData.styleEffect = 'outline';
    overlay.userData.outlineKind = kind;
    overlay.castShadow = false; overlay.receiveShadow = false;
    overlay.frustumCulled = source.frustumCulled;
    // Opaque materials sort by material id before depth. Draw crease colors
    // after the authored opaque surfaces, or those surfaces can cover a line
    // that deliberately does not write depth. Existing opaque depth still
    // occludes edges behind walls, furniture and the original front faces.
    overlay.renderOrder = kind === 'feature edges' ? Math.max(1, source.renderOrder + 1) : source.renderOrder;
    overlay.layers.mask = source.layers.mask;
    overlay.onBeforeRender = (_renderer, _scene, camera) => {
      renderer.getSize(cssSize);
      cssSize.set(Math.max(1, cssSize.x), Math.max(1, cssSize.y));
      if (kind === 'feature edges' && camera) outlinedMaterial.uniforms.uOutlineNear.value = Math.max(.00001, camera.near);
      if (source.isInstancedMesh) {
        overlay.count = source.count;
        overlay.instanceMatrix = source.instanceMatrix;
        overlay.instanceColor = source.instanceColor;
      }
    };
    source.add(overlay);
    hulls.push(overlay);
    return overlay;
  }

  function apply(root, {scope = 'model'} = {}) {
    if (disposed || !root || pixelWidth <= 0) return 0;
    // Snapshot before adding children, so traversal never visits new hulls.
    const candidates = [];
    root.traverse(object => {if (object.isMesh && !object.userData.modelOutline) candidates.push(object);});
    let added = 0;
    for (const source of candidates) {
      if (applied.has(source)) continue;
      applied.add(source);
      const info = geometryInfo(source.geometry);
      if (source.userData.rainSurface || source.isSkinnedMesh ||
        source.userData.outline === false || !info) {
        stats.skipped++; continue;
      }
      const sourceMaterials = Array.isArray(source.material) ? source.material : [source.material];
      const eligible = sourceMaterials.map(candidate => materialEligible(candidate, source));
      if (!eligible.some(Boolean)) {stats.skipped++; continue;}
      const thinDetail = scope === 'environment' && /grass tuft|grass blade|wildflower|flower stem|planting bed/i.test(source.name);
      const scale = thinDetail ? .38 : 1;
      const baseMaterial = scaledMaterial(material, scale);
      if (!info.planar) {
        const outlinedMaterial = Array.isArray(source.material)
          ? eligible.map(allowed => allowed ? baseMaterial : hiddenMaterial) : baseMaterial;
        const geometry = smoothGeometry(source.geometry);
        attach(source, geometry, outlinedMaterial, 'silhouette');
        stats.drawCalls += Array.isArray(source.material)
          ? geometry.groups.filter(group => eligible[group.materialIndex]).length : 1;
      }
      if (scope === 'model' || info.planar) {
        const geometry = featureGeometry(source.geometry, eligible, Array.isArray(source.material));
        if (geometry.userData.outlineSegments > 0) {
          attach(source, geometry, scaledMaterial(edgeMaterial, scale), 'feature edges');
          stats.featureMeshes++;
          stats.segments += geometry.userData.outlineSegments;
          stats.drawCalls++;
        }
      }
      stats.meshes++;
      if (source.isInstancedMesh) stats.instances += source.count;
      added++;
    }
    return added;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const hull of hulls) {
      hull.removeFromParent();
      // Three releases the instance buffers on dispose. Restore the hull's
      // unused own attribute first so the live source buffers remain owned by
      // the authored mesh while its renderer listeners can still be removed.
      if (hull.isInstancedMesh) {
        hull.instanceMatrix = ownedInstanceMatrices.get(hull);
        hull.instanceColor = null;
        hull.dispose();
      }
      hull.onBeforeRender = () => {};
    }
    hulls.length = 0;
    for (const geometry of geometryCache.values()) geometry.dispose();
    geometryCache.clear();
    for (const variants of edgeCache.values()) for (const geometry of variants.values()) geometry.dispose();
    edgeCache.clear();
    for (const variant of extraMaterials.values()) variant.dispose();
    extraMaterials.clear();
    material.dispose(); edgeMaterial.dispose(); hiddenMaterial.dispose();
  }

  return {apply, dispose, stats};
}
