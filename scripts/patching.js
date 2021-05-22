import { MODULE_ID, log } from "./module.js";
import { elevationRulerConstructSegmentDistanceRay, 
         elevationRulerGetSegmentLabel,
         
         elevationRulerMoveToken,
         elevationRulerClear,
         elevationRulerAddWaypoint,
         elevationRulerRemoveWaypoint } from "./ruler.js";

export function registerRuler() {

  // measuring functions
  libWrapper.register(MODULE_ID, 'Ruler.prototype.constructSegmentDistanceRay', elevationRulerConstructSegmentDistanceRay, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype.getSegmentLabel', elevationRulerGetSegmentLabel, 'WRAPPER');

  // other functions
  libWrapper.register(MODULE_ID, 'Ruler.prototype.moveToken', elevationRulerMoveToken, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype.clear', elevationRulerClear, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype._addWaypoint', elevationRulerAddWaypoint, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype._removeWaypoint', elevationRulerRemoveWaypoint, 'WRAPPER');
  
  log("registerRuler finished!");
}
