const ANGLE_COUNT=64,LEVEL_COUNT=17,TAU=Math.PI*2;

// Sample visible alpha contours once at startup, not along every moving trail.
export function createDropContour(pixels,width=64){
  if(!(pixels instanceof Uint8ClampedArray)||!Number.isInteger(width)||width<1||pixels.length<width*width*4)return null;
  const center=(width-1)/2,pixelRadius=width/2;
  const sample=(x,y)=>{
    x=Math.max(0,Math.min(width-1,x));y=Math.max(0,Math.min(width-1,y));
    const left=Math.floor(x),top=Math.floor(y),right=Math.min(width-1,left+1),bottom=Math.min(width-1,top+1);
    const fx=x-left,fy=y-top;
    const a=pixels[(top*width+left)*4+3]*(1-fx)+pixels[(top*width+right)*4+3]*fx;
    const b=pixels[(bottom*width+left)*4+3]*(1-fx)+pixels[(bottom*width+right)*4+3]*fx;
    return (a*(1-fy)+b*fy)/255;
  };
  const centerAlpha=sample(center,center),radii=new Float32Array(ANGLE_COUNT*LEVEL_COUNT);
  if(centerAlpha>0)for(let angle=0;angle<ANGLE_COUNT;angle++){
    const theta=angle*TAU/ANGLE_COUNT,dx=Math.cos(theta),dy=Math.sin(theta);
    const limit=1/Math.max(Math.abs(dx),Math.abs(dy));
    const alpha=radius=>sample(center+dx*radius*pixelRadius,center+dy*radius*pixelRadius);
    const edgeAlpha=alpha(limit);
    for(let level=0;level<LEVEL_COUNT;level++){
      const threshold=level/(LEVEL_COUNT-1);
      if(threshold>=centerAlpha)continue;
      let low=0,high=limit;
      if(edgeAlpha>threshold)low=limit;
      else for(let step=0;step<12;step++){
        const middle=(low+high)/2;
        if(alpha(middle)>threshold)low=middle;else high=middle;
      }
      radii[angle*LEVEL_COUNT+level]=low;
    }
  }
  return {radii,angleCount:ANGLE_COUNT,levelCount:LEVEL_COUNT,centerAlpha};
}

export function contourRadius(contour,x,y,threshold=.5){
  if(!contour||contour.angleCount!==ANGLE_COUNT||contour.levelCount!==LEVEL_COUNT||contour.radii?.length!==ANGLE_COUNT*LEVEL_COUNT||!Number.isFinite(contour.centerAlpha))return 0;
  if(!Number.isFinite(x)||!Number.isFinite(y)||(x===0&&y===0)||!Number.isFinite(threshold))return 0;
  threshold=Math.max(0,Math.min(1,threshold));
  if(threshold>=contour.centerAlpha)return 0;
  const theta=(Math.atan2(y,x)+TAU)%TAU,position=theta*ANGLE_COUNT/TAU;
  const first=Math.floor(position)%ANGLE_COUNT,second=(first+1)%ANGLE_COUNT,angleMix=position-Math.floor(position);
  const level=Math.min(LEVEL_COUNT-2,Math.floor(threshold*(LEVEL_COUNT-1)));
  const lower=level/(LEVEL_COUNT-1),upper=Math.min((level+1)/(LEVEL_COUNT-1),contour.centerAlpha);
  const levelMix=(threshold-lower)/(upper-lower),radii=contour.radii;
  const indexA=first*LEVEL_COUNT+level,indexB=second*LEVEL_COUNT+level;
  const startA=radii[indexA],startB=radii[indexB];
  const endA=upper===contour.centerAlpha?0:radii[indexA+1],endB=upper===contour.centerAlpha?0:radii[indexB+1];
  const a=startA+(endA-startA)*levelMix,b=startB+(endB-startB)*levelMix,radius=a+(b-a)*angleMix;
  const limit=1/Math.max(Math.abs(Math.cos(theta)),Math.abs(Math.sin(theta)));
  return Number.isFinite(radius)?Math.max(0,Math.min(limit,radius)):0;
}
