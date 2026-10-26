// One placement transform for the authored building, indoor cameras and rain.
export const modelScale = .78;
export const sourceHeightOffset = 12.93394660949707;
export const groundY = -.055;

// Cube.107 has an uneven underside. Keep 2/5 of the previous full-seating
// adjustment to preserve the preferred visible foundation height.
const previousUndersideTop = .15323206922131688;
const fullySeatedYOffset = groundY - .005 - previousUndersideTop;
export const buildingYOffset = fullySeatedYOffset * (2 / 5);
export const modelPosition = Object.freeze({
  x: -.1 * modelScale,
  y: -.8239 * modelScale + buildingYOffset,
  z: 3 * modelScale,
});
export const modelToWorld = (x, y, z) => ({
  x: x * modelScale + modelPosition.x,
  y: y * modelScale + modelPosition.y,
  z: z * modelScale + modelPosition.z,
});
export const rainShelter = Object.freeze({
  minX: -2.85, maxX: 2.91, minZ: -2.47, maxZ: 2.47,
  topY: 4.45 + buildingYOffset,
});
