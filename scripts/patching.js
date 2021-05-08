import { MODULE_ID } from "./module.js";
import { elevationRulerConstructor } from "./ruler.js";

export function registerRuler() {
  libWrapper.register(MODULE_ID, 'Ruler.prototype.constructor', elevationRulerConstructor, 'WRAPPER');
}
