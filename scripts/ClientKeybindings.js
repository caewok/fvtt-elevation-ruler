/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { elevationAtWaypoint } from "./segments.js";

// Patches for the ClientKeybindings class
export const PATCHES = {};
PATCHES.TOKEN_RULER = {}; // Assume this patch is only present if the token ruler setting is enabled.

/**
 * Mixed wrap of ClientKeybindings._onMeasuredRulerMovement
 * Called when spacebar is pressed, for ruler.
 * If the Token Ruler is active, call that instead.
 * @param {KeyboardEventContext} context    The context data of the event
 */
async function _onMeasuredRulerMovement(wrapped, context) {
  console.log("_onMeasuredRulerMovement");
  // We only care about when tokens are being dragged
  const ruler = canvas.controls.ruler;
  if ( !ruler.active
    || !canvas.tokens.active
    || ui.controls.tool !== "select" ) return wrapped(context);

  // For each controlled token, end the drag.
  canvas.tokens.clearPreviewContainer();
  await ruler.moveToken();
  ruler._endMeasurement();
}

PATCHES.TOKEN_RULER.STATIC_WRAPS = { _onMeasuredRulerMovement }
