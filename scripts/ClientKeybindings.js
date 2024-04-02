/* globals
canvas,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the ClientKeybindings class
export const PATCHES = {};
PATCHES.TOKEN_RULER = {}; // Assume this patch is only present if the token ruler setting is enabled.

/**
 * Mixed wrap of ClientKeybindings._onMeasuredRulerMovement
 * Called when spacebar is pressed, for ruler.
 * If the Token Ruler is active, call that instead.
 * @param {KeyboardEventContext} context    The context data of the event
 */
function _onMeasuredRulerMovement(wrapped, context) {
  // We only care about when tokens are being dragged
  const ruler = canvas.controls.ruler;
  if ( ui.controls.tool !== "select" ) return wrapped(context);

  // If in token selection, don't use the ruler unless we are already starting a measurement.
  if ( !ruler.active
    || !canvas.controls.ruler._state
    || !canvas.tokens.active ) return false;

  // For each controlled token, end the drag.
  canvas.tokens.clearPreviewContainer();
  ruler.moveToken().then(_response => ruler._endMeasurement());
  return true;
}

PATCHES.TOKEN_RULER.STATIC_MIXES = { _onMeasuredRulerMovement };
