// Temporary resistance from changes in travel direction, not the path's tilt.
export const DEFAULT_TURN_DRAG=2;
export const newTurnDrag=()=>({angle:null,loss:0,retention:1});
export function turnRetention(drop,vx,vy,dt,strength){
  const state=drop.turnDrag??=newTurnDrag();
  if(!Number.isFinite(dt)||dt<=0||!Number.isFinite(vx+vy))return state.retention;
  if(strength===0){state.angle=null;state.loss=0;state.retention=1;return 1;}
  const angle=Math.atan2(vx,vy);
  let change=state.angle===null?0:Math.abs(angle-state.angle);
  if(change>Math.PI)change=2*Math.PI-change;
  state.angle=angle;
  // Integrate angular speed with a 0.45s recovery; constant direction removes
  // resistance smoothly. The dt term keeps 30/60/120Hz tuning comparable.
  const recovery=Math.exp(-dt/.45);
  state.loss=Math.min(8,state.loss*recovery+strength*change*.45/dt*(1-recovery));
  state.retention=Math.exp(-state.loss);return state.retention;
}
