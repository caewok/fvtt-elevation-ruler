import { MODULE_ID, log } from "./module.js";
import { elevationRulerConstructSegmentDistanceRay, 
         elevationRulerGetSegmentLabel,
         
         elevationRulerClear,
         elevationRulerAddWaypoint,
         elevationRulerRemoveWaypoint,
         
         elevationRulerAnimateToken } from "./ruler.js";

export function registerRuler() {

  // measuring methods
  libWrapper.register(MODULE_ID, 'Ruler.prototype.constructSegmentDistanceRay', elevationRulerConstructSegmentDistanceRay, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype.getSegmentLabel', elevationRulerGetSegmentLabel, 'WRAPPER');

  // move token methods
  libWrapper.register(MODULE_ID, 'Ruler.prototype.animateToken', elevationRulerAnimateToken, 'WRAPPER');
  
  // other methods
  libWrapper.register(MODULE_ID, 'Ruler.prototype.clear', elevationRulerClear, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype._addWaypoint', elevationRulerAddWaypoint, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype._removeWaypoint', elevationRulerRemoveWaypoint, 'WRAPPER');
  
  log("registerRuler finished!");
}
