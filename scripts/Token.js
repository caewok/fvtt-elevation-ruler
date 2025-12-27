/* globals
canvas,
CanvasAnimation,
CONFIG,
Ruler,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";
import { log } from "./util.js";

// Patches for the Token class
export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.TOKEN_RULER = {}; // Assume this patch is only present if the token ruler setting is enabled.
PATCHES.MOVEMENT_TRACKING = {};
PATCHES.PATHFINDING = {};

// ----- NOTE: Hooks ----- //

// ----- NOTE: Wraps ----- //

/**
 * Wrap Token.prototype._onDragLeftMove
 * Continue the ruler measurement
 */
function _onDragLeftMove(wrapped, event) {
  log("Token#_onDragLeftMove");

  // Gridless snapping: pause the mouse position at the token speed boundary.
  const er = this[MODULE_ID] ??= {};
  const gridlessSnap = gridlessSnapping(this, event);
  if ( gridlessSnap ) {
    er.gridless ??= { ...event.interactionData.destination };
    event.interactionData.destination.x = er.gridless.x;
    event.interactionData.destination.y = er.gridless.y;
  } else er.gridless = null;

  // Default token drag move.
  wrapped(event);
}

/**
 * Gridless snapping.
 * Snap to the dragged token's movement limit.
 * Inspired by Drag Ruler's version.
MIT License

Copyright (c) 2021 Manuel Vögele

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

 */
function gridlessSnapping(token, event) {
  if ( !canvas.grid.isGridless ) return false;
  if ( !Settings.useSpeedHighlighting(token) ) return false;

  const ruler = canvas.controls.ruler;
  if ( !ruler.state === Ruler.STATES.MEASURING ) return false;

  const snapDistance = CONFIG[MODULE_ID]?.gridlessSnapDistance();
  if ( !snapDistance ) return false;

  // Add the new destination and check the segments.
  let res = true;
  const oldDestination = { ...ruler.destination};
  const snap = !event.shiftKey;
  const newDest = ruler._getMeasurementDestination(event.interactionData.destination, { snap });
  ruler.destination = newDest;
  ruler.segments = ruler._getMeasurementSegments();
  ruler._computeDistance();

  // Test if we just passed the prior speed category limit.
//   const splitterFn = tokenSpeedSegmentSplitter(canvas.controls.ruler, token);
//   const segments = [];
//   for ( const segment of ruler.segments ) segments.push(...splitterFn(segment));
//   if ( segments.length < 2 ) res = false;
//   if ( res ) {
//     res = false;
//     const targetDistance = segments.at(-2).maxSpeedCategoryDistance;
//     const distance = segments.at(-1).cumulativeCost;
//
//     // Determine how to adjust the mouse movement.
//     // If just past the target distance, make the mouse movement "sticky".
//     if ( distance >= targetDistance && distance < (targetDistance + snapDistance) ) res = true;
//   }
  ruler.destination = oldDestination;
  return res;
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


// ----- NOTE: Patches ----- //

PATCHES.TOKEN_RULER.WRAPS = {
  _onDragLeftMove
};

PATCHES.PATHFINDING.WRAPS = { _onUpdate };

PATCHES.TOKEN_RULER.MIXES = { _onDragLeftDrop };


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
