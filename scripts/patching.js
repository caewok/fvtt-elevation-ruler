import { MODULE_ID, log } from "./module.js";
import { elevationRulerConstructor, 
         elevationRulerMeasure, 
         elevationRulerMoveToken,
         elevationRulerClear,
         elevationRulerUpdate,
         elevationRulerAddWaypoint } from "./ruler.js";

export function registerRuler() {

  libWrapper.register(MODULE_ID, 'Ruler.prototype.constructor', elevationRulerConstructor, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype.measure', elevationRulerMeasure, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype.moveToken', elevationRulerMeasure, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype.clear', elevationRulerClear, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype.update', elevationRulerUpdate, 'WRAPPER');
  libWrapper.register(MODULE_ID, 'Ruler.prototype._addWaypoint', elevationRulerAddWaypoint, 'WRAPPER');
  
  log("registerRuler finished!");
}
