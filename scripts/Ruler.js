/* globals
canvas,
CONFIG
CONST,
duplicate,
game,
PIXI,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Ruler class
export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.SPEED_HIGHLIGHTING = {};

import {
  elevationAtOrigin,
  terrainElevationAtPoint,
  terrainElevationAtDestination
} from "./terrain_elevation.js";

import {
  _getMeasurementSegments,
  _getSegmentLabel,
  _animateSegment,
  hasSegmentCollision,
  _highlightMeasurementSegment,
  modifiedMoveDistance
} from "./segments.js";

import { tokenIsSnapped, iterateGridUnderLine } from "./util.js";

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
  obj._unsnap = this._unsnap;
  obj._unsnappedOrigin = this._unsnappedOrigin;
  return obj;
}

/**
 * Wrap Ruler.prototype.update
 * Retrieve the current _userElevationIncrements.
 * Retrieve the current snap status.
 */
function update(wrapper, data) {
  // Fix for displaying user elevation increments as they happen.
  const triggerMeasure = this._userElevationIncrements !== data._userElevationIncrements;
  this._userElevationIncrements = data._userElevationIncrements;
  this._unsnap = data._unsnap;
  this._unsnappedOrigin = data._unsnappedOrigin;
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

  // If shift was held, use the precise point.
  if ( this._unsnap ) this.waypoints.at(-1).copyFrom(point);
  else if ( this.waypoints.length === 1 ) {
    // Move the waypoint to find unsnapped token.
    const oldWaypoint = duplicate(this.waypoints[0]);
    this.waypoints[0].copyFrom(point);
    const token = this._getMovementToken();
    if ( token && !tokenIsSnapped(token) ) this._unsnappedOrigin = true;
    else this.waypoints[0].copyFrom(oldWaypoint);
  }

  // Elevate the waypoint.
  addWaypointElevationIncrements(this, point);
}

/**
 * Wrap Ruler.prototype._removeWaypoint
 * Remove elevation increments.
 * Remove calculated path.
 */
function _removeWaypoint(wrapper, point, { snap = true } = {}) {
  if ( this._pathfindingSegmentMap ) this._pathfindingSegmentMap.delete(this.waypoints.at(-1));
  this._userElevationIncrements = 0;
  wrapper(point, { snap });
}

/**
 * Wrap Ruler.prototype._getMeasurementDestination
 * If shift was held, use the precise destination instead of snapping.
 * If dragging a token, use the center of the token as the destination.
 * @param {Point} destination     The current pixel coordinates of the mouse movement
 * @returns {Point}               The destination point, a center of a grid space
 */
function _getMeasurementDestination(wrapped, destination) {
  const pt = wrapped(destination);
  if ( this._unsnap ) pt.copyFrom(destination);
  return pt;
}

/**
 * Wrap Ruler.prototype._animateMovement
 * Add additional controlled tokens to the move, if permitted.
 */
async function _animateMovement(wrapped, token) {
  const promises = [wrapped(token)];
  for ( const controlledToken of canvas.tokens.controlled ) {
    if ( controlledToken === token ) continue;
    if ( !this.user.isGM && hasSegmentCollision(controlledToken, this.segments) ) {
      ui.notifications.error(`${game.i18n.localize("RULER.MovementNotAllowed")} for ${controlledToken.name}`);
      continue;
    }
    promises.push(wrapped(controlledToken));
  }
  return Promise.allSettled(promises);
}

/**
 * Wrap Ruler.prototype._canMove
 * Allow GM full reign to move tokens.
 */
function _canMove(wrapper, token) {
  if ( this.user.isGM ) return true;
  return wrapper(token);
}

/**
 * Override Ruler.prototype._computeDistance
 * Use measurement that counts segments within a grid square properly.
 * Add moveDistance property to each segment; track the total.
 * If token not present or Terrain Mapper not active, this will be the same as segment distance.
 * @param {boolean} gridSpaces    Base distance on the number of grid spaces moved?
 */
function _computeDistance(gridSpaces) {
  const gridless = !gridSpaces;
  const token = this._getMovementToken();
  let totalDistance = 0;
  let totalMoveDistance = 0;
  for ( const segment of this.segments ) {
    segment.distance = this.measureDistance(segment.ray.A, segment.ray.B, gridless);
    segment.moveDistance = this.modifiedMoveDistance(segment, token);
    totalDistance += segment.distance;
    totalMoveDistance += segment.moveDistance;
    segment.last = false;
  }
  if ( this.segments.length ) this.segments.at(-1).last = true;
  this.totalDistance = totalDistance;
  this.totalMoveDistance = totalMoveDistance;
}


// ----- NOTE: Event handling ----- //

/**
 * Wrap Ruler.prototype._onDragStart
 * Record whether shift is held.
 * @param {PIXI.FederatedEvent} event   The drag start event
 * @see {Canvas._onDragLeftStart}
 */
function _onDragStart(wrapped, event) {
  this._unsnap = event.shiftKey || canvas.scene.grid.type === CONST.GRID_TYPES.GRIDLESS;
  return wrapped(event);
}

/**
 * Wrap Ruler.prototype._onClickLeft.
 * Record whether shift is held.
 * @param {PIXI.FederatedEvent} event   The pointer-down event
 * @see {Canvas._onDragLeftStart}
 */
function _onClickLeft(wrapped, event) {
  this._unsnap = event.shiftKey || canvas.scene.grid.type === CONST.GRID_TYPES.GRIDLESS;
  return wrapped(event);
}

/**
 * Wrap Ruler.prototype._onClickRight
 * Record whether shift is held.
 * @param {PIXI.FederatedEvent} event   The pointer-down event
 * @see {Canvas._onClickRight}
 */
function _onClickRight(wrapped, event) {
  this._unsnap = event.shiftKey || canvas.scene.grid.type === CONST.GRID_TYPES.GRIDLESS;
  return wrapped(event);
}

/**
 * Wrap Ruler.prototype._onMouseMove
 * Record whether shift is held.
 * @param {PIXI.FederatedEvent} event   The mouse move event
 * @see {Canvas._onDragLeftMove}
 */
function _onMouseMove(wrapped, event) {
  this._unsnap = event.shiftKey || canvas.scene.grid.type === CONST.GRID_TYPES.GRIDLESS;
  return wrapped(event);
}

/**
 * Wrap Ruler.prototype._onMouseUp
 * Record whether shift is held
 * @param {PIXI.FederatedEvent} event   The pointer-up event
 * @see {Canvas._onDragLeftDrop}
 */
function _onMouseUp(wrapped, event) {
  this._unsnap = event.shiftKey || canvas.scene.grid.type === CONST.GRID_TYPES.GRIDLESS;
  return wrapped(event);
}


PATCHES.BASIC.WRAPS = {
  clear,
  toJSON,
  update,
  _addWaypoint,
  _removeWaypoint,
  _getMeasurementDestination,

  // Wraps related to segments
  _getMeasurementSegments,
  _getSegmentLabel,

  // Move token methods
  _animateMovement,

  // Events
  _onDragStart,
  _onClickLeft,
  _onClickRight,
  _onMouseMove,
  _onMouseUp,
  _canMove
};

PATCHES.BASIC.MIXES = { _animateSegment };

PATCHES.BASIC.OVERRIDES = { _computeDistance };

PATCHES.SPEED_HIGHLIGHTING.WRAPS = { _highlightMeasurementSegment };

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

/**
 * Add separate method to measure distance of a segment based on grid type.
 * Square or hex: count only distance for when the segment crosses to another square/hex.
 * A segment wholly within a square is 0 distance.
 * Instead of mathematical shortcuts from center, actual grid squares are counted.
 * Euclidean also uses grid squares, but measures using actual diagonal from center to center.
 * @param {Point} start                 Starting point for the measurement
 * @param {Point} end                   Ending point for the measurement
 * @param {boolean} [gridless=false]    For gridded canvas, force gridless measurement
 * @returns {number} Measure in grid (game) units (not pixels).
 */
const DIAGONAL_RULES = {
  EUCL: 0,
  555: 1,
  5105: 2
};
const CHANGE = {
  NONE: 0,
  V: 1,
  H: 2,
  D: 3
};

function measureDistance(start, end, gridless = false) {
  gridless ||= canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
  if ( gridless ) return CONFIG.GeometryLib.utils.pixelsToGridUnits(PIXI.Point.distanceBetween(start, end));

  start = PIXI.Point.fromObject(start);
  end = PIXI.Point.fromObject(end);

  const iter = iterateGridUnderLine(start, end);
  let prev = iter.next().value;
  if ( !prev ) return 0;

  // No change, vertical change, horizontal change, diagonal change.
  const changeCount = new Uint32Array([0, 0, 0, 0]);
  for ( const next of iter ) {
    const xChange = prev[1] !== next[1]; // Column is x
    const yChange = prev[0] !== next[0]; // Row is y
    changeCount[((xChange * 2) + yChange)] += 1;
    prev = next;
  }

  const distance = canvas.dimensions.distance;
  const diagonalRule = DIAGONAL_RULES[canvas.grid.diagonalRule] ?? DIAGONAL_RULES["555"];
  let diagonalDist = distance;
  if ( diagonalRule === DIAGONAL_RULES.EUCL ) diagonalDist = Math.hypot(distance, distance);

  // Sum the horizontal, vertical, and diagonal grid moves.
  let d = (changeCount[CHANGE.V] * distance)
    + (changeCount[CHANGE.H] * distance)
    + (changeCount[CHANGE.D] * diagonalDist);

  // If diagonal is 5-10-5, every even move gets an extra 5.
  if ( diagonalRule === DIAGONAL_RULES["5105"] ) {
    const nEven = ~~(changeCount[CHANGE.D] * 0.5);
    d += (nEven * distance);
  }

  return d;
}

PATCHES.BASIC.METHODS = {
  incrementElevation,
  decrementElevation,

  // From terrain_elevation.js
  elevationAtOrigin,
  terrainElevationAtPoint,
  terrainElevationAtDestination,

  measureDistance,
  modifiedMoveDistance
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
