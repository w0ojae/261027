export const DEFAULT_MASS_SCALE=.1;
export function massScale(value){return Math.max(.01,Math.min(1,Number.isFinite(value)?value:DEFAULT_MASS_SCALE));}
export const dropMass=(r,scale=DEFAULT_MASS_SCALE)=>r*r*massScale(scale);
