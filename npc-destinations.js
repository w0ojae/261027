import {modelToWorld,modelScale} from './building-placement.js?v=16';
import {rooms} from './rooms-building2.js?v=16';
import {seats} from './seats-building2.js?v=21';
import {NPC_FLOOR_MODEL_Y,NPC_INDOOR_FLOOR_Y} from './npc-placement.js';

// Measured Plane.061 upper floor and Cube.114 interior stair treads.
const upperFloorModelY=3.5930128111;
const upperFloorY=modelToWorld(0,upperFloorModelY,0).y;
const rect=(minX,maxX,minZ,maxZ)=>{
  const a=modelToWorld(minX,0,minZ),b=modelToWorld(maxX,0,maxZ);
  return {minX:a.x,maxX:b.x,minZ:a.z,maxZ:b.z};
};
// NPCs reach the bottom stair through the empty aisle behind the coffee counter.
// The player zones remain unchanged; the L-shaped counter is conservatively solid.
const groundZone={
  ...rooms[1],bounds:rect(-1.10,2.21,-5.53,-.92),
  obstacles:[...rooms[1].obstacles,rect(-2.70,.805,-4.32,-.70)],
};
const upperZone={
  ...rooms[2],bounds:rect(-1.68,1.52,-3.68,-1.88),
  obstacles:[...(rooms[2].obstacles??[])],
};

// Rise just before each real riser, then cross its tread. This keeps descending
// and ascending feet above the solid stair instead of interpolating through it.
const stairModel=[[-.78,NPC_FLOOR_MODEL_Y,-5.25]];
let height=NPC_FLOOR_MODEL_Y;
for(const [edge,next] of [
  [-1.0204,1.371788609],[-1.1618,1.513146122],[-1.3031,1.654503642],
  [-1.4445,1.795861138],[-1.5858,1.926647860],[-1.8061,1.9420],
]){
  stairModel.push([edge+.012,height,-5.25],[edge+.004,next,-5.25]);height=next;
}
stairModel.push([-2.135,height,-5.25]);
const rearFlight=[
  [-4.7943,2.085321112],[-4.6474,2.228500775],[-4.5004,2.371680492],
  [-4.3534,2.514860154],[-4.2065,2.658039926],[-4.0595,2.801219589],
  [-3.9125,2.944399251],[-3.7656,3.087578860],[-3.6186,3.230758523],
  [-3.4716,3.373938185],[-3.3247,3.517117957],[-3.1777,3.593405010],
];
for(const [edge,next] of rearFlight){
  stairModel.push([-2.135,height,edge-.012],[-2.135,next,edge-.004]);height=next;
}
// Leave the flight through its open forward end before turning right. Crossing
// directly sideways at z=-2.95 would pass through the Plane.075 stair guardrail.
stairModel.push([-2.135,height,-2.95],[-2.135,upperFloorModelY,-2.35],[-1.4,upperFloorModelY,-2.35]);
const path=stairModel.map(point=>Object.freeze(modelToWorld(...point)));

export const NPC_DESTINATIONS=Object.freeze({
  groundZone,upperZone,groundFloorY:NPC_INDOOR_FLOOR_Y,upperFloorY,
  seats:Object.freeze(seats.map(seat=>Object.freeze({
    id:seat.id,floor:seat.floor,
    // Existing player seats store eyes .75 model units above the cushion.
    position:Object.freeze({...seat.position,y:seat.position.y-.75*modelScale}),
    yaw:Math.atan2(Math.sin(seat.yaw+Math.PI),Math.cos(seat.yaw+Math.PI)),
    approach:Object.freeze({...seat.approach,y:seat.floor===1?NPC_INDOOR_FLOOR_Y:upperFloorY}),
  }))),
  stairs:Object.freeze({path:Object.freeze(path),lower:path[0],upper:path.at(-1)}),
});
