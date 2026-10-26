/** Small daylight visitors. All geometry and materials belong to this controller. */
const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smoothstep = (a, b, value) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
const unit = random => {
  const value = random();
  return Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : .5;
};
const range = (random, a, b) => a + (b - a) * unit(random);

export function birdDaylightOpacity(minutes = 900) {
  const time = ((Number.isFinite(minutes) ? minutes : 900) % 1440 + 1440) % 1440;
  return smoothstep(360, 420, time) * (1 - smoothstep(1080, 1140, time));
}

/** Signed distance to the garden rectangle gives a soft boundary in world space. */
export function birdGardenOpacity(x, z, width = 17, depth = 18.5) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const halfW = positive(width, 17) / 2;
  const halfD = positive(depth, 18.5) / 2;
  const dx = Math.abs(x) - halfW, dz = Math.abs(z) - halfD;
  const outside = Math.hypot(Math.max(0, dx), Math.max(0, dz));
  const inside = Math.min(Math.max(dx, dz), 0);
  return smoothstep(-3.2, .7, -(outside + inside));
}

/** Choices belong to one flight. Sampling never consumes more randomness. */
export function createBirdFlight(random = Math.random, options = {}) {
  random = typeof random === 'function' ? random : Math.random;
  const width = positive(options.width, 17), depth = positive(options.depth, 18.5);
  const groundY = Number.isFinite(options.groundY) ? options.groundY : -.055;
  const flight = {
    width, depth, groundY,
    angle: Number.isFinite(options.angle) ? options.angle : range(random, 0, TAU),
    centerX: Number.isFinite(options.centerX) ? options.centerX : range(random, -width * .16, width * .16),
    centerZ: Number.isFinite(options.centerZ) ? options.centerZ : range(random, -depth * .16, depth * .16),
    speed: Number.isFinite(options.speed) ? Math.max(.75, Math.min(1.55, options.speed)) : range(random, .75, 1.55),
    curve: range(random, -2.3, 2.3),
    altitude: range(random, 6.98, 7.4),
    bobPhase: range(random, 0, TAU),
    flapHz: range(random, 1.95, 2.65),
    flapPhase: range(random, 0, TAU),
    flapAmplitude: range(random, .62, .76),
    glidePeriod: range(random, 8, 13),
    glideOffset: range(random, 0, 13),
  };
  flight.angle = ((flight.angle % TAU) + TAU) % TAU;
  // The enclosing circle plus a margin keeps either endpoint beyond the fade,
  // including oblique flights near the rectangle's corners.
  flight.radius = Math.hypot(width / 2, depth / 2) + 6.3 + Math.hypot(flight.centerX, flight.centerZ);
  flight.arc = [0];
  let previous = flightPoint(0, flight);
  for (let i = 1; i <= 48; i++) {
    const next = flightPoint(i / 48, flight);
    flight.arc.push(flight.arc[i - 1] + Math.hypot(next.x - previous.x, next.y - previous.y, next.z - previous.z));
    previous = next;
  }
  flight.length = flight.arc.at(-1);
  flight.duration = flight.length / flight.speed;
  return flight;
}

function flightPoint(u, flight) {
  const {angle, radius, curve, centerX, centerZ, groundY, altitude, bobPhase} = flight;
  const along = (u * 2 - 1) * radius, across = Math.sin(u * Math.PI) * curve;
  const directionX = Math.cos(angle), directionZ = Math.sin(angle);
  return {
    x: centerX + directionX * along - directionZ * across,
    y: groundY + altitude + .12 * Math.sin(u * TAU + bobPhase),
    z: centerZ + directionZ * along + directionX * across,
    dx: directionX * radius * 2 - directionZ * Math.cos(u * Math.PI) * Math.PI * curve,
    dy: .12 * TAU * Math.cos(u * TAU + bobPhase),
    dz: directionZ * radius * 2 + directionX * Math.cos(u * Math.PI) * Math.PI * curve,
  };
}

/** Arc-length lookup keeps the selected world speed steady through a curve. */
export function sampleBirdFlight(age, flight) {
  const time = Number.isFinite(age) ? age : 0;
  const active = time >= 0 && time < flight.duration;
  const distance = clamp(time / flight.duration) * flight.length;
  let low = 0, high = flight.arc.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (flight.arc[middle] < distance) low = middle; else high = middle;
  }
  const segment = flight.arc[high] - flight.arc[low];
  const u = (low + (segment > 0 ? (distance - flight.arc[low]) / segment : 0)) / (flight.arc.length - 1);
  const point = flightPoint(u, flight);
  const glidePhase = ((time + flight.glideOffset) % flight.glidePeriod + flight.glidePeriod) % flight.glidePeriod / flight.glidePeriod;
  const flapping = 1 - smoothstep(.47, .59, glidePhase) * (1 - smoothstep(.85, .96, glidePhase));
  const wingAngle = -.08 + Math.sin(time * TAU * flight.flapHz + flight.flapPhase) * flight.flapAmplitude * flapping;
  return {
    x: point.x, y: point.y, z: point.z, active, u,
    opacity: active ? birdGardenOpacity(point.x, point.z, flight.width, flight.depth) : 0,
    yaw: Math.atan2(point.dx, point.dz),
    pitch: -Math.atan2(point.dy, Math.hypot(point.dx, point.dz)),
    bank: Math.sin(u * TAU + flight.bobPhase) * .055,
    wingAngle,
  };
}

export function createGardenBirds(THREE, scene, {
  width = 17, depth = 18.5, groundY = -.055, reducedMotion = false, count = 5, random = Math.random,
} = {}) {
  width = positive(width, 17); depth = positive(depth, 18.5);
  groundY = Number.isFinite(groundY) ? groundY : -.055;
  count = Number.isFinite(count) ? Math.max(0, Math.min(5, Math.floor(count))) : 5;
  random = typeof random === 'function' ? random : Math.random;
  const group = new THREE.Group();
  group.name = 'Daylight garden birds';
  group.userData.gardenBirds = true;
  scene.add(group);
  const geometries = new Set(), materials = new Set();
  const birds = [];
  let disposed = false, running = false, firstStart = true, nextSpawn = 0;
  const stats = {count, visibleBirds: 0, activeBirds: 0, dayOpacity: 0, totalTriangles: 0, drawCalls: 0,
    flocksStarted: 0, flightsStarted: 0, lastFlockSize: 0, lastSpawnInterval: 0};

  function own(geometry) { geometries.add(geometry); return geometry; }
  function ellipsoid(x, y, z, segments = 8, rings = 5) {
    return own(new THREE.SphereGeometry(1, segments, rings).scale(x, y, z));
  }
  function prism(points, thickness) {
    // Thin closed wings/tail retain their silhouette from below and edge-on.
    const area = points.reduce((sum, [x, z], i) => {
      const next = points[(i + 1) % points.length];
      return sum + x * next[1] - next[0] * z;
    }, 0);
    if (area > 0) points = points.slice().reverse();
    const positions = [], indices = [], n = points.length;
    for (const y of [-thickness / 2, thickness / 2]) {
      for (const [x, z] of points) positions.push(x, y, z);
    }
    for (let i = 1; i < n - 1; i++) {
      indices.push(0, i + 1, i, n, n + i, n + i + 1);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices.push(i, j, n + j, i, n + j, n + i);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return own(geometry);
  }
  const bodyGeometry = ellipsoid(.145, .14, .29);
  const headGeometry = ellipsoid(.115, .11, .125, 8, 4);
  const beakGeometry = own(new THREE.ConeGeometry(.045, .12, 5).rotateX(Math.PI / 2));
  // ConeGeometry points along +Y; +PI/2 rotates it toward local +Z.
  const tailGeometry = prism([[-.07, -.2], [-.14, -.49], [.14, -.49], [.07, -.2]], .035);
  const wingGeometry = prism([[0, .1], [.32, .015], [.62, -.19], [.38, -.27], [0, -.15]], .032);
  const eyeGeometry = ellipsoid(.014, .016, .014, 5, 3);
  const gradient = new THREE.DataTexture(new Uint8Array([80, 160, 235]), 3, 1, THREE.RedFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;

  function material(color, outline = false) {
    const config = {
      color, alphaHash: true, opacity: 0, transparent: false,
      depthTest: true, depthWrite: true, fog: true, toneMapped: true,
      side: outline ? THREE.BackSide : THREE.FrontSide,
    };
    const result = outline ? new THREE.MeshBasicMaterial(config) : new THREE.MeshToonMaterial({...config, gradientMap: gradient});
    result.name = outline ? 'Bird fading outline' : 'Bird fading toon';
    result.userData.gardenBird = true;
    result.userData.birdOutline = outline;
    materials.add(result);
    return result;
  }
  function part(parent, geometry, surface, outline, name, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, surface);
    mesh.name = name; mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.userData.gardenBird = true;
    parent.add(mesh);
    const hull = new THREE.Mesh(geometry, outline);
    hull.name = `${name} outline`; hull.scale.setScalar(1.075);
    hull.castShadow = hull.receiveShadow = false;
    hull.userData.gardenBird = true; hull.userData.birdOutline = true;
    mesh.add(hull);
    stats.totalTriangles += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3 * 2;
    stats.drawCalls += 2;
    return mesh;
  }
  for (let i = 0; i < count; i++) {
    const root = new THREE.Group(); root.name = `Garden bird ${i + 1}`;
    group.add(root);
    const body = material(['#89917d', '#a1a38c', '#8a9385'][i % 3]);
    const wing = material(['#647362', '#737d68', '#667868'][i % 3]);
    const beak = material('#c29a68');
    const outline = material('#35473e', true);
    part(root, bodyGeometry, body, outline, 'Bird body');
    part(root, headGeometry, body, outline, 'Bird head', 0, .1, .245);
    part(root, beakGeometry, beak, outline, 'Bird beak', 0, .075, .395);
    part(root, tailGeometry, wing, outline, 'Bird tail', 0, .01, 0);
    const left = new THREE.Group(), right = new THREE.Group();
    left.name = 'Left wing hinge'; right.name = 'Right wing hinge';
    left.position.set(.1, .045, 0); right.position.set(-.1, .045, 0);
    root.add(left, right);
    part(left, wingGeometry, wing, outline, 'Left bird wing');
    // Reflect X without negative scale, preserving face winding and local forward.
    const reflectedWing = own(wingGeometry.clone());
    reflectedWing.scale(-1, 1, 1);
    const winding = reflectedWing.index.array;
    for (let j = 0; j < winding.length; j += 3) [winding[j + 1], winding[j + 2]] = [winding[j + 2], winding[j + 1]];
    reflectedWing.computeVertexNormals();
    part(right, reflectedWing, wing, outline, 'Right bird wing');
    // The dark eyes use the same alpha-hashed material as the outlines.
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeometry, outline.clone());
      eye.material.side = THREE.FrontSide; materials.add(eye.material);
      eye.name = 'Bird eye'; eye.position.set(side * .103, .12, .294);
      eye.castShadow = eye.receiveShadow = false; eye.userData.gardenBird = true;
      root.add(eye);
      stats.totalTriangles += eyeGeometry.index.count / 3; stats.drawCalls++;
    }
    const ownMaterials = new Set(); root.traverse(object => { if (object.isMesh) ownMaterials.add(object.material); });
    root.visible = false; root.userData.opacity = 0;
    birds.push({root, left, right, materials: ownMaterials, flight: null, age: 0});
  }

  function retire(bird) {
    bird.flight = null; bird.age = 0; bird.root.visible = false;
    bird.root.userData.flight = null; bird.root.userData.age = 0; bird.root.userData.opacity = 0;
    for (const surface of bird.materials) surface.opacity = 0;
  }
  function schedule() {
    nextSpawn = range(random, 12, 26);
    stats.lastSpawnInterval = nextSpawn;
  }
  function startFlock(warmStart) {
    const available = birds.filter(bird => !bird.flight);
    // Avoid constantly topping up a nearly full pool with a single visitor.
    // There is no waiting queue; a missed opportunity simply gets a new timer.
    if (!available.length || (available.length === 1 && count > 1 && birds.some(bird => bird.flight))) return;
    const size = 1 + Math.floor(unit(random) * available.length);
    const angle = range(random, 0, TAU);
    const centerX = range(random, -width * .16, width * .16);
    const centerZ = range(random, -depth * .16, depth * .16);
    const speed = range(random, .75, 1.55);
    stats.lastFlockSize = size; stats.flocksStarted++; stats.flightsStarted += size;
    for (let i = 0; i < size; i++) {
      const bird = available[i];
      bird.flight = createBirdFlight(random, {
        width, depth, groundY,
        angle: angle + range(random, -.16, .16),
        centerX: centerX + range(random, -.65, .65), centerZ: centerZ + range(random, -.65, .65),
        speed: speed + range(random, -.12, .12),
      });
      bird.age = warmStart ? bird.flight.duration * range(random, .38, .52) : (-i * range(random, .15, .7) || 0);
      bird.root.userData.flight = bird.flight;
    }
  }
  function update(_elapsed, delta, {minutes = 900, enabled = true} = {}) {
    if (disposed) return;
    stats.dayOpacity = enabled && !reducedMotion ? birdDaylightOpacity(minutes) : 0;
    stats.visibleBirds = 0; stats.activeBirds = 0;
    group.visible = stats.dayOpacity > .001 && count > 0;
    if (!group.visible) {
      for (const bird of birds) retire(bird);
      running = false; nextSpawn = 0; firstStart = false;
      return;
    }
    // Ignore suspended-tab jumps instead of simulating old spawn opportunities.
    const step = Number.isFinite(delta) && delta > 0 && delta <= .5 ? delta : 0;
    if (!running) {
      startFlock(firstStart); schedule(); running = true; firstStart = false;
    } else {
      for (const bird of birds) {
        if (!bird.flight) continue;
        bird.age += step;
        if (bird.age >= bird.flight.duration) retire(bird);
      }
      nextSpawn -= step;
      if (nextSpawn <= 0) { startFlock(false); schedule(); }
    }
    for (let i = 0; i < birds.length; i++) {
      const bird = birds[i];
      if (!bird.flight) continue;
      const pose = sampleBirdFlight(bird.age, bird.flight);
      const opacity = pose.opacity * stats.dayOpacity;
      stats.activeBirds++;
      bird.root.visible = opacity > .001;
      bird.root.position.set(pose.x, pose.y, pose.z);
      bird.root.rotation.set(pose.pitch, pose.yaw, pose.bank, 'YXZ');
      bird.left.rotation.z = pose.wingAngle;
      bird.right.rotation.z = -pose.wingAngle;
      bird.root.userData.age = bird.age;
      bird.root.userData.opacity = opacity;
      for (const surface of bird.materials) surface.opacity = opacity;
      if (bird.root.visible) stats.visibleBirds++;
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; group.removeFromParent(); group.clear();
    for (const geometry of geometries) geometry.dispose();
    for (const surface of materials) surface.dispose();
    gradient.dispose();
    stats.visibleBirds = 0; stats.activeBirds = 0;
  }
  update(0, 0);
  return {group, update, dispose, stats};
}
