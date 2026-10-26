// Small original café villagers. Rigid limb pivots keep the existing outlines
// attached to the walking body without a skeleton, textures or extra lights.
const clamp=value=>Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
export const NPC_HIP_HEIGHT=.44;
const palettes=[
  {skin:0xc99e7d,hair:0x433c32,shirt:0x7e8f70,trousers:0x444d42},
  {skin:0xd8b598,hair:0x655043,shirt:0xb17d65,trousers:0x505248},
  {skin:0xa8795c,hair:0x353a33,shirt:0x909d9b,trousers:0x484841},
  {skin:0xc99e7d,hair:0x655043,shirt:0xb19b70,trousers:0x525246},
  {skin:0xd8b598,hair:0x433c32,shirt:0x8d9382,trousers:0x494d47},
  {skin:0xa8795c,hair:0x353a33,shirt:0x9e8580,trousers:0x4b4b48},
];

export function createNpcCharacter(THREE,{index=0,barista=false,style}={}){
  const root=new THREE.Group(),body=new THREE.Group(),head=new THREE.Group();
  root.name=barista?'Café employee':`Café guest ${index+1}`;
  root.userData.npc=true;root.userData.npcRole=barista?'barista':'guest';
  body.name='NPC body';head.name='NPC head';
  root.add(body);body.add(head);head.position.y=1.005;
  const palette=palettes[((Math.floor(index)||0)%palettes.length+palettes.length)%palettes.length];
  const geometries=new Set(),baseMaterials=new Set(),fadeMaterials=new Map();
  const opacity={value:1};let disposed=false;
  const box=new THREE.BoxGeometry(1,1,1);geometries.add(box);
  function material(name,color){
    const value=new THREE.MeshStandardMaterial({color,roughness:.92,metalness:0});
    value.name=`NPC ${name}`;baseMaterials.add(value);return value;
  }
  const skin=material('skin',palette.skin),hair=material('hair',barista?0xefe5ce:palette.hair);
  const shirt=material('shirt',barista?0xe2d6bd:palette.shirt),pants=material('trousers',palette.trousers);
  const face=material('face',0x383c32),apron=barista?material('apron',0x71816b):null;
  function mesh(parent,name,geometry,surface,scale,position,{outline=true}={}){
    const object=new THREE.Mesh(geometry,surface);object.name=`NPC ${name}`;
    if(scale)object.scale.set(...scale);if(position)object.position.set(...position);
    object.castShadow=false;object.receiveShadow=true;
    if(!outline)object.userData.outline=false;
    parent.add(object);return object;
  }
  // Combine same-colored small details so a face or leg costs one draw.
  function boxes(parts){
    const positions=[],normals=[],indices=[];
    for(const {size,at} of parts){
      const offset=positions.length/3,p=box.attributes.position,n=box.attributes.normal;
      for(let i=0;i<p.count;i++){
        positions.push(p.getX(i)*size[0]+at[0],p.getY(i)*size[1]+at[1],p.getZ(i)*size[2]+at[2]);
        normals.push(n.getX(i),n.getY(i),n.getZ(i));
      }
      for(let i=0;i<box.index.count;i++)indices.push(offset+box.index.getX(i));
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    geometry.setIndex(indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();
    geometries.add(geometry);return geometry;
  }
  mesh(body,'coat',box,shirt,[.24,.39,.17],[0,.625,0]);
  mesh(head,'head and nose',boxes([
    {size:[.29,.29,.24],at:[0,0,0]},
    {size:[.057,.067,.046],at:[0,-.016,.139]},
    {size:[.085,.09,.09],at:[0,-.17,0]},
  ]),skin);
  mesh(head,barista?'linen cap':'hair',box,hair,[.30,.056,.25],[0,.147,0]);
  mesh(head,'eyes and brows',boxes([
    ...[-1,1].flatMap(side=>[
      {size:[.024,.029,.008],at:[side*.068,.022,.124]},
      {size:[.052,.013,.008],at:[side*.068,.059,.124]},
    ]),
    {size:[.033,.009,.008],at:[0,-.067,.124]},
  ]),face,null,null,{outline:false});
  const legs=[],knees=[],arms=[];
  const shinGeometry=boxes([
    {size:[.092,.14,.105],at:[0,-.075,0]},
    {size:[.10,.09,.145],at:[0,-.18,.016]},
  ]);
  for(const side of [-1,1]){
    const leg=new THREE.Group(),knee=new THREE.Group();
    leg.name=side<0?'NPC left hip':'NPC right hip';
    knee.name=side<0?'NPC left knee':'NPC right knee';
    leg.position.set(side*.061,NPC_HIP_HEIGHT,0);body.add(leg);legs.push(leg);
    mesh(leg,'thigh',box,pants,[.092,.205,.105],[0,-.1125,0]);
    knee.position.y=-.215;leg.add(knee);knees.push(knee);
    mesh(knee,'leg and shoe',shinGeometry,pants);
    const arm=new THREE.Group();arm.position.set(side*.13,.77,0);body.add(arm);arms.push(arm);
    // The total X envelope remains .32 even through the full walking cycle.
    mesh(arm,'arm',box,skin,[.06,.32,.085],[0,-.16,0]);
  }
  if(apron)mesh(body,'apron',box,apron,[.205,.285,.014],[0,.584,.093],{outline:false});

  // Styling happens while the authored surfaces are opaque and eligible.
  // Its shared outline uniforms must remain shared after per-character cloning.
  try{style?.(root);}catch(error){
    for(const geometry of geometries)geometry.dispose();
    for(const surface of baseMaterials)surface.dispose();
    root.clear();throw error;
  }
  root.traverse(object=>{
    if(!object.isMesh)return;
    const surfaces=Array.isArray(object.material)?object.material:[object.material];
    const replacements=surfaces.map(original=>{
      if(fadeMaterials.has(original))return fadeMaterials.get(original);
      const surface=original.clone();
      if(original.uniforms)surface.uniforms={...original.uniforms};
      const beforeCompile=original.onBeforeCompile,beforeRender=original.onBeforeRender;
      const previousCacheKey=original.customProgramCacheKey;
      surface.name=`${original.name} · NPC fade`;
      surface.transparent=true;surface.forceSinglePass=true;
      surface.userData.npcBaseDepthWrite=original.depthWrite;
      surface.onBeforeRender=beforeRender;
      surface.onBeforeCompile=function(shader,renderer){
        beforeCompile.call(this,shader,renderer);
        shader.uniforms.uNpcOpacity=opacity;
        shader.fragmentShader='uniform float uNpcOpacity;\n'+shader.fragmentShader
          .replace(/}\s*$/,'\n  gl_FragColor.a *= uNpcOpacity;\n}');
      };
      surface.customProgramCacheKey=function(){return `${previousCacheKey.call(original)}|npc-fade-v1`;};
      if(surface.uniforms)surface.uniforms.uNpcOpacity=opacity;
      fadeMaterials.set(original,surface);return surface;
    });
    object.material=Array.isArray(object.material)?replacements:replacements[0];
    object.castShadow=false;
  });
  const stats={bodyMeshes:0,outlineMeshes:0,materials:fadeMaterials.size,geometries:geometries.size,opacity:1,seated:0};
  root.traverse(object=>{if(object.isMesh)stats[object.userData.modelOutline?'outlineMeshes':'bodyMeshes']++;});

  function setOpacity(value){
    if(disposed)return;
    opacity.value=clamp(value);stats.opacity=opacity.value;
    root.visible=opacity.value>.001;root.userData.npcOpacity=opacity.value;
    for(const surface of fadeMaterials.values())surface.depthWrite=surface.userData.npcBaseDepthWrite&&opacity.value>=.999;
  }
  function setPose({walk=0,time=0,barista:working=barista,seated=0}={}){
    if(disposed)return;
    const sit=clamp(seated),motion=clamp(walk)*(1-sit),seconds=Number.isFinite(time)?time:0;
    const phase=seconds*6.2+(Number.isFinite(index)?index:0)*1.7,swing=Math.sin(phase)*motion;
    legs[0].rotation.x=swing*.48-sit*Math.PI/2;legs[1].rotation.x=-swing*.48-sit*Math.PI/2;
    for(const knee of knees)knee.rotation.x=sit*Math.PI/2;
    const leftArm=working?-.5+Math.sin(seconds*1.7)*.07:-swing*.43;
    const rightArm=working?-.64+Math.sin(seconds*1.7+.9)*.06:swing*.43;
    arms[0].rotation.x=leftArm*(1-sit)-.42*sit;
    arms[1].rotation.x=rightArm*(1-sit)-.46*sit;
    // Rotating a block shoe tips its toe below its old sole. Lift the body by
    // that exact corner excursion so both feet remain on or above the floor.
    const stride=Math.abs(swing*.48);
    const soleLift=Math.max(0,.44*Math.cos(stride)+.0885*Math.sin(stride)-.44);
    body.position.y=(soleLift+(1-Math.cos(phase*2))*.002*motion)*(1-sit);
    head.rotation.y=Math.sin(seconds*(working ? .55 : .31)+index)*.065;
    stats.seated=sit;root.userData.npcSeated=sit;
  }
  function dispose(){
    if(disposed)return;disposed=true;root.removeFromParent();root.clear();
    for(const surface of fadeMaterials.values())surface.dispose();fadeMaterials.clear();
    for(const surface of baseMaterials)surface.dispose();baseMaterials.clear();
    for(const geometry of geometries)geometry.dispose();geometries.clear();
    stats.opacity=0;root.visible=false;
  }
  setPose();setOpacity(1);
  return {root,setPose,setOpacity,dispose,stats,hipHeight:NPC_HIP_HEIGHT};
}
