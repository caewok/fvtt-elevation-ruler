/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { elevationAtWaypoint } from "./segments.js";

// Patches for the Token class
export const PATCHES = {};
PATCHES.TOKEN_RULER = {}; // Assume this patch is only present if the token ruler setting is enabled.

/**
 * Wrap Token.prototype._onDragLeftStart
 * Start a ruler measurement.
 */
function _onDragLeftStart(wrapped, event) {
  wrapped(event);

  // Start a Ruler measurement.
  canvas.controls.ruler._onDragStart(event);
}

/**
 * Wrap Token.prototype._onDragLeftMove
 * Continue the ruler measurement
 */
function _onDragLeftMove(wrapped, event) {
  wrapped(event);

  // Continue a Ruler measurement.
  const ruler = canvas.controls.ruler;
  if ( ruler._state > 0 ) ruler._onMouseMove(event);
}

/**
 * Mix Token.prototype._onDragLeftDrop
 * End the ruler measurement.
 */
async function _onDragLeftDrop(wrapped, event) {
  // End the ruler measurement
  const ruler = canvas.controls.ruler;
  if ( !ruler.active ) return wrapped(event);
  const destination = event.interactionData.destination;

  // Ensure the cursor destination is within bounds
  if ( !canvas.dimensions.rect.contains(destination.x, destination.y) ) {
    ruler._onMouseUp(event);
    return false;
  }
  await ruler.moveToken();
  ruler._onMouseUp(event);
}


PATCHES.TOKEN_RULER.WRAPS = {
  _onDragLeftStart,
  _onDragLeftMove
};

PATCHES.TOKEN_RULER.MIXES = { _onDragLeftDrop };
