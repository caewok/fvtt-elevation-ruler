/* globals
canvas,
CanvasAnimation,
game,
Ruler
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Settings } from "./settings.js";

// Patches for the Token class
export const PATCHES = {};
PATCHES.TOKEN_RULER = {}; // Assume this patch is only present if the token ruler setting is enabled.
PATCHES.MOVEMENT_TRACKING = {};
PATCHES.PATHFINDING = {};

/**
 * Wrap Token.prototype._onDragLeftStart
 * Start a ruler measurement.
 */
function _onDragLeftStart(wrapped, event) {
  wrapped(event);

  // If Token Ruler, start a ruler measurement.
  if ( !Settings.get(Settings.KEYS.TOKEN_RULER.ENABLED) ) return;
  canvas.controls.ruler._onDragStart(event);
}

/**
 * Wrap Token.prototype._onDragLeftMove
 * Continue the ruler measurement
 */
function _onDragLeftCancel(wrapped, event) {
  wrapped(event);

  // Cancel a Ruler measurement.
  // If moving, handled by the drag left drop.
  if ( !Settings.get(Settings.KEYS.TOKEN_RULER.ENABLED) ) return;
  const ruler = canvas.controls.ruler;
  if ( ruler._state !== Ruler.STATES.MOVING ) canvas.controls.ruler._onMouseUp(event);
}

/**
 * Wrap Token.prototype._onDragLeftCancel
 * Continue the ruler measurement
 */
function _onDragLeftMove(wrapped, event) {
  wrapped(event);

  // Continue a Ruler measurement.
  if ( !Settings.get(Settings.KEYS.TOKEN_RULER.ENABLED) ) return;
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
  if ( !ruler.active || !Settings.get(Settings.KEYS.TOKEN_RULER.ENABLED) ) return wrapped(event);
  const destination = event.interactionData.destination;

  // Ensure the cursor destination is within bounds
  if ( !canvas.dimensions.rect.contains(destination.x, destination.y) ) {
    ruler._onMouseUp(event);
    return false;
  }
  ruler._state = Ruler.STATES.MOVING; // Do this before the await.
  await ruler.moveToken();
  ruler._onMouseUp(event);
}

/**
 * Token.prototype.lastMoveDistance
 * Return the last move distance. If combat is active, return the last move since this token
 * started its turn.
 * @param {boolean} [sinceCombatTurn=true]     Should the combat turn zero out the movement distance.
 * @returns {number}
 */
function lastMoveDistance() {
  if ( game.combat?.active && this._lastCombatRoundMove < game.combat.round ) return 0;
  return this._lastMoveDistance ?? 0;
}

/**
 * Hook updateToken to track token movement.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateToken(document, changes, _options, _userId) {
  const token = document.object;
  if ( token.isPreview
    || !(Object.hasOwn(changes, "x")|| Object.hasOwn(changes, "y") || Object.hasOwn(changes, "elevation")) ) return;

  if ( game.combat?.active ) token._lastCombatRoundMove = game.combat.round;
  const ruler = canvas.controls.ruler;
  if ( ruler.active && ruler._getMovementToken() === token ) token._lastMoveDistance = ruler.totalMoveDistance;
  else token._lastMoveDistance = Ruler.measureMoveDistance(token.position, token.document, token).moveDistance;
}

/**
 * Wrap Token.prototype._onUpdate to remove easing for pathfinding segments.
 */
function _onUpdate(wrapped, data, options, userId) {
  if ( options?.rulerSegment && options?.animation?.easing ) {
    options.animation.easing = options.firstRulerSegment ? noEndEase(options.animation.easing)
      : options.lastRulerSegment ? noStartEase(options.animation.easing)
        : undefined;
  }
  return wrapped(data, options, userId);
}

function noStartEase(easing) {
  if ( typeof easing === "string" ) easing = CanvasAnimation[easing];
  return pt => (pt < 0.5) ? pt : easing(pt);
}

function noEndEase(easing) {
  if ( typeof easing === "string" ) easing = CanvasAnimation[easing];
  return pt => (pt > 0.5) ? pt : easing(pt);
}

PATCHES.TOKEN_RULER.WRAPS = {
  _onDragLeftStart,
  _onDragLeftMove,
  _onDragLeftCancel
};

PATCHES.PATHFINDING.WRAPS = { _onUpdate };

PATCHES.TOKEN_RULER.MIXES = { _onDragLeftDrop };

PATCHES.MOVEMENT_TRACKING.HOOKS = { updateToken };
PATCHES.MOVEMENT_TRACKING.GETTERS = { lastMoveDistance };

