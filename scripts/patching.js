import { MODULE_ID, log } from "./module.js";
import { elevationRulerConstructor } from "./ruler.js";

export function registerRuler() {
  libWrapper.register(MODULE_ID, 'Ruler.prototype.constructor', elevationRulerConstructor, 'WRAPPER');
  
  libWrapper.register(MODULE_ID, 'Ruler.prototype.measure', elevationRulerMeasure, 'WRAPPER');
  
  log("registerRuler finished!");
}
