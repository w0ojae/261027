// Original zero-audio baseline; clocks advance only with the pane simulation.
export class HeartfeltRain{
  constructor(){this.reset();}
  reset(){this.time=12;this.staticTime=12;this.amount=.65;}
  update(dt){
    if(!Number.isFinite(dt)||dt<=0)return;
    this.time+=dt*.2;
    this.staticTime+=dt*.2;
  }
}
