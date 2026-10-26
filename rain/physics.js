// Area-based approximation: mass = radius². Shared original drop state only.
export const clamp = (x,a,b) => Math.max(a, Math.min(b,x));
export function makeDrop(x,y,r,flowing=false) {
  return {x,y,r,mass:r*r,vx:0,vy:0,rotation:0,mergePull:0,wobble:0,dead:false,age:0,trailDistance:0,flowing,slip:0,rest:0,spreadX:.8,spreadY:.65};
}
