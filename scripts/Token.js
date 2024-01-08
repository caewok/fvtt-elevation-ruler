/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { elevationAtWaypoint } from "./segments.js";

// Patches for the Token class
export const PATCHES = {};
PATCHES.DRAG_RULER = {};
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

/**
 * Wrap Token.prototype._onDragLeftDrop
 * If Drag Ruler is active, use this to update token(s) after movement has completed.
 * Callback actions which occur on a mouse-move operation.
 * @see MouseInteractionManager#_handleDragDrop
 * @param {PIXI.InteractionEvent} event  The triggering canvas interaction event
 * @returns {Promise<*>}
 */
async function _onDragLeftDropDragRuler(wrapped, event) {
  // Assume the destination elevation is the desired elevation if dragging multiple tokens.
  // (Likely more useful than having a bunch of tokens move down 10'?)
  const ruler = canvas.controls.ruler;
  if ( !ruler.isDragRuler ) return wrapped(event);

  // Do before calling wrapper b/c ruler may get cleared.
  const elevation = elevationAtWaypoint(ruler.destination);
  const selectedTokens = [...canvas.tokens.controlled];
  if ( !selectedTokens.length ) selectedTokens.push(ruler.draggedEntity);

  const result = wrapped(event);
  if ( result === false ) return false; // Drag did not happen

  const updates = selectedTokens.map(t => {
    return { _id: t.id, elevation };
  });

  const t0 = selectedTokens[0];
  await t0.scene.updateEmbeddedDocuments(t0.constructor.embeddedName, updates);
  return true;
}

PATCHES.DRAG_RULER.WRAPS = { _onDragLeftDrop: _onDragLeftDropDragRuler };
