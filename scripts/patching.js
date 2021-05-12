import { MODULE_ID, log } from "./module.js";
import { elevationRulerMeasure, 
         elevationRulerMoveToken,
         elevationRulerClear,
         elevationRulerToJSON,
         elevationRulerUpdate,
         elevationRulerAddWaypoint,
         elevationRulerRemoveWaypoint } from "./ruler.js";

export function registerRuler() {

  libWrapper.register(MODULE_ID, 'Ruler.prototype.measure', elevationRulerMeasure, 'MIXED');
  libWrapper.register(MODULE_ID, 'Ruler.prototype.moveToken', elevationRulerMoveToken, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype.clear', elevationRulerClear, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype.toJSON', elevationRulerToJSON, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype.update', elevationRulerUpdate, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype._addWaypoint', elevationRulerAddWaypoint, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype._removeWaypoint', elevationRulerRemoveWaypoint, 'WRAPPER');
  
  log("registerRuler finished!");
}
