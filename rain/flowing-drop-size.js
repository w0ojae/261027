// Display-only maximum: 3 -> 1.5, half of the 8.64 logical physical radius.
// Keep this independent of the physics module, which also imports orientation.
export const MAX_FLOWING_RADIUS=4.32;
export function renderedDropRadius(drop){
  // A runoff head keeps its cap during adhesion, avoiding a size jump at rest.
  const runoff=drop.flowing||drop.travelDistance>0||drop.heartfelt;
  return runoff?Math.min(drop.r,MAX_FLOWING_RADIUS):drop.r;
}
