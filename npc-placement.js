import {modelToWorld} from './building-placement.js?v=16';

// Cube.107's actual upper 1F support surface, after GLB origin normalization.
export const NPC_FLOOR_MODEL_Y=1.2148041087;
export const NPC_INDOOR_FLOOR_Y=modelToWorld(0,NPC_FLOOR_MODEL_Y,0).y;
// Provisional barista position behind the L-shaped coffee counter.
// Keep this separate so the owner can adjust the staff position independently.
export const NPC_BARISTA=Object.freeze({
  position:Object.freeze(modelToWorld(-1.5,NPC_FLOOR_MODEL_Y,-2.9)),
  yaw:Math.PI/2,
});
export const NPC_INDOOR_DOOR=Object.freeze(modelToWorld(1.85,NPC_FLOOR_MODEL_Y,-1.65));
export const NPC_OUTDOOR_DOOR=Object.freeze(modelToWorld(2.7,NPC_FLOOR_MODEL_Y,-1.68));
