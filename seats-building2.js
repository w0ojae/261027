import { modelToWorld } from './building-placement.js?v=16';

// Measured cushion centers in the normalized GLB, before the building placement.
// The .75 local eye offset clears the window counter while keeping a seated view.
// Approach anchors stay in the existing walking aisles; seating may leave them.
const eyeOffset = .75;
const stoolTop = 1.96812;
const chairTop = 4.31474;
const horizontalLimit = 70 * Math.PI / 180;
const windowYaw = (x, z) => Math.atan2(-(2.283 - x), -(-3.717 - z));
const seat = (id, floor, label, cushion, yaw, approach, triggerRadius) => Object.freeze({
  id, floor, label,
  position: Object.freeze(modelToWorld(cushion[0], cushion[1] + eyeOffset, cushion[2])),
  yaw, maxYaw: horizontalLimit,
  approach: Object.freeze(modelToWorld(...approach)),
  triggerRadius,
  approachRadius: .35,
});

export const seats = Object.freeze([
  seat('cafe-window-front', 1, '1층 갈색 의자 1', [1.00673, stoolTop, -1.99265],
    windowYaw(1.00673, -1.99265), [1.45, 2.79, -1.99265], .68),
  seat('cafe-window-middle', 1, '1층 갈색 의자 2', [.86204, stoolTop, -2.80334],
    windowYaw(.86204, -2.80334), [1.45, 2.79, -2.80334], .68),
  seat('cafe-window-rear', 1, '1층 갈색 의자 3', [.86204, stoolTop, -3.60613],
    windowYaw(.86204, -3.60613), [1.45, 2.79, -3.60613], .68),
  seat('upper-front-window', 2, '2층 앞 창가 의자', [1.28939, chairTop, -1.35789],
    Math.PI, [.75, 5.17, -2.12], .86),
  seat('upper-right-front', 2, '2층 오른쪽 의자 1', [2.37242, chairTop, -1.72977],
    -Math.PI / 2, [1.28, 5.17, -2.12], .95),
  seat('upper-right-middle', 2, '2층 오른쪽 의자 2', [2.02358, chairTop, -2.50827],
    -Math.PI / 2, [1.28, 5.17, -2.60], .80),
  seat('upper-right-rear', 2, '2층 오른쪽 의자 3', [2.34506, chairTop, -3.43697],
    -Math.PI / 2, [1.28, 5.17, -3.43697], .90),
]);

/**
 * Choose the nearest reachable approach anchor, within both approach and seat
 * reach. Ranking by approach keeps the corner chair selectable from the aisle.
 */
export function findNearbySeat(position, floor, registry = seats) {
  if (!position || !['x', 'y', 'z'].every(axis => Number.isFinite(position[axis])) ||
    ![1, 2].includes(floor) || !Array.isArray(registry)) return null;
  let closest = null;
  let distance = Infinity;
  for (const candidate of registry) {
    if (candidate?.floor !== floor || !candidate.position || !candidate.approach ||
      !['x', 'z'].every(axis => Number.isFinite(candidate.position[axis]) && Number.isFinite(candidate.approach[axis])) ||
      !Number.isFinite(candidate.triggerRadius) || !Number.isFinite(candidate.approachRadius)) continue;
    const approachDistance = Math.hypot(position.x - candidate.approach.x, position.z - candidate.approach.z);
    const seatDistance = Math.hypot(position.x - candidate.position.x, position.z - candidate.position.z);
    if (approachDistance <= candidate.approachRadius && seatDistance <= candidate.triggerRadius && approachDistance < distance) {
      closest = candidate;
      distance = approachDistance;
    }
  }
  return closest;
}
