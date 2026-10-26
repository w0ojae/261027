// One small, cached walking graph. No GLB traversal or ray casting per frame.
export const NPC_RADIUS=.17;
const distance2=(a,b)=>(a.x-b.x)**2+(a.z-b.z)**2;
const rectDistance2=(p,b)=>Math.max(b.minX-p.x,0,p.x-b.maxX)**2+Math.max(b.minZ-p.z,0,p.z-b.maxZ)**2;
export function pointSegmentDistance2(p,a,b){
  const dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/length)):0;
  return (p.x-a.x-dx*t)**2+(p.z-a.z-dz*t)**2;
}
function intersectsRect(a,b,box){
  let low=0,high=1;
  for(const [start,delta,min,max] of [[a.x,b.x-a.x,box.minX,box.maxX],[a.z,b.z-a.z,box.minZ,box.maxZ]]){
    if(Math.abs(delta)<1e-12){if(start<min||start>max)return false;continue;}
    let first=(min-start)/delta,last=(max-start)/delta;if(first>last)[first,last]=[last,first];
    low=Math.max(low,first);high=Math.min(high,last);if(low>high)return false;
  }
  return true;
}
export function safeNpcPoint(point,zone,radius=NPC_RADIUS){
  if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.z))return false;
  const b=zone.bounds;
  if(!b||point.x<b.minX+radius-1e-8||point.x>b.maxX-radius+1e-8||point.z<b.minZ+radius-1e-8||point.z>b.maxZ-radius+1e-8)return false;
  return !(zone.obstacles||[]).some(box=>rectDistance2(point,box)<radius*radius-1e-9);
}
export function safeNpcSegment(a,b,zone,radius=NPC_RADIUS){
  if(!safeNpcPoint(a,zone,radius)||!safeNpcPoint(b,zone,radius))return false;
  for(const box of zone.obstacles||[]){
    if(Math.max(a.x,b.x)+radius<box.minX||Math.min(a.x,b.x)-radius>box.maxX||Math.max(a.z,b.z)+radius<box.minZ||Math.min(a.z,b.z)-radius>box.maxZ)continue;
    if(intersectsRect(a,b,box))return false;
    let closest=Math.min(rectDistance2(a,box),rectDistance2(b,box));
    for(const x of [box.minX,box.maxX])for(const z of [box.minZ,box.maxZ])closest=Math.min(closest,pointSegmentDistance2({x,z},a,b));
    if(closest<radius*radius-1e-9)return false;
  }
  return true;
}
export function createNpcNavigation(zone,{radius=NPC_RADIUS,spacing=.18,anchors=[]}={}){
  const nodes=[],grid=new Map(),bounds=zone.bounds;
  const nx=Math.max(1,Math.ceil((bounds.maxX-bounds.minX-radius*2)/spacing));
  const nz=Math.max(1,Math.ceil((bounds.maxZ-bounds.minZ-radius*2)/spacing));
  const sx=(bounds.maxX-bounds.minX-radius*2)/nx,sz=(bounds.maxZ-bounds.minZ-radius*2)/nz;
  for(let iz=0;iz<=nz;iz++)for(let ix=0;ix<=nx;ix++){
    const point={x:bounds.minX+radius+ix*sx,z:bounds.minZ+radius+iz*sz};
    if(!safeNpcPoint(point,zone,radius))continue;
    const id=nodes.length;nodes.push({...point,id,edges:[],component:-1});grid.set(`${ix}:${iz}`,id);
  }
  const connect=(a,b)=>{if(a===undefined||b===undefined||a===b||!safeNpcSegment(nodes[a],nodes[b],zone,radius))return;nodes[a].edges.push(b);nodes[b].edges.push(a);};
  for(const [key,id] of grid){const [x,z]=key.split(':').map(Number);for(const [dx,dz] of [[1,0],[0,1],[1,1],[-1,1]])connect(id,grid.get(`${x+dx}:${z+dz}`));}
  const anchorNodes=anchors.map(point=>{
    if(!safeNpcPoint(point,zone,radius))return null;
    const node={x:point.x,z:point.z,id:nodes.length,edges:[],component:-1};nodes.push(node);
    for(let i=0;i<node.id;i++)if(distance2(nodes[i],node)<spacing*spacing*12)connect(node.id,i);
    return node;
  });
  let components=0;
  for(const node of nodes)if(node.component<0){
    const queue=[node.id];node.component=components;
    for(let i=0;i<queue.length;i++)for(const id of nodes[queue[i]].edges)if(nodes[id].component<0){nodes[id].component=components;queue.push(id);}
    components++;
  }
  function nearest(point,component,accept=()=>true){
    let result=null,best=Infinity;
    for(const node of nodes){if(component!==undefined&&node.component!==component)continue;const d=distance2(point,node);if(d<best&&accept(node)&&safeNpcSegment(point,node,zone,radius)){result=node;best=d;}}
    return result;
  }
  function findPath(from,to,avoid=[]){
    if(!safeNpcPoint(from,zone,radius)||!safeNpcPoint(to,zone,radius))return [];
    // Match the controller's standing/moving clearance. A larger graph-only
    // gap can imprison two valid neighbours before either can take a step.
    const avoidRadius=point=>(radius+(point.radius??radius)+.025)**2;
    const avoids=(a,b)=>avoid.every(point=>pointSegmentDistance2(point,a,b)>=avoidRadius(point)-1e-10);
    // The closest static vertex may be inside a newly stopped neighbour.
    // Connect each endpoint through a dynamically clear link instead.
    const start=nearest(from,undefined,node=>avoids(from,node));
    const end=nearest(to,start?.component,node=>avoids(node,to));if(!start||!end)return [];
    const blocked=node=>avoid.some(point=>pointSegmentDistance2(point,node,node)<avoidRadius(point));
    const came=new Int32Array(nodes.length).fill(-1),queue=[start.id];came[start.id]=start.id;
    for(let i=0;i<queue.length&&came[end.id]<0;i++)for(const id of nodes[queue[i]].edges){
      if(came[id]>=0||blocked(nodes[id])||avoid.some(point=>pointSegmentDistance2(point,nodes[queue[i]],nodes[id])<avoidRadius(point)))continue;
      came[id]=queue[i];queue.push(id);
    }
    if(came[end.id]<0)return [];
    const path=[{x:to.x,z:to.z}];let id=end.id;
    while(id!==start.id){path.push({x:nodes[id].x,z:nodes[id].z});id=came[id];}
    path.push({x:start.x,z:start.z});path.reverse();
    // Straight segments are shortened only after checking their full capsule.
    const result=[];let origin=from,index=0;
    while(index<path.length){let last=index;for(let next=index+1;next<path.length;next++){
      if(!safeNpcSegment(origin,path[next],zone,radius)||avoid.some(point=>pointSegmentDistance2(point,origin,path[next])<avoidRadius(point)))break;last=next;
    }result.push(path[last]);origin=path[last];index=last+1;}
    return result;
  }
  return {nodes,anchors:anchorNodes,zone,radius,components,nearest,findPath,safe:point=>safeNpcPoint(point,zone,radius),clear:(a,b)=>safeNpcSegment(a,b,zone,radius)};
}
