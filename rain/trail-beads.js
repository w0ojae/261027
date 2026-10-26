import {pathNoise} from './path-noise.js';
import {RAIN_ZOOM} from './heartfelt-field.js?v=10';
import {dropGeometry} from './drop-orientation.js';

// Sample the travelled path, then leave beads only after the body has passed.
// Weak keys discard queued samples together with dead/reset drops.
export class TrailBeads{
  constructor(){this.paths=new WeakMap();}
  sample(drop,x0,y0,x1,y1,height){
    const length=Math.hypot(x1-x0,y1-y0);if(!drop||length<=0)return [];
    const spacing=Math.max(2,height/(40*RAIN_ZOOM)*.55);
    const base=Math.min(1.6,.3*height/(40*RAIN_ZOOM));
    let state=this.paths.get(drop);
    if(!state){state={distance:0,next:spacing,pending:[]};this.paths.set(drop,state);}
    const end=state.distance+length,seed=drop.pathSeed,phase=drop.pathPhase;
    while(state.next<=end){
      const distance=state.next,t=(distance-state.distance)/length;
      const density=.45+.3*pathNoise(distance/45+phase,seed);
      const chance=.5+.5*pathNoise(distance/3.7+phase+19.31,seed^0x73a4);
      if(chance<density){
        const offset=pathNoise(distance/13+phase,seed^0x12ba)*drop.r*.2;
        state.pending.push({distance,x:x0+(x1-x0)*t-(y1-y0)/length*offset,
          y:y0+(y1-y0)*t+(x1-x0)/length*offset,
          r:base*(.7+.25*pathNoise(distance/7+phase,seed^0x5ea1)),aspect:1,heartfeltResidue:true});
      }
      state.next+=spacing;
    }
    state.distance=end;
    const clearance=Math.max(drop.r*dropGeometry(drop).sy,drop.r*1.2)+base*3+2,ready=[];
    while(state.pending.length&&end-state.pending[0].distance>clearance){
      const bead=state.pending.shift();
      // A curved path can return toward a pending bead; never spawn in the body.
      if(((bead.x-x1)/(drop.r*.75+bead.r))**2+((bead.y-y1)/(drop.r*1.2+bead.r))**2>1)ready.push(bead);
    }
    if(state.pending.length>64)state.pending.splice(0,state.pending.length-64);
    return ready;
  }
}
