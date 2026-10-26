const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const newDropShape=()=>({strain:0,velocity:0,pulse:0,pulseVelocity:0});
export function pulseDrop(d,amount){
  d.shape??=newDropShape();
  d.shape.pulseVelocity=clamp(d.shape.pulseVelocity-5*amount,-5,5);
}
export function followDropShape(d,dt){
  d.shape??=newDropShape();const s=d.shape;
  const target=d.flowing?clamp(Math.hypot(d.vx,d.vy)/140,0,1):0;
  // A damped spring lets the body lag behind speed changes and briefly rebound.
  // Small substeps keep the visual response stable at either 30 or 60 Hz.
  const count=Math.max(1,Math.ceil(dt*120)),h=dt/count,weight=1+Math.min(20,d.r)*.025;
  for(let i=0;i<count;i++){
    s.velocity+=((target-s.strain)*180/weight-s.velocity*16/weight)*h;
    s.strain+=s.velocity*h;
    s.pulseVelocity+=(-s.pulse*240-s.pulseVelocity*18)*h;
    s.pulse+=s.pulseVelocity*h;
  }
}
