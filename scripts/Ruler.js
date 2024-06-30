/* globals
canvas,
CONFIG,
game,
PIXI,
Ruler,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Ruler class
export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.SPEED_HIGHLIGHTING = {};

import { SPEED, MODULE_ID, FLAGS } from "./const.js";
import { Settings } from "./settings.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";
import {
  elevationFromWaypoint,
  elevationAtWaypoint,
  originElevation,
  destinationElevation,
  terrainElevationAtLocation,
  userElevationChangeAtWaypoint
} from "./terrain_elevation.js";

import {
  _getMeasurementSegments,
  _getSegmentLabel,
  _animateSegment,
  _highlightMeasurementSegment
} from "./segments.js";

import { log } from "./util.js";

import { PhysicalDistance } from "./PhysicalDistance.js";

import { MoveDistance } from "./MoveDistance.js";

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

/* Elevation measurement

Each waypoint has added properties:
- _userElevationIncrements: Elevation shifts up or down at this point due to user input
- _terrainElevation: Ground/terrain elevation, calculated as needed
- _prevElevation: The calculated elevation of this waypoint, which is the previous waypoint elevation
  plus changes due to moving across regions
- _forceToGround: This waypoint should force its elevation to the terrain ground level.

When a waypoint is added, its _prevElevation is calculated. Then its elevation is further modified by its properties.

*/

// ----- NOTE: Wrappers ----- //

/**
 * Wrap Ruler.prototype._getMeasurementData
 * Store the current userElevationIncrements for the destination.
 * Store segment information, possibly including pathfinding.
 */
function _getMeasurementData(wrapper) {
  const obj = wrapper();
  const myObj = obj[MODULE_ID] = {};

  // Segment information
  // Simplify the ray.
  if ( this.segments ) myObj._segments = this.segments.map(segment => {
    const newObj = { ...segment };
    newObj.ray = {
      A: segment.ray.A,
      B: segment.ray.B
    };
    newObj.label = Boolean(segment.label);
    if ( segment.speed ) newObj.speed = segment.speed.name;
    return newObj;
  });

  myObj.totalDistance = this.totalDistance;
  myObj.totalMoveDistance = this.totalMoveDistance;
  myObj._isTokenRuler = this._isTokenRuler;
  return obj;
}

/**
 * Wrap Ruler.prototype.update
 * Retrieve the current _userElevationIncrements.
 * Retrieve the current snap status.
 */
function update(wrapper, data) {
  if ( !data || (data.state === Ruler.STATES.INACTIVE) ) return wrapper(data);
  const myData = data[MODULE_ID];
  if ( !myData ) return wrapper(data); // Just in case.

  // Hide GM token ruler
  if ( data.token && this.user.isGM && !game.user.isGM && Settings.get(Settings.KEYS.TOKEN_RULER.HIDE_GM)) return wrapper(data);

  // Fix for displaying user elevation increments as they happen.
  const triggerMeasure = this._userElevationIncrements !== myData._userElevationIncrements;
  this._isTokenRuler = myData._isTokenRuler;

  // Reconstruct segments.
  if ( myData._segments ) this.segments = myData._segments.map(segment => {
    segment.ray = new Ray3d(segment.ray.A, segment.ray.B);
    if ( segment.speed ) segment.speed = SPEED.CATEGORIES.find(category => category.name === segment.speed);
    return segment;
  });

  // Add the calculated distance totals.
  this.totalDistance = myData.totalDistance;
  this.totalMoveDistance = myData.totalMoveDistance;

  wrapper(data);

  if ( triggerMeasure ) {
    const ruler = canvas.controls.ruler;
    this.destination.x -= 1;
    ruler.measure(this.destination);
  }
}

/**
 * Override Ruler.prototype._addWaypoint
 * Add elevation increments before measuring.
 * @param {Point} point                    The waypoint
 * @param {object} [options]               Additional options
 * @param {boolean} [options.snap=true]    Snap the waypoint?
 */
function _addWaypoint(point, {snap=true}={}) {
  if ( (this.state !== Ruler.STATES.STARTING) && (this.state !== Ruler.STATES.MEASURING ) ) return;
  const waypoint = this.state === Ruler.STATES.STARTING
    ? this._getMeasurementOrigin(point, {snap})
    : this._getMeasurementDestination(point, {snap});

  // Set defaults
  waypoint._userElevationIncrements = 0;
  waypoint._forceToGround = Settings.FORCE_TO_GROUND;

  // Determine the elevation up until this point
  if ( !this.waypoints.length ) {
    waypoint._prevElevation = this.token?.elevationE ?? canvas.scene.getFlag("terrainmapper", FLAGS.SCENE.BACKGROUND_ELEVATION) ?? 0;
    waypoint._forceToGround ||= this.token ? this.token.movementType === "WALK" : false;
  } else waypoint._prevElevation = elevationFromWaypoint(this.waypoints.at(-1), waypoint, this.token);

  this.waypoints.push(waypoint);
  this._state = Ruler.STATES.MEASURING;
  this.measure(this.destination ?? point, {snap, force: true});
}

/**
 * Wrap Ruler.prototype._removeWaypoint
 * Remove elevation increments.
 * Remove calculated path.
 */
function _removeWaypoint(wrapper, point, { snap = true } = {}) {
  if ( this._pathfindingSegmentMap ) this._pathfindingSegmentMap.delete(this.waypoints.at(-1));
  wrapper(point, { snap });
}

/**
 * Wrap Ruler.prototype._getMeasurementOrigin
 * Get the measurement origin.
 * If Token Ruler, shift the measurement origin to the token center, adjusted for non-symmetrical tokens.
 * @param {Point} point                    The waypoint
 * @param {object} [options]               Additional options
 * @param {boolean} [options.snap=true]    Snap the waypoint?
 * @protected
 */
function _getMeasurementOrigin(wrapped, point, {snap=true}={}) {
  point = wrapped(point, { snap });
  const token = this.token;
  if ( !this._isTokenRuler || !token ) return point;

  // Shift to token center
  const { width, height } = token.getSize();
  const tl = token.document;
  return {
    x: tl.x + width * 0.5,
    y: tl.y + height * 0.5
  };
}

/**
 * Wrap Ruler.prototype._getMeasurementDestination
 * Get the destination point. By default the point is snapped to grid space centers.
 * Adjust the destination point to match where the preview token is placed.
 * @param {Point} point                    The point coordinates
 * @param {object} [options]               Additional options
 * @param {boolean} [options.snap=true]    Snap the point?
 * @returns {Point}                        The snapped destination point
 * @protected
 */
function _getMeasurementDestination(wrapped, point, {snap=true}={}) {
  point = wrapped(point, { snap });
  const token = this.token;
  if ( !this._isTokenRuler || !token ) return point;
  if ( !token._preview ) return point;

  // Shift to token center or snapped center
  const { width, height } = token.getSize();
  const tl = snap ? token._preview.getSnappedPosition(token._preview.document) : token._preview.document;
  return {
    x: tl.x + width * 0.5,
    y: tl.y + height * 0.5
  };
}

/**
 * Mixed wrap Ruler.prototype._animateMovement
 * Add additional controlled tokens to the move, if permitted.
 */
async function _animateMovement(wrapped, token) {
  if ( !this.segments || !this.segments.length ) return; // Ruler._animateMovement expects at least one segment.

  log(`Moving ${token.name} ${this.segments.length} segments.`, [...this.segments]);

  this.segments.forEach((s, idx) => s.idx = idx);

  //_recalculateOffset.call(this, token);
  const promises = [wrapped(token)];
  for ( const controlledToken of canvas.tokens.controlled ) {
    if ( controlledToken === token ) continue;
    if ( !(this.user.isGM || this._canMove(controlledToken)) ) {
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
 */
function _computeDistance() {
  // If not this ruler's user, use the segments already calculated and passed via socket.
  if ( this.user !== game.user ) return;

  // Debugging
  const debug = CONFIG[MODULE_ID].debug;
  if ( debug && this.segments.some(s => !s) ) console.error("Segment is undefined.");

  // Determine the distance of each segment.
  _computeSegmentDistances.call(this);

  if ( debug ) {
    switch ( this.segments.length ) {
      case 1: break;
      case 2: break;
      case 3: break;
      case 4: break;
      case 5: break;
      case 6: break;
      case 7: break;
      case 8: break;
      case 9: break;
    }
  }

  // Debugging
  if ( debug && this.segments.some(s => !s) ) console.error("Segment is undefined.");

  // Compute the waypoint distances for labeling. (Distance to immediately previous waypoint.)
  const waypointKeys = new Set(this.waypoints.map(w => PIXI.Point._tmp.copyFrom(w).key));
  let waypointDistance = 0;
  let waypointMoveDistance = 0;

  let currWaypointIdx = -1;
  for ( const segment of this.segments ) {
    // Segments assumed to be in order of the waypoint.
    const A = PIXI.Point._tmp.copyFrom(segment.ray.A);
    if ( waypointKeys.has(A.key) ) {
      currWaypointIdx += 1;
      waypointDistance = 0;
      waypointMoveDistance = 0;
    }
    segment.waypointIdx = currWaypointIdx;
    waypointDistance += segment.distance;
    waypointMoveDistance += segment.moveDistance;
    segment.waypointDistance = waypointDistance;
    segment.waypointMoveDistance = waypointMoveDistance;
    segment.waypointElevationIncrement = userElevationChangeAtWaypoint(this.waypoints[currWaypointIdx]);
  }
}

/**
 * Calculate the distance of each segment.
 * Segments are considered a group, so that alternating diagonals gives the same result
 * with or without the segment breaks.
 */
function _computeSegmentDistances() {
  const token = this.token;

  // Loop over each segment in turn, adding the physical distance and the move distance.
  let totalDistance = 0;
  let totalMoveDistance = 0;
  let numPrevDiagonal = 0;

  if ( this.segments.length ) {
    this.segments[0].first = true;
    this.segments.at(-1).last = true;
  }
  for ( const segment of this.segments ) {
    numPrevDiagonal = measureSegment(segment, token, numPrevDiagonal);
    totalDistance += segment.distance;
    totalMoveDistance += segment.moveDistance;
  }

  this.totalDistance = totalDistance;
  this.totalMoveDistance = totalMoveDistance;
}

/**
 * Measure a given segment, updating its distance labels accordingly.
 * Segment modified in place.
 * @param {RulerSegment} segment          Segment to measure
 * @param {Token} [token]                 Token to use for the measurement
 * @param {number} [numPrevDiagonal=0]    Number of previous diagonals for the segment
 * @returns {number} numPrevDiagonal
 */
export function measureSegment(segment, token, numPrevDiagonal = 0) {
  segment.numPrevDiagonal = numPrevDiagonal;
  const res = MoveDistance.measure(
    segment.ray.A,
    segment.ray.B,
    { token, useAllElevation: segment.last, numPrevDiagonal });
  segment.distance = res.distance;
  segment.moveDistance = res.moveDistance;
  segment.numDiagonal = res.numDiagonal;
  return res.numPrevDiagonal;
}

// TODO:
// Need to recalculate segment distances and segment numPrevDiagonal, because
// each split will potentially screw up numPrevDiagonal.
// May not even need to store numPrevDiagonal in segments.
// Also need to handle array of speed points.
//   Need CONFIG function that takes a token and gives array of speeds with colors.



/**
 * Mixed wrap Ruler#_broadcastMeasurement
 * For token ruler, don't broadcast the ruler if the token is invisible or disposition secret.
 */
function _broadcastMeasurement(wrapped) {
  // Don't broadcast invisible, hidden, or secret token movement when dragging.
  if ( this._isTokenRuler && !this.token ) return;
  if ( this._isTokenRuler
    && (this.token.document.disposition === CONST.TOKEN_DISPOSITIONS.SECRET
     || this.token.document.hasStatusEffect(CONFIG.specialStatusEffects.INVISIBLE)
     || this.token.document.isHidden) ) return;

  wrapped();
}

// ----- NOTE: Event handling ----- //

/**
 * Wrap Ruler.prototype._onDragStart
 * Record whether shift is held.
 * Reset FORCE_TO_GROUND
 * @param {PIXI.FederatedEvent} event   The drag start event
 * @see {Canvas._onDragLeftStart}
 */
function _onDragStart(wrapped, event, { isTokenDrag = false } = {}) {
  Settings.FORCE_TO_GROUND = false;
  this._userElevationIncrements = 0;
  this._isTokenRuler = isTokenDrag;
  return wrapped(event);
}

/**
 * Wrap Ruler.prototype._onMoveKeyDown
 * If the teleport key is held, teleport the token.
 * @param {KeyboardEventContext} context
 */
function _onMoveKeyDown(wrapped, context) {
  const teleportKeys = new Set(game.keybindings.get(MODULE_ID, Settings.KEYBINDINGS.TELEPORT).map(binding => binding.key));
  if ( teleportKeys.intersects(game.keyboard.downKeys) ) this.segments.forEach(s => s.teleport = true);
  wrapped(context);
}

PATCHES.BASIC.WRAPS = {
  _getMeasurementData,
  update,
  _removeWaypoint,
  _getMeasurementOrigin,
  _getMeasurementDestination,

  // Wraps related to segments
  _getSegmentLabel,

  // Events
  _onDragStart,
  _canMove,
  _onMoveKeyDown
};

PATCHES.BASIC.MIXES = { _animateMovement, _getMeasurementSegments, _broadcastMeasurement };

PATCHES.BASIC.OVERRIDES = { _computeDistance, _animateSegment, _addWaypoint };

PATCHES.SPEED_HIGHLIGHTING.WRAPS = { _highlightMeasurementSegment };

// ----- NOTE: Methods ----- //

/**
 * Add Ruler.prototype.incrementElevation
 * Increase the elevation at the current ruler waypoint by one grid unit.
 */
function incrementElevation() {
  const ruler = this;
  if ( !ruler || !ruler.active ) return;

  // Increment the elevation at the last waypoint.
  const waypoint = this.waypoints.at(-1);
  waypoint._userElevationIncrements ??= 0;
  waypoint._userElevationIncrements += 1;

  // Update the ruler display.
  ruler.measure(this.destination, { force: true });

  // Broadcast the activity (see ControlsLayer.prototype._onMouseMove)
  this._broadcastMeasurement();
  // game.user.broadcastActivity({ ruler: ruler.toJSON() });
}

/**
 * Add Ruler.prototype.decrementElevation
 * Decrease the elevation at the current ruler waypoint by one grid unit.
 */
function decrementElevation() {
  const ruler = this;
  if ( !ruler || !ruler.active ) return;

  // Decrement the elevation at the last waypoint.
  const waypoint = this.waypoints.at(-1);
  waypoint._userElevationIncrements ??= 0;
  waypoint._userElevationIncrements -= 1;

  // Update the ruler display.
  ruler.measure(this.destination, { force: true});

  // Broadcast the activity (see ControlsLayer.prototype._onMouseMove)
  this._broadcastMeasurement();
  // game.user.broadcastActivity({ ruler: ruler.toJSON() });
}

/**
 * Add Ruler.prototype.moveWithoutAnimation
 * Move the token and stop the ruler measurement
 * @returns {boolean} False if the movement did not occur
 */
async function teleport(_context) {
  if ( this._state !== this.constructor.STATES.MEASURING ) return false;
  if ( !this._canMove(this.token) ) return false;

  // Change all segments to teleport.
  this.segments.forEach(s => s.teleport = true);
  return this.moveToken();
}


PATCHES.BASIC.METHODS = {
  incrementElevation,
  decrementElevation,
  teleport
};

PATCHES.BASIC.GETTERS = {
  originElevation,
  destinationElevation
};

PATCHES.BASIC.STATIC_METHODS = {
  elevationAtWaypoint,
  terrainElevationAtLocation,
  measureDistance: PhysicalDistance.measure.bind(PhysicalDistance),
  measureMoveDistance: MoveDistance.measure.bind(MoveDistance)
};



