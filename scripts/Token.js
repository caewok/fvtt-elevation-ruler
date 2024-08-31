/* globals
canvas,
CanvasAnimation,
CONFIG,
foundry,
game,
Ruler
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID, FLAGS } from "./const.js";
import { Settings } from "./settings.js";
import { log } from "./util.js";
import { GridCoordinates3d } from "./geometry/3d/GridCoordinates3d.js";

// Patches for the Token class
export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.TOKEN_RULER = {}; // Assume this patch is only present if the token ruler setting is enabled.
PATCHES.MOVEMENT_TRACKING = {};
PATCHES.PATHFINDING = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook preUpdateToken to track token movement
 * @param {Document} document                       The Document instance being updated
 * @param {object} changed                          Differential data that will be used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modify the update request
 * @param {string} userId                           The ID of the requesting user, always game.user.id
 * @returns {boolean|void}                          Explicitly return false to prevent update of this Document
 */
function preUpdateToken(document, changes, _options, _userId) {
  const token = document.object;
  if ( token.isPreview
    || !(Object.hasOwn(changes, "x") || Object.hasOwn(changes, "y") || Object.hasOwn(changes, "elevation")) ) return;

  // Don't update move data if the move flag is being updated (likely due to control-z undo).
  if ( foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAGS.MOVEMENT_HISTORY}`) ) return;

  // Store the move data in a token flag so it survives reloads and can be updated on control-z undo by another user.
  // First determine the current move data.
  let lastMoveDistance = 0;
  let numDiagonal = 0;
  let combatMoveData = {};
  const ruler = canvas.controls.ruler;
  if ( ruler.active && ruler.token === token ) {
    // Ruler move
    lastMoveDistance = ruler.totalCost - ruler.history.reduce((acc, curr) => acc + curr.cost, 0);
    numDiagonal = ruler.totalDiagonals;
  } else {
    // Some other move; likely arrow keys.
    const numPrevDiagonal = game.combat?.started ? (token._combatMoveData?.numDiagonal ?? 0) : 0;
    const res = GridCoordinates3d.gridMeasurementForSegment(token.position, token.document._source, numPrevDiagonal);
    lastMoveDistance = res.cost;
    numDiagonal = res.numDiagonal;
  }

  if ( game.combat?.started ) {
    // Store the combat move distance and the last round for which the combat move occurred.
    // Map to each unique combat.
    const combatData = {...token._combatMoveData};
    if ( _options.firstRulerSegment ) {
      if (combatData.lastRound < game.combat.round ) combatData.lastMoveDistance = lastMoveDistance;
      else combatData.lastMoveDistance += lastMoveDistance;
    }
    combatData.numDiagonal = numDiagonal;
    combatData.lastRound = game.combat.round;
    combatMoveData = { [game.combat.id]: combatData };
  }

  // Combine with existing move data in the token flag.
  const flagData = document.getFlag(MODULE_ID, FLAGS.MOVEMENT_HISTORY) ?? {};
  foundry.utils.mergeObject(flagData, { lastMoveDistance, combatMoveData });

  // Update the flag with the new data.
  foundry.utils.setProperty(changes, `flags.${MODULE_ID}.${FLAGS.MOVEMENT_HISTORY}`, flagData);
}

/**
 * Hook updateToken to store non-ruler movement for combat history.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} changed                          Differential data that was used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateToken(document, changed, _options, _userId) {
  const token = document.object;
  if ( token.isPreview
    || !(Object.hasOwn(changed, "x") || Object.hasOwn(changed, "y") || Object.hasOwn(changed, "elevation")) ) return;
  if ( !game.combat?.started ) return;
  if ( canvas.controls.ruler.active && canvas.controls.ruler.token === token ) return; // Ruler movement history stored already.
  if ( !Settings.get(Settings.KEYS.MEASURING.COMBAT_HISTORY) ) return;

  // Add the move to the stored ruler history. Use the token center, not the top left, to match the ruler history.
  token[MODULE_ID] ??= {};
  const tokenHistory = token[MODULE_ID].measurementHistory ??= [];
  const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
  const origin = token.getCenterPoint(document);
  const dest = token.getCenterPoint({ x: changed.x ?? document.x, y: changed.y ?? document.y});
  origin.z = gridUnitsToPixels(document.elevation);
  origin.teleport = false;
  origin.cost = 0;
  dest.z = gridUnitsToPixels(changed.elevation ?? document.elevation);
  dest.teleport = false;
  tokenHistory.push(origin, dest);
}

// ----- NOTE: Wraps ----- //

/**
 * Wrap Token.prototype._onDragLeftStart
 * Start a ruler measurement.
 */
function _onDragLeftStart(wrapped, event) {
  wrapped(event);

  // If Token Ruler, start a ruler measurement.
  if ( !Settings.get(Settings.KEYS.TOKEN_RULER.ENABLED) ) return;

  canvas.controls.ruler._onDragStart(event, { isTokenDrag: true });
}

/**
 * Wrap Token.prototype._onDragLeftCancel
 * Continue the ruler measurement
 */
function _onDragLeftCancel(wrapped, event) {
  log("Token#_onDragLeftCancel");

  // Add waypoint on right click
  const ruler = canvas.controls.ruler;
  if ( event.button === 2 && ruler._isTokenRuler && ruler.active && ruler.state === Ruler.STATES.MEASURING ) {
    log("Token#_onDragLeftMove|Token ruler active");
    event.preventDefault();
    if ( event.ctrlKey ) ruler._removeWaypoint(event.interactionData.origin, {snap: !event.shiftKey});
    else ruler._addWaypoint(event.interactionData.origin, {snap: !event.shiftKey});
    return false;
  }

  wrapped(event);

  // Cancel a Ruler measurement.
  // If moving, handled by the drag left drop.
  if ( !Settings.get(Settings.KEYS.TOKEN_RULER.ENABLED) ) return;
  if ( ruler._state !== Ruler.STATES.MOVING ) canvas.controls.ruler._onMouseUp(event);
}

/**
 * Wrap Token.prototype._onDragLeftMove
 * Continue the ruler measurement
 */
function _onDragLeftMove(wrapped, event) {
  log("Token#_onDragLeftMove");
  wrapped(event);

  // Continue a Ruler measurement.
  if ( !Settings.get(Settings.KEYS.TOKEN_RULER.ENABLED) ) return;
  const ruler = canvas.controls.ruler;
  if ( ruler._state > 0 ) ruler._onMouseMove(event);
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

  // NO: ruler._state = Ruler.STATES.MOVING; // Do NOT set state to MOVING here in v12, as it will break the canvas.
  ruler._onMoveKeyDown(event); // Movement is async here but not awaited in _onMoveKeyDown.
}

// ----- NOTE: New getters ----- //

/**
 * Token.prototype.lastMoveDistance
 * Return the last move distance. If combat is active, return the last move since this token
 * started its turn.
 * @type {number}
 */
function lastMoveDistance() {
  if ( game.combat?.started ) {
    const combatData = this._combatMoveData;
    if ( combatData.lastRound < game.combat.round ) return 0;
    return combatData.lastMoveDistance;
  }
  return this.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_HISTORY)?.lastMoveDistance || 0;
}

/**
 * Token.prototype._combatData
 * Map that stores the combat move data.
 * Constructed from the relevant flag.
 * @type {object}
 * - @prop {number} lastMoveDistance    Distance of last move during combat round
 * - @prop {number} lastRound           The combat round in which the last move occurred
 */
function _combatMoveData() {
  const combatId = game.combat?.id;
  const defaultData = { lastMoveDistance: 0, lastRound: -1 };
  if ( typeof combatId === "undefined" ) return defaultData;
  const combatMoveData = this.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_HISTORY)?.combatMoveData ?? { };
  return combatMoveData[combatId] ?? defaultData;
}

// ----- NOTE: Patches ----- //

PATCHES.TOKEN_RULER.WRAPS = {
  _onDragLeftStart,
  _onDragLeftMove
};

PATCHES.PATHFINDING.WRAPS = { _onUpdate };

PATCHES.TOKEN_RULER.MIXES = { _onDragLeftDrop, _onDragLeftCancel };

// PATCHES.BASIC.HOOKS = { refreshToken };
PATCHES.MOVEMENT_TRACKING.HOOKS = { preUpdateToken, updateToken };
PATCHES.MOVEMENT_TRACKING.GETTERS = { lastMoveDistance, _combatMoveData };

// ----- NOTE: Helper functions ----- //

/**
 * For given easing function, modify it so it does not ease for the first half of the move.
 * @param {function} easing
 * @returns {function}
 */
function noStartEase(easing) {
  if ( typeof easing === "string" ) easing = CanvasAnimation[easing];
  return pt => (pt < 0.5) ? pt : easing(pt);
}

/**
 * For given easing function, modify it so it does not ease for the second half of the move.
 * @param {function} easing
 * @returns {function}
 */
function noEndEase(easing) {
  if ( typeof easing === "string" ) easing = CanvasAnimation[easing];
  return pt => (pt > 0.5) ? pt : easing(pt);
}
