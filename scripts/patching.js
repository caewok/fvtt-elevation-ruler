import { MODULE_ID } from "./module.js";
import { elevationRulerConstructor } from "./ruler.js";


function RegisterRuler() {
  libWrapper.register(MODULE_ID, 'Ruler.prototype.constructor', elevationRulerConstructor, 'WRAPPER');
}
