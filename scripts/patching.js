import { MODULE_ID, log } from "./module.js";
import { elevationRulerGetSegmentLabel,
         
         elevationRulerClear,
         elevationRulerAddWaypoint,
         elevationRulerRemoveWaypoint,
         
         elevationRulerAnimateToken } from "./ruler.js";
         
import { elevationRulerAddProperties,
         elevationRulerConstructPhysicalPath,
         elevationRulerDistanceFunction } from "./segments.js";

export function registerRuler() {

  // segment methods (for measuring)
  libWrapper.register(MODULE_ID, 'window.libRuler.Segment.prototype.addProperties', elevationRulerAddProperties, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'window.libRuler.Segment.prototype.constructPhysicalPath', elevationRulerConstructPhysicalPath, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'window.libRuler.Segment.prototype.distanceFunction', elevationRulerDistanceFunction, 'WRAPPER');

  // measuring methods
  libWrapper.register(MODULE_ID, 'Ruler.prototype._getSegmentLabel', elevationRulerGetSegmentLabel, 'WRAPPER');

  // move token methods
  libWrapper.register(MODULE_ID, 'Ruler.prototype.animateToken', elevationRulerAnimateToken, 'WRAPPER');
  
  // other methods
  libWrapper.register(MODULE_ID, 'Ruler.prototype.clear', elevationRulerClear, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype._addWaypoint', elevationRulerAddWaypoint, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype._removeWaypoint', elevationRulerRemoveWaypoint, 'WRAPPER');
  
  log("registerRuler finished!");
}
