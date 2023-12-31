/* globals
game
*/
"use strict";

import { MODULE_ID } from "./const.js";

export function log(...args) {
  try {
    const isDebugging = game.modules.get("_dev-mode")?.api?.getPackageDebugValue(MODULE_ID);
    if (isDebugging) console.log(MODULE_ID, "|", ...args);

  } catch(e) {
    // Empty
  }
}
