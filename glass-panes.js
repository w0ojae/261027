// Measured against the authored GLB window openings, after origin normalization.
// +Z of every pane points outside. The wet surface sits just behind the outer
// wooden mullions, so both sides share one water map and the frames stay dry.
export const glassPanes = Object.freeze([
  {name:'2F right',position:[3.174,5.14,-2.287],size:[3.27,1.33],rotationY:Math.PI/2},
  {name:'2F front',position:[1.79,5.15,-.580],size:[2.60,1.33],rotationY:0},
  {name:'2F rear large',position:[-.99,5.295,-5.700],size:[2.75,.99],rotationY:Math.PI},
  {name:'2F rear small',position:[1.45,5.295,-5.700],size:[.65,.99],rotationY:Math.PI},
  {name:'1F right',position:[2.283,2.28,-3.717],size:[2.88,2],rotationY:Math.PI/2},
].map(pane=>Object.freeze({...pane,position:Object.freeze(pane.position),size:Object.freeze(pane.size)})));

export function createGlassPanes(THREE,model,material){
  return glassPanes.map(({name,position,size,rotationY})=>{
    const pane=new THREE.Mesh(new THREE.PlaneGeometry(...size),material);
    pane.name=`Outer glass — ${name}`;
    pane.position.fromArray(position);pane.rotation.y=rotationY;
    pane.renderOrder=4;pane.userData.rainSurface='exterior';
    model.add(pane);return pane;
  });
}
