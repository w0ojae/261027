// The full water plane is a conservative superset of the sparse puddle mask.
// Test it against final opaque depth; never let an auxiliary rain capture decide
// whether the reflection is visible. Unknown or changed views keep rendering.
export function createWetGroundVisibility(THREE, renderer, surface) {
  const stats = {supported: false, issued: 0, completed: 0, pending: false, inFrustum: true, occluded: false};
  const material = new THREE.ShaderMaterial({
    name: 'Wet-ground reflection visibility probe',
    vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'void main(){gl_FragColor=vec4(0.);}',
    side: THREE.FrontSide, transparent: true, forceSinglePass: true,
    depthTest: true, depthFunc: THREE.LessEqualDepth, depthWrite: false,
    colorWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
  const probe = new THREE.Mesh(surface.geometry, material);
  probe.name = 'Wet-ground final-depth visibility probe';
  probe.userData.groundReflectionProbe = true;
  probe.frustumCulled = false;
  probe.castShadow = probe.receiveShadow = false;
  probe.renderOrder = Number.MAX_SAFE_INTEGER;
  const projection = new THREE.Matrix4(), frustum = new THREE.Frustum(), size = new THREE.Vector2();
  const bounds = new THREE.Box3();
  if (!surface.geometry.boundingBox) surface.geometry.computeBoundingBox();
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4();
  let gl, query = null, disposed = false, pending = false, querying = false;
  let epoch = 0, queryEpoch = -1, signature = null, raster = null, drawing = null;

  function supportedContext() {
    try {
      gl = renderer.getContext?.();
      return Boolean(gl && ['ANY_SAMPLES_PASSED_CONSERVATIVE', 'QUERY_RESULT_AVAILABLE', 'QUERY_RESULT']
        .every(key => typeof gl[key] === 'number') &&
        ['createQuery', 'deleteQuery', 'beginQuery', 'endQuery', 'getQueryParameter']
          .every(key => typeof gl[key] === 'function') && !gl.isContextLost?.());
    } catch {return false;}
  }
  stats.supported = supportedContext();
  function invalidate() {epoch++; signature = null; stats.occluded = false;}
  function endQuery() {
    if (!querying) return;
    querying = false;
    try {
      gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
      pending = stats.pending = true; queryEpoch = epoch; stats.issued++;
    } catch {stats.supported = false; invalidate();}
  }
  function fail() {endQuery(); stats.supported = false; invalidate();}
  function contextLost() {
    query = null; pending = querying = stats.pending = false;
    stats.supported = false; raster = null; invalidate();
  }
  function contextRestored() {
    if (disposed) return;
    contextLost(); stats.supported = supportedContext();
  }
  renderer.domElement?.addEventListener?.('webglcontextlost', contextLost);
  renderer.domElement?.addEventListener?.('webglcontextrestored', contextRestored);

  function sameValues(a, b) {return a && a.length === b.length && a.every((value, i) => value === b[i]);}
  function sync(camera) {
    surface.updateWorldMatrix(true, false); camera.updateMatrixWorld();
    const values = [...camera.projectionMatrix.elements, ...camera.matrixWorldInverse.elements,
      ...surface.matrixWorld.elements, camera.layers.mask, surface.layers.mask];
    let shown = true;
    for (let parent = surface; parent; parent = parent.parent) {values.push(parent.visible); shown &&= parent.visible;}
    if (renderer.getDrawingBufferSize) values.push(...renderer.getDrawingBufferSize(size).toArray());
    if (!signature || signature.camera !== camera || !sameValues(signature.values, values)) {
      invalidate(); signature = {camera, values};
    }
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection);
    // A large horizontal plane's bounding sphere surrounds an indoor camera and
    // defeats frustum rejection. Its transformed thin box stays conservative.
    bounds.copy(surface.geometry.boundingBox).applyMatrix4(surface.matrixWorld);
    stats.inFrustum = Boolean(shown && surface.layers.test(camera.layers) && frustum.intersectsBox(bounds));
    if (!stats.supported) return;
    try {
      if (gl.isContextLost?.()) {contextLost(); return;}
      if (!pending) return;
      const available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE);
      if (available === false) return;
      if (available !== true) {fail(); return;}
      // Availability is checked first: reading the count must never wait on GPU.
      const result = gl.getQueryParameter(query, gl.QUERY_RESULT);
      pending = stats.pending = false; stats.completed++;
      const valid = typeof result === 'boolean' || (Number.isInteger(result) && result >= 0 && result <= 0xffffffff);
      if (!valid) {fail(); return;}
      if (queryEpoch === epoch) stats.occluded = !Boolean(result);
    } catch {fail();}
  }

  probe.onBeforeRender = (activeRenderer, _scene, camera) => {
    if (!drawing || activeRenderer !== renderer || camera !== drawing.camera ||
        renderer.getRenderTarget() !== drawing.target || pending || querying || !stats.supported) return;
    try {
      gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, query); querying = true;
    } catch {fail();}
  };
  probe.onAfterRender = () => {if (querying) endQuery();};

  function visible(camera) {
    if (disposed) return true;
    sync(camera);
    return stats.inFrustum && !stats.occluded;
  }
  function render(camera, draw) {
    if (disposed) return draw();
    sync(camera);
    if (!stats.supported || !stats.inFrustum || pending) return draw();
    const target = renderer.getRenderTarget();
    try {
      const values = [target?.width ?? 0, target?.height ?? 0, target?.samples ?? 0,
        ...(renderer.getViewport?.(viewport).toArray() ?? []),
        ...(renderer.getScissor?.(scissor).toArray() ?? []), renderer.getScissorTest?.() ?? false];
      if (!raster || raster.target !== target || !sameValues(raster.values, values)) {
        invalidate();
        // Retain the view identity after invalidating an old target's zero.
        sync(camera); raster = {target, values};
      }
      query ??= gl.createQuery();
      if (!query) {fail(); return draw();}
      probe.layers.mask = surface.layers.mask;
    } catch {fail(); return draw();}
    surface.add(probe); drawing = {camera, target};
    let succeeded = false;
    try {const result = draw(); succeeded = true; return result;}
    finally {
      endQuery(); drawing = null; probe.removeFromParent();
      if (!succeeded) invalidate();
    }
  }
  function reset() {invalidate(); raster = null;}
  function dispose() {
    if (disposed) return;
    disposed = true; endQuery(); probe.removeFromParent();
    renderer.domElement?.removeEventListener?.('webglcontextlost', contextLost);
    renderer.domElement?.removeEventListener?.('webglcontextrestored', contextRestored);
    if (query) {try {gl?.deleteQuery(query);} catch { /* Lost context. */ }}
    query = null; pending = stats.pending = false; stats.supported = false;
    material.dispose();
  }
  return {visible, render, reset, dispose, stats};
}
