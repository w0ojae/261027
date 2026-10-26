// Conservative GPU visibility for the existing, world-space rain panes. The
// probes borrow pane geometry and never write color or depth. A zero result is
// useful only for the exact view that issued it; unknown or stale views stay wet.
export function createPaneVisibility(THREE, renderer, panes) {
  const stats = {supported: false, issued: 0, completed: 0, pending: 0, occluded: 0};
  const material = new THREE.ShaderMaterial({
    name: 'Rain pane visibility probe',
    vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'void main(){gl_FragColor=vec4(0.);}',
    side: THREE.DoubleSide, transparent: true, forceSinglePass: true,
    depthTest: true, depthFunc: THREE.LessEqualDepth, depthWrite: false,
    colorWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
  const entries = new Map(panes.map(pane => {
    const probe = new THREE.Mesh(pane.geometry, material);
    probe.name = `${pane.name || 'Glass'} visibility probe`;
    probe.frustumCulled = false; probe.matrixAutoUpdate = false;
    probe.castShadow = probe.receiveShadow = false;
    probe.renderOrder = Number.MAX_SAFE_INTEGER;
    probe.userData.rainSurface = 'visibility-probe';
    probe.userData.rainVisibilityProbe = true;
    const entry = {pane, probe, query: null, pending: false, epoch: -1, visible: true};
    probe.onBeforeRender = (activeRenderer, _scene, camera) => {
      if (!drawing || activeRenderer !== renderer || camera !== drawingCamera ||
          !stats.supported || entry.pending || !entry.query) return;
      try {
        if (activeQuery) {fail(); return;}
        gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, entry.query);
        activeQuery = entry;
      } catch {fail();}
    };
    probe.onAfterRender = () => {if (activeQuery === entry) endQuery();};
    return [pane, entry];
  }));
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4(), size = new THREE.Vector2();
  const canvas = renderer.domElement;
  let gl, disposed = false, epoch = 0, signature = null, candidates = [];
  let drawing = false, drawingCamera = null, drawingEpoch = -1, activeQuery = null;

  function supportedContext() {
    try {
      gl = renderer.getContext?.();
      return Boolean(gl && ['ANY_SAMPLES_PASSED_CONSERVATIVE', 'QUERY_RESULT_AVAILABLE', 'QUERY_RESULT']
        .every(name => typeof gl[name] === 'number') &&
        ['createQuery', 'deleteQuery', 'beginQuery', 'endQuery', 'getQueryParameter']
          .every(name => typeof gl[name] === 'function') && !gl.isContextLost?.());
    } catch {return false;}
  }
  stats.supported = supportedContext();

  function updateStats() {
    stats.pending = [...entries.values()].filter(entry => entry.pending).length;
    stats.occluded = stats.supported
      ? candidates.filter(pane => entries.get(pane)?.visible === false).length : 0;
  }
  function invalidate() {
    epoch++; signature = null;
    for (const entry of entries.values()) entry.visible = true;
    stats.occluded = 0;
  }
  function endQuery() {
    const entry = activeQuery;
    if (!entry) return;
    activeQuery = null;
    try {
      gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
      entry.pending = true; entry.epoch = drawingEpoch; stats.issued++;
    } catch {stats.supported = false; invalidate();}
    updateStats();
  }
  function fail() {
    endQuery(); stats.supported = false; invalidate();
  }
  function onContextLost() {
    // The old context owns these query objects; they cannot be reused after a
    // restore. No readback or waiting is needed to abandon them.
    activeQuery = null; stats.supported = false;
    for (const entry of entries.values()) {entry.query = null; entry.pending = false;}
    invalidate(); updateStats();
  }
  function onContextRestored() {
    if (disposed) return;
    onContextLost(); stats.supported = supportedContext();
  }
  canvas?.addEventListener?.('webglcontextlost', onContextLost);
  canvas?.addEventListener?.('webglcontextrestored', onContextRestored);

  function viewSignature(camera) {
    const target = renderer.getRenderTarget?.() ?? null;
    const values = [...camera.projectionMatrix.elements, ...camera.matrixWorldInverse.elements,
      camera.layers.mask, target?.width ?? 0, target?.height ?? 0, target?.samples ?? 0];
    if (renderer.getDrawingBufferSize) values.push(...renderer.getDrawingBufferSize(size).toArray());
    if (renderer.getViewport) values.push(...renderer.getViewport(viewport).toArray());
    if (renderer.getScissor) values.push(...renderer.getScissor(scissor).toArray());
    values.push(renderer.getScissorTest?.() ?? false);
    for (const {pane} of entries.values()) {
      values.push(...pane.matrixWorld.elements, pane.visible, pane.layers.mask);
      // A parent's visibility/layers can change without changing pane matrices.
      for (let parent = pane.parent; parent; parent = parent.parent) {
        values.push(parent.visible, parent.layers.mask);
      }
    }
    return {camera, target, values};
  }
  function sameView(a, b) {
    return a && a.camera === b.camera && a.target === b.target &&
      a.values.length === b.values.length && a.values.every((value, index) => value === b.values[index]);
  }

  function select(camera, nextCandidates) {
    candidates = [...nextCandidates];
    if (disposed || !stats.supported) return candidates.slice();
    try {
      if (gl.isContextLost?.()) {onContextLost(); return candidates.slice();}
      const next = viewSignature(camera);
      if (!sameView(signature, next)) {invalidate(); signature = next;}
      for (const entry of entries.values()) {
        if (!entry.pending) continue;
        const available = gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE);
        if (available === false) continue;
        if (available !== true) {fail(); return candidates.slice();}
        // Reading QUERY_RESULT is nonblocking only after availability is true.
        const result = gl.getQueryParameter(entry.query, gl.QUERY_RESULT);
        entry.pending = false; stats.completed++;
        // WebGL2 returns GLuint for QUERY_RESULT (GLboolean is only the
        // availability flag). Also tolerate boolean adapters conservatively.
        const isUint = Number.isInteger(result) && result >= 0 && result <= 0xffffffff;
        if (!isUint && typeof result !== 'boolean') {fail(); return candidates.slice();}
        if (entry.epoch === epoch) entry.visible = Boolean(result);
      }
      updateStats();
      return candidates.filter(pane => entries.get(pane)?.visible !== false);
    } catch {fail(); return candidates.slice();}
  }

  function render(camera, draw) {
    if (disposed || !stats.supported) return draw();
    const attached = [];
    try {
      if (gl.isContextLost?.()) {onContextLost(); return draw();}
      for (const pane of candidates) {
        const entry = entries.get(pane);
        if (!entry || entry.pending) continue;
        entry.query ??= gl.createQuery();
        if (!entry.query) {fail(); break;}
        entry.probe.layers.mask = pane.layers.mask;
        pane.add(entry.probe); attached.push(entry.probe);
      }
    } catch {fail();}
    drawing = true; drawingCamera = camera; drawingEpoch = epoch;
    let succeeded = false;
    try {
      const result = draw(); succeeded = true; return result;
    } finally {
      endQuery(); drawing = false; drawingCamera = null;
      for (const probe of attached) probe.removeFromParent();
      // A draw interrupted before a probe actually rasterized is not evidence
      // of occlusion. Close its query, then reject every result from that epoch.
      if (!succeeded) invalidate();
      updateStats();
    }
  }

  function reset() {invalidate(); candidates = []; updateStats();}
  function dispose() {
    if (disposed) return;
    disposed = true; endQuery();
    canvas?.removeEventListener?.('webglcontextlost', onContextLost);
    canvas?.removeEventListener?.('webglcontextrestored', onContextRestored);
    for (const entry of entries.values()) {
      entry.probe.removeFromParent();
      if (entry.query) {try {gl?.deleteQuery(entry.query);} catch { /* Lost context. */ }}
      entry.query = null; entry.pending = false; entry.visible = true;
    }
    material.dispose(); stats.supported = false; candidates = []; updateStats();
  }
  return {select, render, reset, dispose, stats};
}
