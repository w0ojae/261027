// A dense adhered microtexture, not extra free-flowing rain. Keep a few bigger
// surface beads available for absorption and coalescence.
// Double only the former 85% fine population; keep the 15% larger population.
export const GLASS_BEAD_DENSITY=1.85;
export const GLASS_BEAD_LIMIT=22200;
const fineShare=1.7/GLASS_BEAD_DENSITY;
export const glassBeadTarget=(width,height)=>{
  const former=Math.min(12000,Math.ceil(Math.max(0,width)*Math.max(0,height)/150));
  return Math.min(GLASS_BEAD_LIMIT,Math.round(former*GLASS_BEAD_DENSITY));
};
export function glassBead(width,height,rng=Math.random,x=rng()*width,y=rng()*height){
  const fine=rng()<fineShare;
  const r=fine?.8+rng()**2*1.2:2.5+rng()**2*2;
  return {x,y,r,aspect:fine?.95+rng()*.25:1.5};
}
export function seedGlassBeads(width,height,rng=Math.random){
  const count=glassBeadTarget(width,height);if(!count)return [];
  const cols=Math.max(1,Math.ceil(Math.sqrt(count*width/height))),rows=Math.ceil(count/cols);
  return Array.from({length:count},(_,i)=>glassBead(width,height,rng,
    (i%cols+.15+rng()*.7)*width/cols,
    (Math.floor(i/cols)+.15+rng()*.7)*height/rows));
}
