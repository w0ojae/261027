// One-dimensional gradient noise with Perlin's quintic interpolation.
// Algorithm reference: https://cs.nyu.edu/~perlin/noise/ (own hash and 1D implementation).
const gradient=(cell,seed)=>{
  let h=Math.imul(cell^seed,0x45d9f3b);h=Math.imul(h^(h>>>16),0x45d9f3b);
  return ((h^(h>>>16))&1)?1:-1;
};
export function pathNoise(position,seed){
  const cell=Math.floor(position),t=position-cell;
  const fade=t*t*t*(t*(t*6-15)+10),a=gradient(cell,seed)*t,b=gradient(cell+1,seed)*(t-1);
  return 2*(a+(b-a)*fade);
}
export function pathVelocity(drop,dt,strength=1,speed=drop.vy){
  // Distance-based sampling keeps the bends attached to the path when speed changes.
  drop.pathDistance+=drop.vy*dt;
  if(strength===0){drop.pathVx=0;return 0;}
  const p=drop.pathDistance/90+drop.pathPhase;
  const noise=.75*pathNoise(p,drop.pathSeed)+.25*pathNoise(p*2.1,drop.pathSeed^0x9e3779b9);
  const target=noise*Math.min(60,speed*.3)*strength;
  drop.pathVx+=(target-drop.pathVx)*(1-Math.exp(-dt/.18));
  return drop.pathVx;
}
