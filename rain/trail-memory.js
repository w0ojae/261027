export function trailOpacity(age){
  // Double recovery speed: 1.5s clear hold, then a smooth 1s return to fog.
  const t=Math.max(0,Math.min(1,(age-1.5)/1));
  return 1-t*t*(3-2*t);
}

// One timestamp per mask pixel: repeated passes renew only the area they touch.
export class TrailMemory {
  constructor(width,height){this.time=0;this.resize(width,height);}
  resize(width,height){
    const oldW=this.width,oldH=this.height,oldTimes=this.times,oldCoverage=this.coverage;
    this.width=width;this.height=height;
    this.times=new Float64Array(width*height);this.times.fill(-Infinity);
    this.coverage=new Float32Array(width*height);
    this.fullAlpha=new Uint8Array(width*height);
    this.active=new Int32Array(width*height);this.present=new Uint8Array(width*height);this.activeCount=0;
    this.generation=(this.generation||0)+1;this.outputs??=new WeakMap();
    if(oldTimes)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const old=Math.min(oldH-1,Math.floor(y*oldH/height))*oldW+Math.min(oldW-1,Math.floor(x*oldW/width));
      const i=y*width+x;this.times[i]=oldTimes[old];this.coverage[i]=oldCoverage[old];
      this.fullAlpha[i]=Math.round(255*this.coverage[i]);
      if(this.coverage[i]>0&&trailOpacity(this.time-this.times[i])>0){this.active[this.activeCount++]=i;this.present[i]=1;}
    }
  }
  clear(){this.time=0;this.times.fill(-Infinity);this.coverage.fill(0);this.present.fill(0);this.activeCount=0;this.generation++;}
  advance(dt){if(Number.isFinite(dt)&&dt>0)this.time+=dt;}
  stamp(x0,y0,x1,y1,radius,endRadius=radius,roundCaps=true,inset=false){
    const dx=x1-x0,dy=y1-y0,length=dx*dx+dy*dy;
    const extent=Math.max(radius,endRadius),segmentLength=Math.sqrt(length);
    const left=Math.max(0,Math.floor(Math.min(x0,x1)-extent-1)),right=Math.min(this.width-1,Math.ceil(Math.max(x0,x1)+extent+1));
    const top=Math.max(0,Math.floor(Math.min(y0,y1)-extent-1)),bottom=Math.min(this.height-1,Math.ceil(Math.max(y0,y1)+extent+1));
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
      const projection=length?((x+.5-x0)*dx+(y+.5-y0)*dy)/length:0;
      // Water trails end at the current head; only finger strokes use round caps.
      if(!roundCaps&&length&&(projection*segmentLength<-.5||(projection-1)*segmentLength>.5))continue;
      const t=Math.max(0,Math.min(1,projection)),width=radius+(endRadius-radius)*t;
      const distance=Math.hypot(x+.5-x0-dx*t,y+.5-y0-dy*t);
      // Water clears up to its visible contour, with feathering inside that edge.
      // Finger wiping keeps the existing soft round stroke.
      let coverage=Math.max(0,Math.min(1,inset?(width>0?(width-distance)/Math.min(1,width):0):width+.5-distance));
      if(!roundCaps&&length)coverage=Math.min(coverage,projection*segmentLength+.5,(1-projection)*segmentLength+.5);
      if(!coverage)continue;
      const i=y*this.width+x;
      this.coverage[i]=Math.max(coverage,this.coverage[i]*trailOpacity(this.time-this.times[i]));
      this.times[i]=this.time;
      this.fullAlpha[i]=Math.round(255*this.coverage[i]);
      if(!this.present[i]){this.active[this.activeCount++]=i;this.present[i]=1;}
    }
  }
  render(data){
    let changed=false;
    if(this.outputs.get(data)!==this.generation){
      data.fill(255);for(let i=3;i<data.length;i+=4)data[i]=0;
      this.outputs.set(data,this.generation);changed=true;
    }
    let retained=0;
    // Dense trails are faster in contiguous memory; sparse trails skip dry pixels.
    const dense=this.activeCount>this.times.length*.2,count=dense?this.times.length:this.activeCount;
    for(let j=0;j<count;j++){
      const i=dense?j:this.active[j];if(dense&&!this.present[i])continue;
      const age=this.time-this.times[i];
      let alpha=this.fullAlpha[i];
      if(age>=2.5)alpha=0;
      else if(age>1.5){const t=age-1.5;alpha=Math.round(255*this.coverage[i]*(1-t*t*(3-2*t)));}
      if(data[i*4+3]!==alpha){data[i*4+3]=alpha;changed=true;}
      if(alpha===0&&age>=2.5){this.present[i]=0;this.coverage[i]=0;}
      else this.active[retained++]=i;
    }
    this.activeCount=retained;
    return changed;
  }
}
