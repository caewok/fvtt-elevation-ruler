/* globals
canvas,
game
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Ruler class
export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.TOKEN_RULER = {};
PATCHES.DRAG_RULER = {};

import {
  elevationAtOrigin,
  terrainElevationAtPoint,
  terrainElevationAtDestination
} from "./terrain_elevation.js";

import {
  _getMeasurementSegments,
  _getSegmentLabel,
  _animateSegment
} from "./segments.js";

/**
 * Modified Ruler
 * Measure elevation change at each waypoint and destination.
 * Modify distance calculation accordingly.
 * Display current elevation change and change at each waypoint.
 */

/**
 * Typical Ruler workflow:
 * - clear when drag starts
 * - create initial waypoint
 * - measure (likely multiple)
 * - add'l waypoints (optional)
 * - possible token movement
 * - clear when drag abandoned
 */

/*
UX goals:
1. Ruler origin elevation is the starting token elevation, if any, or the terrain elevation.
2. Dragging the ruler to the next space may cause it to drop if the token is elevated.
- This is probably fine? If flying while everyone else is on the ground, the default should
    account for that.
- A bit cumbersome if measuring straight across elevated terrain, but (a) use terrain layer and
    (b) other elevated tokens should change the destination elevation automatically. (see 3 below)
3. If the destination space is an elevated token or terrain, use that elevation for destination.
- So measuring that space will change the ruler elevation indicator accordingly.
- This will cause the elevation indicator to change without other user input. This is probably fine?
    User will be dragging the ruler, so that is appropriate feedback.
4. User can at any time increment or decrement. This is absolute, in that it is added on top of any
    default elevations from originating/destination tokens or terrain.
- Meaning, origination could be 0, user increments 5 and then drags to a terrain space of 50; ruler
    would go from 5 to 55.
*/

// ----- NOTE: Wrappers ----- //

/**
 * Wrap Ruler.prototype.clear
 * Reset properties used to track when the user increments/decrements elevation
 */
function clear(wrapper) {
  // User increments/decrements to the elevation for the current destination
  this.destination._userElevationIncrements = 0;
  return wrapper();
}

/**
 * Wrap Ruler.prototype.toJSON
 * Store the current userElevationIncrements for the destination.
 */
function toJSON(wrapper) {
  // If debugging, log will not display on user's console
  // console.log("constructing ruler json!")
  const obj = wrapper();
  obj._userElevationIncrements = this._userElevationIncrements;
  return obj;
}

/**
 * Wrap Ruler.prototype.update
 * Retrieve the current _userElevationIncrements
 */
function update(wrapper, data) {
  // Fix for displaying user elevation increments as they happen.
  const triggerMeasure = this._userElevationIncrements !== data._userElevationIncrements;
  this._userElevationIncrements = data._userElevationIncrements;
  wrapper(data);

  if ( triggerMeasure ) {
    const ruler = canvas.controls.ruler;
    this.destination.x -= 1;
    ruler.measure(this.destination);
  }
}

/**
 * Wrap Ruler.prototype._addWaypoint
 * Add elevation increments
 */
function _addWaypoint(wrapper, point) {
  wrapper(point);
  addWaypointElevationIncrements(this, point);
}

/**
 * Wrap Ruler.prototype._removeWaypoint
 * Remove elevation increments.
 * (Note: also called by DragRulerRuler.prototype.dragRulerDeleteWaypoint)
 */
function _removeWaypoint(wrapper, point, { snap = true } = {}) {
  this._userElevationIncrements = 0;
  wrapper(point, { snap });
}

/**
 * Wrap Ruler.prototype._animateMovement
 * Add additional controlled tokens to the move, if permitted.
 */
async function _animateMovement(wrapped, token) {
  const promises = [wrapped(token)];
  const controlled = canvas.tokens.controlled;
  let error;
  for ( const controlledToken of controlled ) {
    if ( controlledToken === token ) continue;
    promises.push(wrapped(controlledToken));
    // TODO: token.checkCollision; throw error.

  }
  return Promise.allSettled(promises);
}

/**
 * Wrap DragRulerRuler.prototype.dragRulerAddWaypoint
 * Add elevation increments
 */
function dragRulerAddWaypoint(wrapper, point, options = {}) {
  wrapper(point, options);
  addWaypointElevationIncrements(this, point);
}

/**
 * Wrap DragRulerRuler.prototype.dragRulerClearWaypoints
 * Remove elevation increments
 */
function dragRulerClearWaypoints(wrapper) {
  wrapper();
  this._userElevationIncrements = 0;
}


/**
 * Wrap DragRulerRuler.prototype._endMeasurement
 * If there is a dragged token, apply the elevation to all selected tokens (assumed part of the move).
 */
function _endMeasurement(wrapped) {
  console.debug("_endMeasurement");
  return wrapped();
}


function _postMove(wrapped, token) {
  console.debug("_postMove");
  return wrapped(token);
}


//   // Assume the destination elevation is the desired elevation if dragging multiple tokens.
//   // (Likely more useful than having a bunch of tokens move down 10'?)
//   const ruler = canvas.controls.ruler;
//   if ( !ruler.isDragRuler ) return wrapped(event);
//
//   // Do before calling wrapper b/c ruler may get cleared.
//   const elevation = elevationAtWaypoint(ruler.destination);
//   const selectedTokens = [...canvas.tokens.controlled];
//   if ( !selectedTokens.length ) selectedTokens.push(ruler.draggedEntity);
//
//   const result = wrapped(event);
//   if ( result === false ) return false; // Drag did not happen
//
//   const updates = selectedTokens.map(t => {
//     return { _id: t.id, elevation };
//   });
//
//   const t0 = selectedTokens[0];
//   await t0.scene.updateEmbeddedDocuments(t0.constructor.embeddedName, updates);
//   return true;




PATCHES.BASIC.WRAPS = {
  clear,
  toJSON,
  update,
  _addWaypoint,
  _removeWaypoint,

  // Wraps related to segments
  _getMeasurementSegments,
  _getSegmentLabel,

  // Move token methods
  // _animateSegment,
  _animateMovement
  // _postMove
};

PATCHES.BASIC.MIXES = { _animateSegment };

PATCHES.DRAG_RULER.WRAPS = {
  dragRulerAddWaypoint,
  dragRulerClearWaypoints,
  // _endMeasurement
};

// ----- NOTE: Methods ----- //

/**
 * Add Ruler.prototype.incrementElevation
 * Increase the elevation at the current ruler destination by one grid unit.
 */
function incrementElevation() {
  const ruler = canvas.controls.ruler;
  if ( !ruler || !ruler.active ) return;

  ruler._userElevationIncrements += 1;

  // Weird, but slightly change the destination to trigger a measure
  const destination = { x: this.destination.x, y: this.destination.y };
  this.destination.x -= 1;
  ruler.measure(destination);

  // Broadcast the activity (see ControlsLayer.prototype._onMouseMove)
  game.user.broadcastActivity({ ruler: ruler.toJSON() });
}

/**
 * Add Ruler.prototype.decrementElevation
 * Decrease the elevation at the current ruler destination by one grid unit.
 */
function decrementElevation() {
  const ruler = canvas.controls.ruler;
  if ( !ruler || !ruler.active ) return;

  ruler._userElevationIncrements -= 1;

  // Weird, but slightly change the destination to trigger a measure
  const destination = { x: this.destination.x, y: this.destination.y };
  this.destination.x -= 1;
  ruler.measure(destination);

  // Broadcast the activity (see ControlsLayer.prototype._onMouseMove)
  game.user.broadcastActivity({ ruler: ruler.toJSON() });
}

PATCHES.BASIC.METHODS = {
  incrementElevation,
  decrementElevation,

  // From terrain_elevation.js
  elevationAtOrigin,
  terrainElevationAtPoint,
  terrainElevationAtDestination
};


// ----- Helper functions ----- //

/**
 * Helper to add elevation increments to waypoint
 */
function addWaypointElevationIncrements(ruler, point) {
  const ln = ruler.waypoints.length;
  const newWaypoint = ruler.waypoints[ln - 1];
  if ( ln === 1) {
    // Origin waypoint -- cache using elevationAtOrigin
    ruler.elevationAtOrigin();
    ruler._userElevationIncrements = 0;
  } else {
    newWaypoint._terrainElevation = ruler.terrainElevationAtPoint(point);
    newWaypoint._userElevationIncrements = ruler._userElevationIncrements;
  }
}
