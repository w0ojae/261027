// Stateful adaptation of Heartfelt, Martijn Steinrucken (BigWings), 2017.
// https://www.shadertoy.com/view/ltffzl — CC BY-NC-SA 3.0.
// Original cell hashes, spawn positions and lateral motion share CPU collisions.
import createCanvas from './create-canvas.js';
import {MAX_RADIUS} from './codrops-physics.js?v=10';
import {dropMass} from './drop-mass.js';

export const RAIN_ZOOM=2.7;
const fract=x=>x-Math.floor(x);
export function smooth(a,b,x){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);}
export const saw=(b,t)=>smooth(0,b,t)*smooth(1,b,t);
export function hash13(p){
  let x=fract(p*.1031),y=fract(p*.11369),z=fract(p*.13787);
  const dot=x*(y+19.19)+y*(z+19.19)+z*(x+19.19);x+=dot;y+=dot;z+=dot;
  return [fract((x+y)*z),fract((x+z)*y),fract((y+z)*x)];
}
const columnShift=x=>fract(Math.sin(x*12345.564)*7658.76);
export function headPosition(ix,iy,layer,rain,width,height){
  const n=hash13(ix*35.2+iy*2376.1),t=rain.time;
  const y=(saw(.85,fract(t+n[2]))-.5)*.9+.5;
  const uvY=(iy+y)/2-t*.75-columnShift(ix);
  const wiggle=Math.sin(uvY*20+Math.sin(uvY*20));
  const x=(n[0]-.5+wiggle*(.5-Math.abs(n[0]-.5))*(n[2]-.5))*.7;
  const localX=(ix+.5+x)/12/layer,localY=uvY/layer;
  return {
    x:width/2+(localX)*height/RAIN_ZOOM,
    y:height/2-localY*height/RAIN_ZOOM,
    r:Math.min(MAX_RADIUS,.4*height/(12*RAIN_ZOOM*layer)),
    tail:Math.max(0,(1-y)*height/(2*RAIN_ZOOM*layer))
  };
}

export class HeartfeltField{
  constructor({canvasFactory=createCanvas}={}){
    this.texture=canvasFactory(1,1);this.ctx=this.texture.getContext('2d');
    this.records=[];this.consumed=new Set();this.heads=new Map();this.frame=0;this.cursor=0;
    this.visibility=new Uint8Array(256);this.visibilityTime=NaN;this.visibilityAmount=NaN;this.revision=0;
  }
  seed(width,height,map){
    this.width=width;this.height=height;this.heads.clear();this.records=[];this.consumed.clear();this.cursor=0;
    this.visibilityTime=NaN;
    this.originX=Math.floor(-width/height*RAIN_ZOOM*20)-2;this.originY=Math.floor(-RAIN_ZOOM*20)-2;
    this.cols=Math.ceil(width/height*RAIN_ZOOM*40)+5;this.rows=Math.ceil(RAIN_ZOOM*40)+5;
    this.texture.width=this.cols;this.texture.height=this.rows;this.pixels=this.ctx.createImageData(this.cols,this.rows);
    for(let row=0;row<this.rows;row++)for(let col=0;col<this.cols;col++){
      const ix=this.originX+col,iy=this.originY+row,index=(row*this.cols+col)*4;
      const n=hash13(ix*107.45+iy*3543.654).map(value=>Math.round(value*255)/255);
      const record={index,nz:n[2],phase:Math.round(n[2]*255),alive:false,
        enabled:(map.physics?.rainIntensity??1)>=1||n[0]<(map.physics?.rainIntensity??1),
        cycle:Math.floor((this.rain?.staticTime??12)+n[2])};
      const bead={x:width/2+(ix+.5+(n[0]-.5)*.7)*height/(40*RAIN_ZOOM),
        y:height/2-(iy+.5+(n[1]-.5)*.7)*height/(40*RAIN_ZOOM),r:.3*height/(40*RAIN_ZOOM),aspect:1,source:record};
      bead.mass=dropMass(bead.r,map.massScale);bead.pathSeed=index;
      record.bead=bead;
      this.pixels.data.set([n[0]*255,n[1]*255,n[2]*255,0],index);
      if(bead.x>=0&&bead.x<=width&&bead.y>=0&&bead.y<=height&&map.beads.add(bead)){
        record.alive=true;this.pixels.data[index+3]=record.enabled?255:0;
      }
      this.records.push(record);
    }
    this.dirty=true;
  }
  visible(bead){
    if(!bead.source)return true;
    if(!bead.source.alive||bead.source.enabled===false)return false;
    return this.phaseVisible(bead.source);
  }
  phaseVisible(record){
    const rain=this.rain||{staticTime:12,amount:.65};
    if(this.visibilityTime!==rain.staticTime||this.visibilityAmount!==rain.amount){
      this.visibilityTime=rain.staticTime;this.visibilityAmount=rain.amount;
      const level=smooth(-.5,1,rain.amount)*2;
      for(let i=0;i<256;i++){const n=i/255;this.visibility[i]=saw(.025,fract(rain.staticTime+n))*fract(n*10)*level>.32?1:0;}
    }
    return this.visibility[record.phase??Math.round(record.nz*255)]===1;
  }
  consume(bead){
    const record=bead.source;if(!record)return;
    record.alive=false;this.pixels.data[record.index+3]=0;this.dirty=true;
    const time=this.rain?.staticTime??12;
    record.returnAt=Math.floor(time+record.nz)+1-record.nz;
    this.consumed.add(record);
  }
  step(rain,physics,map){
    if(!physics.active&&!physics.ambient)return;
    this.rain=rain;this.frame++;
    for(const record of this.consumed){
      if(rain.staticTime<record.returnAt||(physics.rainIntensity??1)===0)continue;
      if(map.beads.add(record.bead)){
        record.cycle=NaN;
        record.alive=true;this.pixels.data[record.index+3]=record.enabled!==false?255:0;this.dirty=true;this.consumed.delete(record);
      }
    }
    let count=physics.drops.filter(d=>d.heartfelt&&!d.dead).length;
    const intensity=physics.rainIntensity??1;
    // Original quiet baseline: large heads at 3/5 density.
    const largeHeadDensity=.6;
    for(const cohort of intensity>1?[0,1]:[0])for(const layer of [1,1.85]){
      const layerRain=cohort?{...rain,time:rain.time+.371}:rain;
      const left=Math.floor(-this.width/this.height*RAIN_ZOOM*layer*6)-2;
      const right=Math.ceil(this.width/this.height*RAIN_ZOOM*layer*6)+2;
      for(let ix=left;ix<=right;ix++){
        const shift=rain.time*.75+columnShift(ix);
        const bottom=Math.floor((-RAIN_ZOOM*layer*.5+shift)*2)-2;
        const top=Math.ceil((RAIN_ZOOM*layer*.5+shift)*2)+2;
        for(let iy=bottom;iy<=top;iy++){
          const p=headPosition(ix,iy,layer,layerRain,this.width,this.height);
          if(p.x< -p.r||p.x>this.width+p.r||p.y< -p.r||p.y>this.height+p.r)continue;
          const key=`${cohort}:${layer}:${ix}:${iy}`;let state=this.heads.get(key);
          if(!state){
            const phase=hash13(ix*91.7+iy*173.3+layer*211+cohort*719);
            const density=Math.min(1,Math.max(0,intensity-cohort))*(layer===1?largeHeadDensity:1);
            if(count>=900||phase[0]>=density)continue;
            const d=physics.drop(p.x,p.y,p.r,true);d.heartfelt={layer,free:false,next:p,sampleX:p.x};d.isNew=true;
            // Existing rain enters at mixed phases rather than all starting at full speed.
            d.slide=.35+.65*phase[1];d.vy*=d.slide;
            if(phase[2]<.2){d.slide=d.vy=0;d.flowing=false;d.restTime=.5+.5*phase[1];d.restMass=d.mass;}
            physics.drops.push(d);state={drop:d,seen:this.frame};this.heads.set(key,state);count++;
          }
          state.seen=this.frame;
          if(!state.drop.dead&&!state.drop.heartfelt.free)state.drop.heartfelt.next=p;
        }
      }
    }
    for(const [key,state] of this.heads)if(state.seen<this.frame-120&&state.drop.dead)this.heads.delete(key);
    // Gate static cells at each fade cycle without changing existing wet beads.
    for(const record of this.records){
      const cycle=Math.floor(rain.staticTime+record.nz);
      if(record.cycle!==cycle){
        record.cycle=cycle;
        // Gate before the shader's fade begins, preserving the current appearance.
        if(record.alive){
          record.enabled=hash13(record.index*3.71+cycle*137)[0]<Math.min(1,intensity);
          this.pixels.data[record.index+3]=record.enabled?255:0;this.dirty=true;
        }
      }
    }
    // Spread stationary contact work across frames rather than comparing every
    // one of the twenty thousand beads with every other bead.
    for(let i=0;i<128&&this.records.length;i++){
      const record=this.records[this.cursor++%this.records.length];
      if(record.alive&&this.visible(record.bead))map.coalesce(record.bead,true);
    }
  }
  flush(){if(this.dirty){this.ctx.putImageData(this.pixels,0,0);this.dirty=false;this.revision++;}}
}
