/** A small, textureless garden island for the architecture viewer. */
export function createEnvironment(THREE, scene, footprint = {}) {
  const root = new THREE.Group();
  root.name = 'Garden island';
  scene.add(root);

  const modelWidth = Number(footprint.width) || 8;
  const modelDepth = Number(footprint.depth) || 12;
  const width = Math.max(17, modelWidth + 5.6);
  const depth = Math.max(18.5, modelDepth + 6.5);
  const halfW = width / 2;
  const halfD = depth / 2;
  const groundY = Number.isFinite(footprint.groundY) ? footprint.groundY : -0.055;
  const tmp = new THREE.Object3D();
  const color = new THREE.Color();
  let seed = 27931;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const range = (a, b) => a + random() * (b - a);
  const mat = (hex, extra = {}) => new THREE.MeshStandardMaterial({ color: hex, roughness: 1, ...extra });

  const grassMat = mat('#a3b484');
  const soilMat = mat('#786e57');
  const stoneMat = mat('#9b9c8c');
  const foundationMat = mat('#747d74');
  const barkMat = mat('#77775a');
  const leafMat = mat('#ffffff', { flatShading: true });
  const shrubMat = mat('#ffffff', { flatShading: true });
  const grassBladeMat = mat('#8ba16e', { side: THREE.DoubleSide });
  const pathMat = mat('#c4c3af', { flatShading: true });
  const lampMat = mat('#4f655c', { metalness: 0.25, roughness: 0.65 });
  const bulbMat = mat('#fff0bd', { emissive: '#ffc878', emissiveIntensity: 0.4, roughness: 0.3 });

  function roundedRectangle(w, d, radius) {
    const s = new THREE.Shape();
    const x = -w / 2;
    const y = -d / 2;
    s.moveTo(x + radius, y);
    s.lineTo(x + w - radius, y);
    s.quadraticCurveTo(x + w, y, x + w, y + radius);
    s.lineTo(x + w, y + d - radius);
    s.quadraticCurveTo(x + w, y + d, x + w - radius, y + d);
    s.lineTo(x + radius, y + d);
    s.quadraticCurveTo(x, y + d, x, y + d - radius);
    s.lineTo(x, y + radius);
    s.quadraticCurveTo(x, y, x + radius, y);
    return s;
  }

  function platformLayer(w, d, y, thickness, material, bevel = 0.12) {
    const geometry = new THREE.ExtrudeGeometry(roundedRectangle(w - bevel * 2, d - bevel * 2, 1.0), {
      depth: thickness - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 1,
      curveSegments: 5,
      steps: 1,
    });
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y - thickness + bevel;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    root.add(mesh);
    return mesh;
  }

  // Thin bands make the floating island read as a cut piece of landscape.
  platformLayer(width - 0.5, depth - 0.5, -0.65, 0.65, foundationMat, 0.16);
  platformLayer(width - 0.15, depth - 0.15, -0.35, 0.46, stoneMat, 0.10);
  platformLayer(width, depth, -0.12, 0.31, soilMat, 0.08);
  const ground = platformLayer(width + 0.06, depth + 0.06, groundY, 0.13, grassMat, 0.035);
  ground.name = 'Garden ground';

  function instances(geometry, material, count, name, shadow = true) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = name;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }
  function instance(mesh, index, x, y, z, sx, sy = sx, sz = sx, ry = 0, rz = 0) {
    tmp.position.set(x, y, z);
    tmp.rotation.set(0, ry, rz);
    tmp.scale.set(sx, sy, sz);
    tmp.updateMatrix();
    mesh.setMatrixAt(index, tmp.matrix);
  }

  // The planting stays outside the building envelope, leaving its silhouette clear.
  const treePositions = [
    [-halfW + 1.65, -halfD + 2.15, 3.65],
    [halfW - 1.65, -halfD + 2.3, 3.15],
    [-halfW + 1.35, -3.45, 2.9],
    [halfW - 1.4, -2.9, 3.5],
    [-halfW + 1.6, 2.5, 2.7],
    [halfW - 1.55, 3.0, 2.65],
    [-halfW + 2.2, halfD - 2.3, 2.6],
    [halfW - 2.05, halfD - 2.4, 3.1],
    [-3.2, -halfD + 1.5, 2.1],
    [2.8, -halfD + 1.55, 2.55],
  ];

  const trunks = instances(new THREE.CylinderGeometry(0.09, 0.15, 1, 6), barkMat, treePositions.length, 'Tree trunks');
  const crowns = instances(new THREE.IcosahedronGeometry(1, 0), leafMat, treePositions.length * 3, 'Faceted tree crowns');
  const beds = instances(new THREE.CylinderGeometry(1, 1, 0.035, 10), mat('#91a477'), treePositions.length, 'Soft planting beds', false);
  treePositions.forEach(([x, z, height], i) => {
    instance(trunks, i, x, height * 0.29, z, 1, height * 0.6, 1, range(0, Math.PI));
    instance(beds, i, x, groundY + 0.035, z, 1.25, 1, 0.95, range(0, Math.PI));
    const radius = height * 0.34;
    const offsets = [[0, 0.72, 0], [-0.22, 0.59, 0.1], [0.25, 0.6, -0.1]];
    offsets.forEach(([ox, oy, oz], j) => {
      instance(crowns, i * 3 + j, x + ox * height, height * oy, z + oz * height,
        radius * range(0.79, 1.04), radius * range(0.95, 1.2), radius * range(0.76, 1.0), range(0, 6), range(-0.15, 0.15));
      color.set(['#79966c', '#8fa77b', '#688660', '#a1b388'][(i + j) % 4]);
      crowns.setColorAt(i * 3 + j, color);
    });
  });

  const bushCount = 42;
  const bushes = instances(new THREE.IcosahedronGeometry(1, 0), shrubMat, bushCount, 'Low garden shrubs');
  const rocks = instances(new THREE.DodecahedronGeometry(1, 0), stoneMat, 32, 'Garden stones');
  const patches = [];
  for (let i = 0; i < bushCount; i++) {
    const tree = treePositions[i % treePositions.length];
    const angle = range(0, Math.PI * 2);
    const dist = range(0.6, 1.35);
    const x = Math.max(-halfW + 0.55, Math.min(halfW - 0.55, tree[0] + Math.cos(angle) * dist));
    const z = Math.max(-halfD + 0.55, Math.min(halfD - 0.55, tree[1] + Math.sin(angle) * dist));
    const size = range(0.22, 0.42);
    instance(bushes, i, x, size * 0.65, z, size * 1.2, size * 0.9, size, range(0, 6));
    color.set(['#8aa276', '#b1bc8a', '#718f68'][i % 3]);
    bushes.setColorAt(i, color);
    patches.push({ x, z });
  }
  for (let i = 0; i < 32; i++) {
    const patch = patches[(i * 7) % patches.length];
    const size = range(0.08, 0.24);
    instance(rocks, i, patch.x + range(-0.5, 0.5), size * 0.33, patch.z + range(-0.5, 0.5), size * 1.6, size * 0.7, size, range(0, 6), range(-0.1, 0.1));
  }

  // Broken, gently wandering stone path from the entrance to the island edge.
  const frontStart = Number(footprint.pathStart) || Math.min(modelDepth / 2 + 0.28, 3.25);
  const pathLength = halfD - 0.45 - frontStart;
  const pathCount = Math.max(4, Math.floor(pathLength / 0.56));
  // The revised building's foundation extends to z=4.015. The first two
  // generated stones intersect it; keep all later stones in their exact places.
  const coveredPathCount = 2;
  const paths = instances(new THREE.CylinderGeometry(1, 1, 0.10, 7), pathMat, pathCount - coveredPathCount, 'Entrance stepping stones');
  for (let i = 0; i < pathCount; i++) {
    const progress = pathCount > 1 ? i / (pathCount - 1) : 0;
    const x = Math.sin(progress * Math.PI * 1.4) * 0.23;
    // Consume every original random draw so the rest of the garden stays fixed.
    const sx = range(0.48, 0.59), sz = range(0.25, 0.33), ry = range(-0.16, 0.16);
    if (i < coveredPathCount) continue;
    instance(paths, i - coveredPathCount, x, -0.003, frontStart + progress * pathLength, sx, 1, sz, ry);
  }

  // Low grasses and restrained flowers give the perimeter a hand-planted feel.
  const bladeCount = 260;
  const bladeGeometry = new THREE.ConeGeometry(0.045, 0.23, 3, 1);
  const blades = instances(bladeGeometry, grassBladeMat, bladeCount, 'Garden grass tufts', false);
  for (let i = 0; i < bladeCount; i++) {
    const p = patches[i % patches.length];
    const x = Math.max(-halfW + 0.3, Math.min(halfW - 0.3, p.x + range(-0.72, 0.72)));
    const z = Math.max(-halfD + 0.3, Math.min(halfD - 0.3, p.z + range(-0.72, 0.72)));
    const scale = range(0.55, 1.2);
    instance(blades, i, x, groundY + scale * 0.1, z, scale, scale, scale, range(0, 6), range(-0.1, 0.1));
  }
  const flowerCount = 115;
  const flowerHeads = instances(new THREE.IcosahedronGeometry(0.047, 0), mat('#ffffff'), flowerCount, 'Small wildflowers', false);
  const stems = instances(new THREE.CylinderGeometry(0.009, 0.012, 1, 3), mat('#758d60'), flowerCount, 'Wildflower stems', false);
  for (let i = 0; i < flowerCount; i++) {
    const p = patches[(i * 3) % patches.length];
    const x = p.x + range(-0.52, 0.52);
    const z = p.z + range(-0.52, 0.52);
    const h = range(0.12, 0.25);
    instance(stems, i, x, groundY + h * 0.5, z, 1, h, 1);
    instance(flowerHeads, i, x, groundY + h, z, range(0.65, 1), 0.7, 1, range(0, 6));
    color.set(['#f4e5bd', '#e9baaa', '#ded9ed', '#e9d28c'][i % 4]);
    flowerHeads.setColorAt(i, color);
  }

  const lampLocations = [
    // Keep the entrance-side lamp beyond the building's stone platform.
    [-1.13, halfD - 1.0], [1.13, frontStart + 2.0],
    [-halfW + 2.0, 0.1], [halfW - 2.0, 0.2],
    [-halfW + 2.25, -halfD + 3.4], [halfW - 2.25, -halfD + 3.4],
  ];
  const poles = instances(new THREE.CylinderGeometry(0.025, 0.039, 0.75, 6), lampMat, lampLocations.length, 'Garden lamp posts');
  const lampCaps = instances(new THREE.CylinderGeometry(0.14, 0.14, 0.035, 8), lampMat, lampLocations.length, 'Garden lamp caps');
  const bulbs = instances(new THREE.CylinderGeometry(0.085, 0.085, 0.13, 8), bulbMat, lampLocations.length, 'Warm garden lamps', false);
  const pools = instances(new THREE.CircleGeometry(0.62, 24), new THREE.MeshBasicMaterial({
    color: '#ffd58b', transparent: true, opacity: 0, depthWrite: false,
  }), lampLocations.length, 'Lamp light pools', false);
  lampLocations.forEach(([x, z], i) => {
    instance(poles, i, x, 0.34, z, 1);
    instance(lampCaps, i, x, 0.79, z, 1);
    instance(bulbs, i, x, 0.7, z, 1);
    tmp.position.set(x, groundY + 0.072, z);
    tmp.rotation.set(-Math.PI / 2, 0, 0);
    tmp.scale.setScalar(1);
    tmp.updateMatrix();
    pools.setMatrixAt(i, tmp.matrix);
  });

  // Exterior rainfall is owned by the shared GPU weather renderer.
  let raining = false;

  const flyCount = 26;
  const flyPositions = new Float32Array(flyCount * 3);
  const flies = Array.from({ length: flyCount }, (_, i) => ({
    x: treePositions[i % treePositions.length][0] + range(-0.9, 0.9),
    y: range(0.5, 1.9),
    z: treePositions[i % treePositions.length][1] + range(-0.9, 0.9),
    phase: range(0, Math.PI * 2),
  }));
  const flyGeo = new THREE.BufferGeometry();
  const flyAttr = new THREE.BufferAttribute(flyPositions, 3);
  flyAttr.setUsage(THREE.DynamicDrawUsage);
  flyGeo.setAttribute('position', flyAttr);
  const fireflies = new THREE.Points(flyGeo, new THREE.PointsMaterial({
    color: '#f9e8a7', size: 0.065, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  fireflies.name = 'Evening fireflies';
  fireflies.frustumCulled = false;
  root.add(fireflies);

  let currentWeather = 'clear';
  function setWeather(key) {
    currentWeather = typeof key === 'string' ? key : (key?.key || key?.id || 'clear');
    raining = currentWeather === 'rain' || currentWeather === 'storm';
  }

  function update(elapsed = 0, delta = 0.016, weather = currentWeather, night = false) {
    setWeather(weather);
    const nightAmount = typeof night === 'number' ? THREE.MathUtils.clamp(night, 0, 1) : (night ? 1 : 0);
    bulbMat.emissiveIntensity = 0.35 + nightAmount * 2.4;
    pools.material.opacity = nightAmount * 0.13;
    fireflies.visible = nightAmount > 0.05 && !raining;
    fireflies.material.opacity = nightAmount * (0.64 + Math.sin(elapsed * 1.3) * 0.16);
    if (fireflies.visible) {
      flies.forEach((fly, i) => {
        flyPositions[i * 3] = fly.x + Math.sin(elapsed * 0.44 + fly.phase) * 0.3;
        flyPositions[i * 3 + 1] = fly.y + Math.sin(elapsed * 0.7 + fly.phase) * 0.2;
        flyPositions[i * 3 + 2] = fly.z + Math.cos(elapsed * 0.35 + fly.phase) * 0.3;
      });
      flyAttr.needsUpdate = true;
    }
  }

  update(0, 0, 'clear', false);
  return { ground, group: root, width, depth, update, setWeather };
}
