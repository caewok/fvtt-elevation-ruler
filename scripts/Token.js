/* globals
canvas,
Ruler
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { elevationAtWaypoint } from "./segments.js";

// Patches for the Token class
export const PATCHES = {};
PATCHES.DRAG_RULER = {};
PATCHES.TOKEN_RULER = {}; // Assume this patch is only present if the token ruler setting is enabled.


/**
 * Hook preUpdateToken
 * If moving using Token Ruler, don't animate the token move here.
 */
function preUpdateToken(document, changes, options, _userId) {
  console.debug("preUpdateToken");
  if ( options.ruler || canvas.controls.ruler._state !== Ruler.STATES.MOVING ) return true;

  const changeSet = new Set(Object.getOwnPropertyNames(changes));
  if ( !(changeSet.has("x")
      || changeSet.has("y")
      || changeSet.has("elevation")) ) return true;


  //options.animate = false;
  return true;
}
//PATCHES.TOKEN_RULER.HOOKS = { preUpdateToken };


/**
 * Wrap Token.prototype._onDragLeftStart
 * Start a ruler measurement.
 */
function _onDragLeftStart(wrapped, event) {
  console.debug("Token.prototype._onDragLeftStart");
  wrapped(event);

  // TODO: Do we need to have a modified CONFIG.Canvas.rulerClass.canMeasure here?
  //       Do we need to check if this.activeLayer instanceof TokenLayer?

  // Start a Ruler measurement.
  canvas.controls.ruler._onDragStart(event);
}

/**
 * Wrap Token.prototype._onDragStart
 * Start a ruler measurement
 */
function _onDragStart(wrapped, event) {
  console.debug("Token.prototype._onDragStart");
  wrapped(event);

  // Start a Ruler measurement.
  // canvas.controls.ruler._onDragStart(event);
}

/**
 * Wrap Token.prototype._onDragLeftMove
 * Continue the ruler measurement
 */
function _onDragLeftMove(wrapped, event) {
  console.debug("Token.prototype._onDragLeftMove");
  wrapped(event);

  // Continue a Ruler measurement.
  const ruler = canvas.controls.ruler;
  if ( ruler._state > 0 ) ruler._onMouseMove(event);
}

/**
 * Wrap Token.prototype._onDragLeftDrop
 * End the ruler measurement.
 */
async function _onDragLeftDrop(wrapped, event) {
  console.debug("Token.prototype._onDragLeftDrop");
  wrapped(event);

  // End the ruler measurement
  const ruler = canvas.controls.ruler;
  if ( !ruler.active ) return;
  await ruler.moveToken();
  ruler._onMouseUp(event);

  // document.removeEventListener("keydown", onKeyDown);
}

/**
 * Wrap Token.prototype._onDragLeftCancel
 * Cancel the ruler measurement.
 */
function _onDragLeftCancel(wrapped, event) {
  console.debug("Token.prototype._onDragLeftCancel");
  wrapped(event);

  // Cancel the ruler measurement.
  // const ruler = canvas.controls.ruler;
  // if ( ruler.active && ruler._state !== Ruler.STATES.MOVING ) ruler._endMeasurement();
}

/**
 * Wrap Token.prototype._onClickRight
 * Add a ruler waypoint.
 */
function _onClickRight(wrapped, event) {
  console.debug("Token.prototype._onClickRight");
  wrapped(event);

  // Add waypoint.
  const ruler = canvas.controls.ruler;
  if ( ruler.active ) ruler._onClickRight(event);
}

/**
 * Wrap Token.prototype._onClickRight2
 */
function _onClickRight2(wrapped, event) {
  console.debug("Token.prototype._onClickRight2");
  wrapped(event);
}

/**
 * Wrap Token.prototype._onClickLeft
 */
function _onClickLeft(wrapped, event) {
  console.debug("Token.prototype._onClickLeft");
  wrapped(event);
}

/**
 * Wrap Token.prototype._onClickLeft2
 */
function _onClickLeft2(wrapped, event) {
  console.debug("Token.prototype._onClickLeft2");
  wrapped(event);
}

PATCHES.TOKEN_RULER.WRAPS = {
  _onDragStart,
  _onDragLeftStart,
  _onDragLeftMove,
  _onDragLeftDrop,
  _onDragLeftCancel,
  _onClickRight,
  _onClickLeft,
  _onClickLeft2,
  _onClickRight2
};

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
