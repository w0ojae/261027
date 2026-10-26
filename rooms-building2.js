import { modelToWorld, modelScale, modelPosition } from './building-placement.js?v=16';
// Indoor coordinates use the exact same placement as the building parent.
const worldPoint=modelToWorld;
const worldRect=({minX,maxX,minZ,maxZ})=>({minX:minX*modelScale+modelPosition.x,maxX:maxX*modelScale+modelPosition.x,minZ:minZ*modelScale+modelPosition.z,maxZ:maxZ*modelScale+modelPosition.z});
const roomZone=(spawn,bounds,obstacles=[],yaw=-Math.PI*.72)=>({spawn:worldPoint(...spawn),yaw,pitch:-.025,bounds:worldRect(bounds),obstacles:obstacles.map(worldRect)});
// Bounds describe usable floor edges. The controller adds the player's body radius.
// Stools on 1F are blocked; 2F uses the open aisle behind the window counter.
export const rooms={
  1:roomZone([1.65,2.79,-2.8],{minX:.82,maxX:2.21,minZ:-5.53,maxZ:-.92},[
    {minX:.81,maxX:1.21,minZ:-2.20,maxZ:-1.78},
    {minX:.66,maxX:1.06,minZ:-3.82,maxZ:-3.39},
    {minX:.66,maxX:1.06,minZ:-3.01,maxZ:-2.59}
  ],-2.02),
  2:roomZone([.9,5.17,-2.6],{minX:-1.68,maxX:1.48,minZ:-3.68,maxZ:-1.92})
};
