// Codrops RGBA sprites: green/red normals, blue thickness and alpha contour.
import createCanvas from './create-canvas.js';
import {TrailMemory} from './trail-memory.js';
import {BeadField} from './bead-field.js';
import {glassBead,glassBeadTarget,seedGlassBeads,GLASS_BEAD_DENSITY,GLASS_BEAD_LIMIT} from './glass-beads.js';
import {rotateNormals,deformDrop,dropGeometry,dropTrailRadius} from './drop-orientation.js?v=37';
import {renderedDropRadius} from './flowing-drop-size.js';
import {MIN_RADIUS,MAX_RADIUS} from './codrops-physics.js?v=10';
import {HeartfeltField,smooth} from './heartfelt-field.js?v=10';
import {DEFAULT_MASS_SCALE,massScale,dropMass} from './drop-mass.js';
import {TrailBeads} from './trail-beads.js?v=10';
import {renderSize} from './render-size.js';
import {rainInterval} from './rain-intensity.js';
import {createDropContour} from './drop-contour.js';
export class WaterMap {
  constructor(dropAlpha,dropColor,{surfaceDensity=1}={}){
    this.surfaceDensity=surfaceDensity;
    this.massScale=DEFAULT_MASS_SCALE;
    this.field=new HeartfeltField();
    this.heightMap=createCanvas(1,1);this.hctx=this.heightMap.getContext('2d');
    this.residueMap=createCanvas(1,1);this.rctx=this.residueMap.getContext('2d');
    this.heightSprite=createCanvas(64,64);
    this.trailContours={normal:[],heartfelt:[]};
    const hc=this.heightSprite.getContext('2d'),hp=hc.createImageData(64,64);
    for(let y=0;y<64;y++)for(let x=0;x<64;x++)hp.data[(y*64+x)*4+3]=255*smooth(1,0,Math.hypot((x-31.5)/31.5,(y-31.5)/31.5));
    hc.putImageData(hp,0,0);
    this.heightSprites=Array.from({length:7},(_,i)=>{
      const sprite=createCanvas(64,64),ctx=sprite.getContext('2d'),pixels=ctx.createImageData(64,64);
      const warped=deformDrop(hp.data,i/6);
      this.trailContours.heartfelt[i]=createDropContour(warped);
      // Only alpha is height here; red is reserved for the thin runoff trail.
      for(let p=3;p<warped.length;p+=4)pixels.data[p]=warped[p];
      ctx.putImageData(pixels,0,0);return sprite;
    });
    this.canvas=createCanvas(1,1);this.ctx=this.canvas.getContext('2d');
    this.mask=createCanvas(1,1);this.mctx=this.mask.getContext('2d');
    this.trailMemory=new TrailMemory(1,1);
    this.droplets=createCanvas(1,1);this.dctx=this.droplets.getContext('2d');
    this.sprites=Array.from({length:32},(_,i)=>{
      const c=createCanvas(64,64),ctx=c.getContext('2d');
      const color=createCanvas(64,64),colorCtx=color.getContext('2d');
      colorCtx.drawImage(dropColor,0,0,64,64);
      colorCtx.globalCompositeOperation='screen';colorCtx.fillStyle=`rgb(0,0,${Math.round(i/31*254)})`;colorCtx.fillRect(0,0,64,64);
      ctx.drawImage(dropAlpha,0,0,64,64);ctx.globalCompositeOperation='source-in';ctx.drawImage(color,0,0);
      ctx.globalCompositeOperation='source-over';
      return c;
    });
    this.shapedSprites=new Map();
    this.spritePixels=this.sprites.map(sprite=>sprite.getContext('2d').getImageData(0,0,64,64));
    this.deformedPixels=new Map();
    // Thickness levels share alpha; keep seven matching shape contours at startup.
    this.trailContours.normal=Array.from({length:7},(_,i)=>createDropContour(deformDrop(this.spritePixels[0].data,i/6)));
  }
  orientedSprite(index,angle=0,strength=0){
    const form=Math.round(angle/Math.PI*24),shape=Math.round(strength*6);
    if(form===0&&shape===0)return this.sprites[index];
    const key=`${index}:${form}:${shape}`,profile=`${index}:${shape}`;
    if(!this.shapedSprites.has(key)){
      if(!this.deformedPixels.has(profile))this.deformedPixels.set(profile,deformDrop(this.spritePixels[index].data,shape/6));
      const sprite=createCanvas(64,64),ctx=sprite.getContext('2d'),pixels=ctx.createImageData(64,64);
      pixels.data.set(rotateNormals(this.deformedPixels.get(profile),form/24*Math.PI));ctx.putImageData(pixels,0,0);
      // Cache normal rotation; Canvas rotates the corresponding alpha outline.
      if(this.shapedSprites.size>=256)this.shapedSprites.delete(this.shapedSprites.keys().next().value);
      this.shapedSprites.set(key,sprite);
    }
    return this.shapedSprites.get(key);
  }
  resize(w,h){
    const size=renderSize(w,h);
    this.width=w;this.height=h;this.canvas.width=size.width;this.canvas.height=size.height;
    this.heightMap.width=size.width;this.heightMap.height=size.height;
    this.residueMap.width=size.width;this.residueMap.height=size.height;
    const maskSize=renderSize(w,h,1,1000000);
    this.mask.width=maskSize.width;this.mask.height=maskSize.height;
    this.trailMemory.resize(this.mask.width,this.mask.height);
    this.maskPixels=this.mctx.createImageData(this.mask.width,this.mask.height);
    this.trailMemory.render(this.maskPixels.data);this.mctx.putImageData(this.maskPixels,0,0);
    this.droplets.width=size.width;this.droplets.height=size.height;
    for(const ctx of [this.ctx,this.hctx,this.rctx,this.dctx])ctx.setTransform(size.width/w,0,0,size.height/h,0,0);
    this.maskRevision=(this.maskRevision||0)+1;this.seed();
  }
  seed(){
    this.beads=new BeadField(GLASS_BEAD_LIMIT);this.counter=0;this.beadArrival=rainInterval(Math.random);
    this.trailBeads=new TrailBeads();
    this.dirty=true;
    this.rctx.clearRect(0,0,this.width,this.height);
    this.dctx.clearRect(0,0,this.width,this.height);
    const seeded=seedGlassBeads(this.width,this.height),density=(this.surfaceDensity??1)*(this.physics?.rainIntensity??1);
    const count=Math.min(GLASS_BEAD_LIMIT,Math.round(seeded.length*density));
    for(let i=0;i<count;i++)this.drawBead(seeded[Math.floor(i/Math.min(1,density))]??glassBead(this.width,this.height));
    this.field?.seed(this.width,this.height,this);
  }
  drawBead(bead){
    bead.mass=dropMass(bead.r,this.massScale);
    const {x,y,r,aspect}=bead;
    const index=Math.floor(Math.max(0,Math.min(1,(r-MIN_RADIUS)/(MAX_RADIUS-MIN_RADIUS)))*.9*(this.sprites.length-1));
    if(this.beads.add(bead)){
      this.dirty=true;
      if(bead.heartfeltResidue)this.rctx.drawImage(this.heightSprite,x-r,y-r,r*2,r*2);
      else this.dctx.drawImage(this.sprites[index],x-r,y-r*aspect,r*2,r*2*aspect);
      return true;
    }
    return false;
  }
  tinyDrop(){
    const bead=glassBead(this.width,this.height);
    if(!(this.field&&this.coalesce(bead)))this.drawBead(bead);
  }
  coalesce(bead,registered=false){
    if(!this.physics)return false;
    const near=this.beads.peek(bead.x,bead.y,bead.r,b=>this.field.visible(b),registered?bead:undefined);
    if(!near.length)return false;
    const removed=registered?[bead,...near]:near;
    let mass=bead.r*bead.r,x=bead.x*mass,y=bead.y*mass;
    for(const b of near){const area=b.r*b.r*.8;mass+=area;x+=b.x*area;y+=b.y*area;}
    this.beads.remove(removed);this.eraseBeads(removed);
    const merged={x:x/mass,y:y/mass,r:Math.min(MAX_RADIUS,Math.sqrt(mass)),aspect:1.5,
      heartfeltResidue:bead.heartfeltResidue||near.some(b=>b.heartfeltResidue)};
    merged.mass=dropMass(merged.r,this.massScale);
    this.physics.merges+=near.length;
    if(merged.r>=MIN_RADIUS&&this.physics.drops.filter(d=>!d.heartfelt&&!d.dead).length<420){
      const drop=this.physics.drop(merged.x,merged.y,merged.r,true);drop.spreadX=drop.spreadY=0;
      this.physics.drops.push(drop);
    }else this.drawBead(merged);
    return true;
  }
  updateRain(rain,physics){this.physics=physics;this.field.step(rain,physics,this);}
  setMassScale(value){
    this.massScale=massScale(value);
    for(const cell of this.beads.cells.values())for(const bead of cell)bead.mass=dropMass(bead.r,this.massScale);
    for(const record of this.field.records)record.bead.mass=dropMass(record.bead.r,this.massScale);
  }
  absorb(x,y,r,x0=x,y0=y){
    const beads=[],steps=Math.max(1,Math.min(48,Math.ceil(Math.hypot(x-x0,y-y0)/Math.max(1,r*.5))));
    for(let i=1;i<=steps;i++)beads.push(...this.beads.take(x0+(x-x0)*i/steps,y0+(y-y0)*i/steps,r,b=>!this.field||this.field.visible(b)));
    this.eraseBeads(beads);return beads;
  }
  eraseBeads(beads){
    if(beads.length)this.dirty=true;
    const c=this.dctx;
    c.save();c.globalCompositeOperation='destination-out';
    this.rctx?.save();if(this.rctx)this.rctx.globalCompositeOperation='destination-out';
    for(const b of beads){
      if(b.source){this.field.consume(b);continue;}
      if(b.heartfeltResidue){
        this.rctx.beginPath();this.rctx.arc(b.x,b.y,b.r+1,0,Math.PI*2);this.rctx.fill();continue;
      }
      c.beginPath();c.ellipse(b.x,b.y,b.r+1,b.r*(b.aspect??1.5)+1,0,0,Math.PI*2);c.fill();
    }
    c.restore();
    this.rctx?.restore();
  }
  condense(dt){
    const intensity=this.physics?.rainIntensity??1;
    if(!intensity){this.counter=0;return;}
    this.beadArrival??=rainInterval(Math.random);
    if(this.field){
      this.counter=(this.counter||0)+dt*300*GLASS_BEAD_DENSITY*(this.width*this.height/1000000)*intensity;
      while(this.counter>=this.beadArrival&&this.beads.count<GLASS_BEAD_LIMIT){this.tinyDrop();this.counter-=this.beadArrival;this.beadArrival=rainInterval(Math.random);}
      if(this.beads.count>=GLASS_BEAD_LIMIT)this.counter=0;
      return;
    }
    const target=Math.round(glassBeadTarget(this.width,this.height)*(this.surfaceDensity??1));
    if(this.beads.count>=target){this.counter=0;return;}
    this.counter=(this.counter||0)+dt*300*GLASS_BEAD_DENSITY*(this.width*this.height/1000000)*(this.surfaceDensity??1)*intensity;
    while(this.counter>=this.beadArrival&&this.beads.count<target){this.tinyDrop();this.counter-=this.beadArrival;this.beadArrival=rainInterval(Math.random);}
    if(this.beads.count>=target)this.counter=0;
  }
  clear(){this.trailMemory.clear();this.maskDirty=false;this.fadeTime=0;this.mctx.clearRect(0,0,this.mask.width,this.mask.height);this.maskRevision=(this.maskRevision||0)+1;this.seed();}
  decay(dt){
    this.trailMemory.advance(dt);
    this.fadeTime=(this.fadeTime||0)+dt;
    if(this.fadeTime<.05)return;
    this.fadeTime%=.05;
    this.flushMask();
  }
  flushMask(){
    this.maskDirty=false;
    if(this.maskPixels&&this.trailMemory.render(this.maskPixels.data)){
      this.mctx.putImageData(this.maskPixels,0,0);this.maskRevision=(this.maskRevision||0)+1;
    }
  }
  trail(x0,y0,x1,y1,r,drop){
    const scaleX=this.mask.width/this.width,scaleY=this.mask.height/this.height;
    let contour,opacity=1;
    if(drop){
      const shape=Math.round(dropGeometry(drop).shape*6),family=drop.heartfelt?'heartfelt':'normal';
      contour=this.trailContours?.[family]?.[shape];
      if(drop.heartfelt){
        const amount=this.field?.rain?.amount??.65;
        opacity=drop.heartfelt.layer===1?smooth(.25,.75,amount):smooth(0,.5,amount);
      }
    }
    const width=drop?dropTrailRadius(drop,x1-x0,y1-y0,contour,opacity):r;
    const scale=Math.min(scaleX,scaleY),previous=drop?.trailRadius??width;
    this.trailMemory.stamp(x0*scaleX,y0*scaleY,x1*scaleX,y1*scaleY,previous*scale,width*scale,!drop,Boolean(drop));
    if(drop)drop.trailRadius=width;
    if(drop)for(const bead of this.trailBeads.sample(drop,x0,y0,x1,y1,this.height)){
      if(bead.x<0||bead.x>this.width||bead.y<0||bead.y>this.height||this.beads.count>=GLASS_BEAD_LIMIT)continue;
      if(!this.coalesce(bead))this.drawBead(bead);
    }
  }
  draw(drops){
    if(this.maskDirty)this.flushMask();
    this.field.flush();
    if(this.dirty===false)return;this.dirty=false;this.revision=(this.revision||0)+1;
    const c=this.ctx;c.clearRect(0,0,this.width,this.height);
    this.hctx.clearRect(0,0,this.width,this.height);
    if(this.residueMap)this.hctx.drawImage(this.residueMap,0,0,this.width,this.height);
    c.drawImage(this.droplets,0,0,this.width,this.height);
    for(const d of drops){
      const r=renderedDropRadius(d),{angle,shape,sx,sy}=dropGeometry(d);
      if(d.heartfelt){
        const h=this.hctx,amount=this.field.rain?.amount??.65;
        h.save();h.translate(d.x,d.y);h.rotate(angle);
        h.globalAlpha=d.heartfelt.layer===1?smooth(.25,.75,amount):smooth(0,.5,amount);
        const tail=!d.flowing||d.heartfelt.free?0:Math.min(60,d.heartfelt.next.tail||0);
        if(tail>0){
          h.fillStyle='rgba(255,0,0,.35)';h.beginPath();h.moveTo(-r*.18,-r*sy*.5);
          h.quadraticCurveTo(-r*.3,-tail*.5,0,-tail);
          h.quadraticCurveTo(r*.3,-tail*.5,r*.18,-r*sy*.5);h.fill();
        }
        h.drawImage(this.heightSprites[Math.round(shape*6)],-r*sx,-r*sy,r*2*sx,r*2*sy);h.restore();
        continue;
      }
      const depth=Math.max(0,Math.min(1,(d.r-MIN_RADIUS)/(MAX_RADIUS-MIN_RADIUS)))*.9/(1+((d.spreadX||0)+(d.spreadY||0))*.5);
      const sprite=this.orientedSprite(Math.floor(depth*31),angle,shape);
      c.save();c.translate(d.x,d.y);c.rotate(angle);
      c.drawImage(sprite,-r*sx,-r*sy,r*2*sx,r*2*sy);c.restore();
    }
  }
}
