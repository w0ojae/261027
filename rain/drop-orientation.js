import {contourRadius} from './drop-contour.js';
import {renderedDropRadius} from './flowing-drop-size.js';

// Water texture encodes X normal in green and Y normal in red.
export function rotateNormals(source,angle){
  const result=new Uint8ClampedArray(source),c=Math.cos(angle),s=Math.sin(angle);
  for(let i=0;i<result.length;i+=4){
    const x=source[i+1]-127.5,y=source[i]-127.5;
    result[i+1]=127.5+x*c-y*s;result[i]=127.5+x*s+y*c;
  }
  return result;
}

// Canvas local +Y is the leading end. Rightward motion turns that axis clockwise
// on screen via a negative Canvas rotation; do not attenuate this angle again.
export function followFlow(d,dt){
  const speed=Math.hypot(d.vx||0,d.vy||0);
  const target=d.flowing&&speed>.5?-Math.atan2(d.vx,Math.max(0,d.vy)):0;
  const lag=.09+Math.min(20,d.r)*.008;
  d.rotation=(d.rotation||0)+(target-(d.rotation||0))*(1-Math.exp(-dt/lag));
}

// A round adhered bead gradually becomes a broad leading head and a narrow tail.
// The alpha and normal field share the same warp so refraction follows the body.
export function deformDrop(source,strength,width=64){
  const amount=Math.max(0,Math.min(1,strength)),result=new Uint8ClampedArray(source.length);
  const half=(width-1)/2;
  for(let y=0;y<width;y++){
    const ny=(y-half)/half;
    const profile=1+amount*(.2*ny-.12*(1-ny*ny));
    const derivative=amount*(.2+.24*ny);
    for(let x=0;x<width;x++){
      const destination=(y*width+x)*4;
      const sx=half+(x-half)/profile;
      if(sx<0||sx>width-1)continue;
      const left=Math.floor(sx),right=Math.min(width-1,left+1),fraction=sx-left;
      const a=(y*width+left)*4,b=(y*width+right)*4;
      for(let channel=0;channel<4;channel++)result[destination+channel]=source[a+channel]*(1-fraction)+source[b+channel]*fraction;
      const nx=(result[destination+1]-127.5)/profile;
      const normalY=result[destination]-127.5-nx*((sx-half)/half)*derivative;
      result[destination+1]=127.5+nx;result[destination]=127.5+normalY;
    }
  }
  return result;
}

export function dropGeometry(d){
  if(d.shape){
    const motion=Math.max(0,Math.min(1,d.shape.strain)),stretch=1+1.4*motion;
    const pulse=Math.max(-.2,Math.min(.2,d.shape.pulse));
    return {angle:d.rotation||0,shape:motion,
      sx:(1+(d.spreadX||0)*.12)*Math.exp(-pulse)/Math.sqrt(stretch),
      sy:1.05*(1+(d.spreadY||0)*.12)*Math.exp(pulse)*Math.sqrt(stretch)};
  }
  const speed=Math.hypot(d.vx||0,d.vy||0);
  const motion=Math.max(0,Math.min(1,(d.stretch||0)*2+speed/700));
  // Relax to almost round at rest; extend and narrow along the rotated travel axis.
  const stretch=1+.65*motion;
  return {angle:d.rotation||0,shape:motion,sx:(1+(d.spreadX||0))/Math.sqrt(stretch),sy:1.08*(1+(d.spreadY||0))*stretch+(d.wobble||0)};
}

// Central body section across travel, including the sprite's quantized waist.
// Projecting the whole elongated silhouette made bends clear an oversized ribbon.
export function dropTrailRadius(d,dx,dy,contour,opacity=1){
  const {angle,sx,sy,shape}=dropGeometry(d),length=Math.hypot(dx,dy),r=renderedDropRadius(d);
  const nx=length?-dy/length:1,ny=length?dx/length:0;
  const c=Math.cos(angle),s=Math.sin(angle);
  if(contour){
    if(!(r>0&&Number.isFinite(r)&&opacity>0&&Number.isFinite(opacity)))return 0;
    const x=(nx*c+ny*s)/sx,y=(-nx*s+ny*c)/sy,scale=Math.hypot(x,y);
    // Match the visible alpha cutoffs in water.frag and Heartfelt's Drops().
    // Use the tighter side of an asymmetric body, never its surrounding halo.
    const threshold=(d.heartfelt ? .3 : .5)/opacity;
    const radius=Math.min(contourRadius(contour,x,y,threshold),contourRadius(contour,-x,-y,threshold));
    return scale>0?r*radius/scale:0;
  }
  const waist=sx*(1-.12*Math.round(shape*6)/6);
  return r/Math.hypot((nx*c+ny*s)/waist,(-nx*s+ny*c)/sy);
}
