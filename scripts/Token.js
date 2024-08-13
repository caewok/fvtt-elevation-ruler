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
import { MoveDistance } from "./MoveDistance.js";

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
    lastMoveDistance = ruler.totalMoveDistance;
    numDiagonal = ruler.totalDiagonals;
  } else {
    const numPrevDiagonal = game.combat?.started ? (token._combatMoveData?.numDiagonal ?? 0) : 0;
    const res = MoveDistance.measure(token.position, token.document._source, { token, numPrevDiagonal });
    lastMoveDistance = res.moveDistance;
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
 * Hook refreshToken.
 * Adjust terrain as the token moves; handle animation pauses.
 */
// function refreshToken(token, flags) {
//
//
//   if ( !token.isPreview ) {
//     //log(`refreshToken|${token.name} not preview`);
//     // console.groupEnd(`${MODULE_ID}|refreshToken`);
//     return;
//   }
//   console.group(`${MODULE_ID}|refreshToken`);
//   if ( flags.refreshElevation ) {
//     log(`refreshToken|${token.name} changing elevation. Original: ${token._original?.elevationE} clone: ${token.elevationE} `);
//     // console.groupEnd(`${MODULE_ID}|refreshToken`);
//   }
//
//   if ( !( flags.refreshPosition || flags.refreshElevation || flags.refreshSize ) ) {
//     log(`refreshToken|${token.name} preview not moving`);
//     console.groupEnd(`${MODULE_ID}|refreshToken`);
//     return;
//   }
//   const ruler = canvas.controls.ruler;
//   if ( ruler.state !== Ruler.STATES.MEASURING ) {
//     log(`refreshToken|${token.name} ruler not measuring`);
//     console.groupEnd(`${MODULE_ID}|refreshToken`);
//     return;
//   }
//   if ( !ruler._isTokenRuler ) {
//     log(`refreshToken|${token.name} ruler not token ruler`);
//     console.groupEnd(`${MODULE_ID}|refreshToken`);
//     return;
//   }
//
//
//
//   //const ruler = canvas.controls.ruler;
//
//
//
//
// //   const isRulerClone = token.isPreview
// //     && ( flags.refreshPosition || flags.refreshElevation || flags.refreshSize )
// //     && ruler.state === Ruler.STATES.MEASURING
// //     && ruler._isTokenRuler;
// //   log(`refreshToken|${token.name} rulerClone: ${isRulerClone}`);
// //   if ( !isRulerClone ) return;
//
//   // Token is clone in a ruler drag operation.
//   const destination = ruler.segments.at(-1)?.ray.B;
//   if ( !destination ) return;
//   const destElevation = CONFIG.GeometryLib.utils.pixelsToGridUnits(destination.z);
//   log(`refreshToken|Preview token ${token.name} destination elevation is ${destElevation} at ${destination.x},${destination.y}`);
//
//   const elevationChanged = token.document.elevation !== destElevation;
//   if ( elevationChanged ) {
//     if ( isFinite(destElevation) ) {
//       log(`refreshToken|Setting preview token ${token.name} elevation to ${destElevation} at ${destination.x},${destination.y}`);
//       token.document.elevation = destElevation;
//       token.renderFlags.set({ "refreshTooltip": true });
//       console.groupEnd(`${MODULE_ID}|refreshToken`);
//       return;
//     } else {
//       const origin = token._original.center;
//       console.error(`${MODULE_ID}|refreshToken destination elevation is not finite. Moving from ${origin.x},${origin.y}, @${token._original.elevation} --> ${destination?.x},${destination?.y}.`)
//     }
//   }
//   console.groupEnd(`${MODULE_ID}|refreshToken`);
// }

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
  if ( event.button === 2 && ruler._isTokenRuler && ruler.active && ruler.state === Ruler.STATES.MEASURING )  {
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

  // ruler._state = Ruler.STATES.MOVING; // Do NOT set state to MOVING here in v12, as it will break the canvas.
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
PATCHES.MOVEMENT_TRACKING.HOOKS = { preUpdateToken };
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