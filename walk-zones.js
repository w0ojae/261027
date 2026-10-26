import { groundY, modelToWorld } from './building-placement.js?v=16';
import { rooms } from './rooms-building2.js?v=16';

// The interior exit stays in its reachable front aisle. Exterior entry uses
// the actual half-open Cylinder.485 doorway on the right wall, below.
const doorPoint = modelToWorld(1.667, 2.79, -.7);
export const indoorDoor = Object.freeze({ x: doorPoint.x, z: doorPoint.z, radius: .65 });
export const doorIndoorSpawn = {
  ...rooms[1], spawn: modelToWorld(1.67, 2.79, -1.32), yaw: 0, pitch: -.025,
};

const worldRect = (minX, maxX, minZ, maxZ) => {
  const a = modelToWorld(minX, 0, minZ), b = modelToWorld(maxX, 0, maxZ);
  return { minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z };
};
// A narrow approach to the open part of the right-hand door, rather than a
// radial trigger around the adjacent fixed front opening (Plane.098).
export const exteriorDoor = Object.freeze({
  bounds:Object.freeze(worldRect(2.5,3.05,-1.84,-1.52)),
});
export function isWithinDoorTrigger(position,door){
  if(!position||!door)return false;
  const {x,z}=position;
  if(!Number.isFinite(x)||!Number.isFinite(z))return false;
  if(door.bounds){
    const {minX,maxX,minZ,maxZ}=door.bounds;
    return x>=minX&&x<=maxX&&z>=minZ&&z<=maxZ;
  }
  return Math.hypot(x-door.x,z-door.z)<=door.radius;
}
const rectangle = box => ({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });

// GLTFLoader sanitizes dots out of runtime node names, may suffix duplicates,
// and places multi-material primitive meshes below the authored named node.
function belongsToAuthoredNode(THREE, mesh, authoredName, model) {
  const expected = THREE.PropertyBinding.sanitizeNodeName(authoredName);
  for (let object = mesh; object && object !== model; object = object.parent) {
    for (const name of [object.name, object.userData?.name]) {
      if (typeof name !== 'string') continue;
      const actual = THREE.PropertyBinding.sanitizeNodeName(name);
      if (actual === expected || actual.startsWith(expected + '_')) return true;
    }
  }
  return false;
}

/** Cache foundation support faces once; walking never raycasts the whole GLB. */
function foundationHeight(THREE, model) {
  const faces = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  model.traverse(mesh => {
    if (!mesh.isMesh || !belongsToAuthoredNode(THREE, mesh, 'Cube.107', model)) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some(material => THREE.PropertyBinding.sanitizeNodeName(material?.name ?? '') === 'Material019')) return;
    const positions = mesh.geometry?.attributes.position, indices = mesh.geometry?.index;
    if (!positions) return;
    const count = indices?.count ?? positions.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      for (const [point, component] of [[a, 0], [b, 1], [c, 2]]) {
        point.fromBufferAttribute(positions, indices ? indices.getX(offset + component) : offset + component).applyMatrix4(mesh.matrixWorld);
      }
      // Floor/step slopes only. Vertical sides and any high authored surfaces
      // cannot become an accidental platform above the player's head.
      const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      const minY = Math.min(a.y, b.y, c.y), maxY = Math.max(a.y, b.y, c.y);
      if (Math.abs(denominator) < 1e-10 || maxY > groundY + .6 || minY < groundY - .12 || maxY - minY > .24) continue;
      faces.push({
        ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, cx: c.x, cy: c.y, cz: c.z, denominator,
        minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x),
        minZ: Math.min(a.z, b.z, c.z), maxZ: Math.max(a.z, b.z, c.z),
      });
    }
  });
  return (x, z) => {
    let height = groundY;
    for (const face of faces) {
      if (x < face.minX - 1e-8 || x > face.maxX + 1e-8 || z < face.minZ - 1e-8 || z > face.maxZ + 1e-8) continue;
      const u = ((face.bz - face.cz) * (x - face.cx) + (face.cx - face.bx) * (z - face.cz)) / face.denominator;
      const v = ((face.cz - face.az) * (x - face.cx) + (face.ax - face.cx) * (z - face.cz)) / face.denominator;
      const w = 1 - u - v;
      if (Math.min(u, v, w) < -1e-8) continue;
      height = Math.max(height, u * face.ay + v * face.by + w * face.cy);
    }
    return height;
  };
}

/** Separate joined furniture/poles into real connected pieces before boxing. */
function componentObstacles(THREE, mesh, slices = 1) {
  const positions = mesh.geometry?.attributes.position;
  if (!positions) return [];
  const parent = Array.from({ length: positions.count }, (_, index) => index);
  const root = index => {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
    return index;
  };
  const join = (a, b) => { parent[root(b)] = root(a); };
  const points = new Map(), point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index);
    // Exported faces duplicate their corner vertices. Weld those corners for
    // component discovery without altering the rendered geometry.
    const key = [point.x, point.y, point.z].map(value => Math.round(value * 1e5)).join(',');
    if (points.has(key)) join(index, points.get(key));
    else points.set(key, index);
  }
  const indices = mesh.geometry.index, count = indices?.count ?? positions.count;
  for (let offset = 0; offset + 2 < count; offset += 3) {
    const a = indices ? indices.getX(offset) : offset;
    const b = indices ? indices.getX(offset + 1) : offset + 1;
    const c = indices ? indices.getX(offset + 2) : offset + 2;
    join(a, b); join(b, c);
  }
  const boxes = new Map();
  for (let index = 0; index < positions.count; index++) {
    const component = root(index);
    if (!boxes.has(component)) boxes.set(component, new THREE.Box3());
    boxes.get(component).expandByPoint(point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld));
  }
  const solidComponents = [...boxes.entries()].filter(([, box]) =>
    box.min.y < groundY + .65 && box.max.y > groundY + .28 && box.max.y - box.min.y > .25 &&
    box.max.x - box.min.x < 4 && box.max.z - box.min.z < 4);
  if (slices === 1) return solidComponents.map(([, box]) => rectangle(box));

  // A single box around the half-open diagonal door fills its empty approach
  // gap. Clip its actual faces into narrow X strips; each resulting box still
  // encloses the wood, while the existing rectangle controller keeps the gap.
  const faces = new Map(solidComponents.map(([component]) => [component, []]));
  for (let offset = 0; offset + 2 < count; offset += 3) {
    const a = indices ? indices.getX(offset) : offset;
    const component = root(a);
    if (!faces.has(component)) continue;
    faces.get(component).push([0, 1, 2].map(corner => new THREE.Vector3()
      .fromBufferAttribute(positions, indices ? indices.getX(offset + corner) : offset + corner)
      .applyMatrix4(mesh.matrixWorld)));
  }
  const clipX = (polygon, boundary, keepGreater) => {
    const result = [];
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length];
      const aInside = keepGreater ? a.x >= boundary : a.x <= boundary;
      const bInside = keepGreater ? b.x >= boundary : b.x <= boundary;
      if (aInside) result.push(a);
      if (aInside !== bInside) result.push(a.clone().lerp(b, (boundary - a.x) / (b.x - a.x)));
    }
    return result;
  };
  const precise = [], padding = .002;
  for (const [component, box] of solidComponents) {
    const width = (box.max.x - box.min.x) / slices;
    for (let slice = 0; slice < slices; slice++) {
      const minX = box.min.x + slice * width, maxX = box.min.x + (slice + 1) * width;
      const strip = new THREE.Box3();
      for (const triangle of faces.get(component)) {
        const polygon = clipX(clipX(triangle, minX, true), maxX, false);
        for (const vertex of polygon) strip.expandByPoint(vertex);
      }
      if (strip.isEmpty()) continue;
      precise.push({ minX: strip.min.x - padding, maxX: strip.max.x + padding,
        minZ: strip.min.z - padding, maxZ: strip.max.z + padding });
    }
  }
  return precise;
}

export function createOutdoorZone(THREE, environment, model) {
  model.updateWorldMatrix(true, true);
  environment.group.updateWorldMatrix(true, true);
  const heightAt = foundationHeight(THREE, model);
  const obstacles = [
    // Solid café envelope, excluding its raised front porch and rear patio.
    worldRect(-2.65, 2.38, -5.72, -.65),
    // The visible front-left stair flight has rails and is not a garden aisle.
    worldRect(-2.64, .45, -.76, 1.65),
  ];
  const blockingParts = new Set([
    'Cylinder.320', 'Cylinder.485', 'Cylinder.547', 'Cylinder.535',
    'Cube.224', 'Cube.223', 'Cube.222', 'Cube.208', 'Cube.147', 'Box001.001',
  ]);
  model.traverse(mesh => {
    if (mesh.isMesh && [...blockingParts].some(name => belongsToAuthoredNode(THREE, mesh, name, model))) {
      const isOpenDoor = belongsToAuthoredNode(THREE, mesh, 'Cylinder.485', model);
      obstacles.push(...componentObstacles(THREE, mesh, isOpenDoor ? 16 : 1));
    }
  });

  // Use the actual generated instance transforms rather than copying seeded
  // tree/lamp positions. Lawn planting, flowers and stepping stones stay open.
  for (const name of ['Tree trunks', 'Garden lamp posts']) {
    const mesh = environment.group.getObjectByName(name);
    if (!mesh?.isInstancedMesh) continue;
    const instanceMatrix = new THREE.Matrix4(), worldMatrix = new THREE.Matrix4();
    mesh.geometry.computeBoundingBox();
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, instanceMatrix);
      worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
      const box = mesh.geometry.boundingBox.clone().applyMatrix4(worldMatrix);
      obstacles.push(rectangle(box));
    }
  }
  const eyeHeight = 1.24, point = modelToWorld(1.667, 0, .2051282051282053);
  const door = exteriorDoor;
  return {
    spawn: { x: point.x, y: heightAt(point.x, point.z) + eyeHeight, z: point.z },
    yaw: Math.PI, pitch: -.025,
    bounds: {
      minX: -environment.width / 2 + .55, maxX: environment.width / 2 - .55,
      minZ: -environment.depth / 2 + .55, maxZ: environment.depth / 2 - .55,
    },
    obstacles, heightAt, eyeHeight, door, walkSpeed: 1.25 * (5 / 3),
  };
}
