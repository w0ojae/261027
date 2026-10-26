// Bound pixel work on large/retina screens; CSS coordinates remain unchanged.
export function renderSize(width,height,dpr=1,maxPixels=2500000){
  const w=Math.max(1,Number.isFinite(width)?width:1),h=Math.max(1,Number.isFinite(height)?height:1);
  const scale=Math.min(Math.max(1,Math.min(1.5,Number.isFinite(dpr)?dpr:1)),Math.sqrt(maxPixels/(w*h)));
  return {width:Math.max(1,Math.floor(w*scale)),height:Math.max(1,Math.floor(h*scale))};
}
