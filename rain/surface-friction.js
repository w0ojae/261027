import {pathNoise} from './path-noise.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const unit=seed=>{
  let h=Math.imul(seed^0x7f4a7c15,0x45d9f3b);h=Math.imul(h^(h>>>16),0x45d9f3b);
  return ((h^(h>>>16))>>>0)/4294967296;
};
// The same stationary glass field applies to every drop, independently of birth time.
export function glassResistance(x,y){
  const noise=.5*pathNoise(x/37+pathNoise(y/59,731)*.35,193)+.5*pathNoise(y/43,521);
  return .15+1.85*(.5+.5*noise)**2;
}
export function surfaceSpeed(drop,speed,distance,dt){
  const contact=.35+1.65*unit(drop.pathSeed),rough=glassResistance(drop.x,drop.y)*contact;
  // More mass retains momentum; equal glass must not brake a larger body more.
  const decay=.004*rough*3.6/Math.max(.01,drop.mass);
  return Math.max(0,speed*Math.exp(-decay*distance)-26*rough*dt);
}
export function adhesionSeconds(drop,maxRadius){
  const phase=unit(drop.pathSeed+Math.imul(drop.restCycle||0,7919))*.65+
    clamp((glassResistance(drop.x,drop.y)-.15)/1.85,0,1)*.35;
  return .5+.5*(1-clamp(drop.r/maxRadius,0,1))*(.65+.35*phase);
}
