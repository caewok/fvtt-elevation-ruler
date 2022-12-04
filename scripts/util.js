/* globals
canvas,
CONST,
game,
Ray
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

/**
 * Convert elevation grid coordinate to elevation units
 * @param {number} e    elevation coordinate
 * @returns {number}
 */
export function elevationCoordinateToUnit(e) {
  const { size, distance } = canvas.dimensions;
  const gridMultiplier = distance / size;
  return e * gridMultiplier;
}
