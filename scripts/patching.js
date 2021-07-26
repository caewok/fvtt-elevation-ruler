import { MODULE_ID, log } from "./module.js";
import { elevationRulerClear,
         elevationRulerAddWaypoint,
         elevationRulerRemoveWaypoint,
         elevationRulerAnimateToken } from "./ruler.js";
         
import { elevationRulerAddProperties,
         elevationRulerConstructPhysicalPath,
         elevationRulerMeasurePhysicalPath,
         elevationRulerGetText } from "./segments.js";

import { calculate3dDistance,
         iterateGridUnder3dLine_wrapper,
         points3dAlmostEqual } from "./utility.js";

export function registerRuler() {

  // segment methods (for measuring)
  libWrapper.register(MODULE_ID, 'window.libRuler.RulerSegment.prototype.addProperties', elevationRulerAddProperties, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'window.libRuler.RulerSegment.prototype.constructPhysicalPath', elevationRulerConstructPhysicalPath, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'window.libRuler.RulerSegment.prototype.measurePhysicalPath', elevationRulerMeasurePhysicalPath, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'window.libRuler.RulerSegment.prototype.text', elevationRulerGetText, 'WRAPPER');

  // move token methods
  libWrapper.register(MODULE_ID, 'Ruler.prototype.animateToken', elevationRulerAnimateToken, 'WRAPPER');
  
  // other methods
  libWrapper.register(MODULE_ID, 'Ruler.prototype.clear', elevationRulerClear, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype._addWaypoint', elevationRulerAddWaypoint, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype._removeWaypoint', elevationRulerRemoveWaypoint, 'WRAPPER');
  
  // utilities
  libWrapper.register(MODULE_ID, 'window.libRuler.RulerUtilities.calculateDistance', calculate3dDistance, 'MIXED');
  libWrapper.register(MODULE_ID, 'window.libRuler.RulerUtilities.pointsAlmostEqual', points3dAlmostEqual, 'WRAPPER');  
  libWrapper.register(MODULE_ID, 'window.libRuler.RulerUtilities.iterateGridUnderLine', iterateGridUnder3dLine_wrapper, 'WRAPPER');

  
  log("registerRuler finished!");
}


