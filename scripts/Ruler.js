/* globals
canvas,
CONST,
duplicate,
game,
getProperty,
PIXI,
Ruler,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Ruler class
export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.SPEED_HIGHLIGHTING = {};

import { SPEED, MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import {
  elevationAtWaypoint,
  originElevation,
  destinationElevation,
  terrainElevationAtLocation,
  elevationAtLocation
} from "./terrain_elevation.js";

import {
  _getMeasurementSegments,
  _getSegmentLabel,
  _animateSegment,
  hasSegmentCollision,
  _highlightMeasurementSegment
} from "./segments.js";

import {
  tokenIsSnapped,
  log } from "./util.js";

import {
  measureDistance,
  measureMoveDistance,
  gridShapeFromGridCoordinates
} from "./measure_distance.js";

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
  this._movementToken = undefined;
  return wrapper();
}

/**
 * Wrap Ruler.prototype.toJSON
 * Store the current userElevationIncrements for the destination.
 * Store segment information, possibly including pathfinding.
 */
function toJSON(wrapper) {
  // If debugging, log will not display on user's console
  // console.log("constructing ruler json!")
  const obj = wrapper();

  const myObj = obj[MODULE_ID] = {};

  // Segment information
  // Simplify the ray.
  if ( this.segments ) myObj._segments = this.segments.map(s => {
    const newObj = { ...s };
    newObj.ray = {
      A: s.ray.A,
      B: s.ray.B
    };
    newObj.label = Boolean(s.label);
    return newObj;
  });

  myObj._userElevationIncrements = this._userElevationIncrements;
  myObj._unsnap = this._unsnap;
  myObj._unsnappedOrigin = this._unsnappedOrigin;
  myObj.totalDistance = this.totalDistance;
  myObj.totalMoveDistance = this.totalMoveDistance;
  return obj;
}

/**
 * Wrap Ruler.prototype.update
 * Retrieve the current _userElevationIncrements.
 * Retrieve the current snap status.
 */
function update(wrapper, data) {
  const myData = data[MODULE_ID];
  if ( !myData ) return wrapper(data); // Just in case.

  // Fix for displaying user elevation increments as they happen.
  const triggerMeasure = this._userElevationIncrements !== myData._userElevationIncrements;
  this._userElevationIncrements = myData._userElevationIncrements;
  this._unsnap = myData._unsnap;
  this._unsnappedOrigin = myData._unsnappedOrigin;

  // Reconstruct segments.
  if ( myData._segments ) this.segments = myData._segments.map(s => {
    s.ray = new Ray3d(s.ray.A, s.ray.B);
    return s;
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
 * Mixed wrap Ruler.prototype._animateMovement
 * Add additional controlled tokens to the move, if permitted.
 */
async function _animateMovement(wrapped, token) {
  if ( !this.segments || !this.segments.length ) return; // Ruler._animateMovement expects at least one segment.

  log(`Moving ${token.name} ${this.segments.length} segments.`, [...this.segments]);

  this.segments.forEach((s, idx) => s.idx = idx);

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
  // If not this ruler's user, use the segments already calculated and passed via socket.
  if ( this.user !== game.user ) return;

  // Debugging
  if ( this.segments.some(s => !s) ) console.error("Segment is undefined.");

  // Determine the distance of each segment.
  _computeSegmentDistances.call(this, gridSpaces);
  if ( Settings.get(Settings.KEYS.TOKEN_RULER.SPEED_HIGHLIGHTING) ) _computeTokenSpeed.call(this, gridSpaces);

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

  // Debugging
  if ( this.segments.some(s => !s) ) console.error("Segment is undefined.");

  // Compute the waypoint distances for labeling. (Distance to immediately previous waypoint.)
  const waypointKeys = new Set(this.waypoints.map(w => w.key));
  let waypointDistance = 0;
  let waypointMoveDistance = 0;
  let waypointStartingElevation = 0;
  for ( const segment of this.segments ) {
    if ( waypointKeys.has(segment.ray.A.to2d().key) ) {
      waypointDistance = 0;
      waypointMoveDistance = 0;
      waypointStartingElevation = segment.ray.A.z;
    }
    waypointDistance += segment.distance;
    waypointMoveDistance += segment.moveDistance;
    segment.waypointDistance = waypointDistance;
    segment.waypointMoveDistance = waypointMoveDistance;
    segment.waypointElevationIncrement = segment.ray.B.z - waypointStartingElevation;
  }
}

/**
 * Calculate the distance of each segment.
 */
function _computeSegmentDistances(gridSpaces) {
  const token = this._getMovementToken();
  const gridless = !gridSpaces || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
  const measureMoveDistance = this.constructor.measureMoveDistance;

  // Loop over each segment in turn, adding the physical distance and the move distance.
  let totalDistance = 0;
  let totalMoveDistance = 0;
  if ( this.segments.length ) {
    this.segments[0].first = true;
    this.segments.at(-1).last = true;
  }
  for ( const segment of this.segments ) {
    const { distance, moveDistance } = measureMoveDistance(
      segment.ray.A,
      segment.ray.B,
      token,
      { gridless, useAllElevation: segment.last });
    segment.distance = distance;
    segment.moveDistance = moveDistance;
    totalDistance += segment.distance;
    totalMoveDistance += segment.moveDistance;
  }

  if ( totalMoveDistance > 40 ) {
    log({ totalMoveDistance });
  }

  if ( totalMoveDistance > 60 ) {
    log({ totalMoveDistance });
  }

  this.totalDistance = totalDistance;
  this.totalMoveDistance = totalMoveDistance;
}

function _computeTokenSpeed(gridSpaces) {
  // Requires a movement token and a defined token speed.
  const token = this._getMovementToken();
  if ( !token ) return;

  const speedAttribute = SPEED.ATTRIBUTES[token.movementType] ?? SPEED.ATTRIBUTES.WALK;
  const tokenSpeed = Number(getProperty(token, speedAttribute));
  if ( !tokenSpeed ) return;

  // Other constants
  const gridless = !gridSpaces || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
  const walkDistance = tokenSpeed;
  const dashDistance = tokenSpeed * SPEED.MULTIPLIER;

  // Variables changed in the loop
  let totalDistance = 0;
  let totalMoveDistance = 0;
  let totalCombatMoveDistance = 0;
  let prevCombatMoveDistance = 0;
  let dashing = false;
  let atMaximum = false;
  let nSegments = this.segments.length;

  // Add in already moved combat distance.
  if ( game.combat?.started && Settings.get(Settings.KEYS.TOKEN_RULER.COMBAT_HISTORY) ) {
    prevCombatMoveDistance = totalCombatMoveDistance = token.lastMoveDistance;
    dashing = totalCombatMoveDistance > walkDistance && !totalCombatMoveDistance.almostEqual(walkDistance, .01);
    atMaximum = totalCombatMoveDistance > dashDistance && !totalCombatMoveDistance.almostEqual(dashDistance, .01);
  }

  // Debugging, to avoid infinite loops.
  const maxIter = nSegments * 3;
  let iter = 0;

  // For each segment, determine the type of movement: walk, dash, max.
  // If a segment has 2+ types, split the segment; recalculating distances.
  for ( let i = 0; i < nSegments; i += 1 ) {
    let segment = this.segments[i];

    iter += 1; // Debugging
    if ( iter > maxIter ) break; // Debugging

    // A previous segment was at the maximum speed, so all subsequent segments are at maximum.
    if ( atMaximum ) {
      segment.speed = SPEED.TYPES.MAXIMUM;
      continue;
    }

    // Check if segment must be split.
    // Do dash first so the split can later be checked for maximum.
    const newMoveDistance = totalCombatMoveDistance + segment.moveDistance;
    const targetDistance = (!dashing && newMoveDistance > walkDistance) ? (walkDistance - prevCombatMoveDistance)
      : (!atMaximum && newMoveDistance > dashDistance) ? (dashDistance - prevCombatMoveDistance)
        : undefined;
    if ( targetDistance ) {
      // Force dash and maximum, to avoid loops on error in measurement.
      atMaximum ||= dashing;
      dashing = true;

      // Split the segment, storing the latter portion in the queue for next iteration.
      const splitDistance = targetDistance - totalMoveDistance;
      const segments = splitSegment(segment, splitDistance, token, gridless);
      if ( segments.length === 2 ) {
        this.segments.splice(i, 1, segments[0]); // Delete the old segment, replace.
        this.segments.splice(i + 1, 0, segments[1]); // Add the split.
        nSegments += 1;
        segment = segments[0];
      }
    }

    totalDistance += segment.distance;
    totalMoveDistance += segment.moveDistance;
    totalCombatMoveDistance += segment.moveDistance;

    // Mark segment speed and flag when past the dash and maximum points.
    if ( totalCombatMoveDistance > dashDistance && !totalCombatMoveDistance.almostEqual(dashDistance, .01) ) {
      segment.speed = SPEED.TYPES.MAXIMUM;
      dashing ||= true;
      atMaximum ||= true;
    } else if ( totalCombatMoveDistance > walkDistance && !totalCombatMoveDistance.almostEqual(walkDistance, .01) ) {
      segment.speed = SPEED.TYPES.DASH;
      dashing ||= true;
    } else segment.speed = SPEED.TYPES.WALK;
  }

  // Recalculated distances, just in case the splitting is off.
  this.totalDistance = totalDistance;
  this.totalMoveDistance = totalMoveDistance;
}

/* Debugging
  arr = [1,2,3,4,5,6];
  nArr = arr.length;
  iter = 0;
  for ( let i = 0; i < nArr; i += 1 ) {
    iter += 1
    if ( iter > 10 ) break;
    const a = arr[i];
    if ( a === 3 ) {
      arr.splice(i + 1, 0, 3.5);
      nArr += 1;
    }
    console.debug(`${i}, ${a}`);
  }
*/

/**
 * Cut a ruler segment at a specific point such that the first subsegment
 * measures a specific incremental move distance.
 * @param {RulerMeasurementSegment} segment       Segment, with ray property, to split
 * @param {number} incrementalMoveDistance        Distance, in grid units, of the desired first subsegment move distance
 * @param {Token} token                           Token to use when measuring move distance
 * @returns {RulerMeasurementSegment[]}
 *   If the incrementalMoveDistance is less than 0, returns [].
 *   If the incrementalMoveDistance is greater than segment move distance, returns [segment]
 *   Otherwise returns [RulerMeasurementSegment, RulerMeasurementSegment]
 */
function splitSegment(segment, splitMoveDistance, token, gridless) {
  if ( splitMoveDistance <= 0 ) return [];
  if ( !segment.moveDistance || splitMoveDistance > segment.moveDistance ) return [segment];

  // Attempt to move the split distance and determine the split location.
  const { A, B } = segment.ray;
  const res = Ruler.measureMoveDistance(A, B, token,
    { gridless, useAllElevation: false, stopTarget: splitMoveDistance });

  let breakPoint;
  if ( gridless ) breakPoint = res.endPoint; // We can get the exact split point.
  else {
    // We can get the end grid.
    // Use halfway between the intersection points for this grid shape.
    breakPoint = Point3d.fromObject(segmentGridHalfIntersection(res.endGridCoords, A, B) ?? A);
    if ( breakPoint === A ) breakPoint.z = A.z;
    else breakPoint.z = res.endElevationZ;
  }

  if ( breakPoint.almostEqual(B) ) return [segment];
  if ( breakPoint.almostEqual(A) ) return [];

  // Split the segment into two at the break point.
  const s0 = {...segment};
  s0.ray = new Ray3d(A, breakPoint);
  s0.distance = res.distance;
  s0.moveDistance = res.moveDistance;

  const s1 = {...segment};
  s1.ray = new Ray3d(breakPoint, B);
  s1.distance = segment.distance - res.distance;
  s1.moveDistance = segment.moveDistance - res.moveDistance;

  if ( segment.first ) { s1.first = false; }
  if ( segment.last ) { s0.last = false; }
  return [s0, s1];
}

/**
 * For a given segment, locate its intersection at a grid shape.
 * The intersection point is on the segment, halfway between the two intersections for the shape.
 * @param {number[]} gridCoords
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @returns {PIXI.Point|undefined} Undefined if no intersection. If only one intersection, the
 *   endpoint contained within the shape.
 */
function segmentGridHalfIntersection(gridCoords, a, b) {
  const gridShape = gridShapeFromGridCoordinates(gridCoords);
  const ixs = gridShape.segmentIntersections(a, b);
  if ( !ixs || ixs.length === 0 ) return null;
  if ( ixs.length === 1 ) return gridShape.contains(a.x, a.y) ? a : b;
  return PIXI.Point.midPoint(ixs[0], ixs[1]);
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

/**
 * Add cached movement token.
 * Mixed to avoid error if waypoints have no length.
 */
function _getMovementToken(wrapped) {
  if ( !this.waypoints.length ) {
    log("Waypoints length 0");
    return undefined;
  }

  if ( typeof this._movementToken !== "undefined" ) return this._movementToken;
  this._movementToken = wrapped();
  if ( !this._movementToken ) this._movementToken = null; // So we can skip next time.
  return this._movementToken;
}

PATCHES.BASIC.WRAPS = {
  clear,
  toJSON,
  update,
  _addWaypoint,
  _removeWaypoint,
  _getMeasurementDestination,

  // Wraps related to segments
  _getSegmentLabel,

  // Events
  _onDragStart,
  _onClickLeft,
  _onClickRight,
  _onMouseMove,
  _onMouseUp,
  _canMove
};

PATCHES.BASIC.MIXES = { _animateMovement, _getMovementToken, _getMeasurementSegments };

PATCHES.BASIC.OVERRIDES = { _computeDistance, _animateSegment };

PATCHES.SPEED_HIGHLIGHTING.WRAPS = { _highlightMeasurementSegment };

// ----- NOTE: Methods ----- //

/**
 * Add Ruler.prototype.incrementElevation
 * Increase the elevation at the current ruler destination by one grid unit.
 */
function incrementElevation() {
  const ruler = canvas.controls.ruler;
  if ( !ruler || !ruler.active ) return;
  ruler._userElevationIncrements ??= 0;
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
  ruler._userElevationIncrements ??= 0;
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
  elevationAtLocation,
  _computeTokenSpeed
};

PATCHES.BASIC.GETTERS = {
  originElevation,
  destinationElevation
};

PATCHES.BASIC.STATIC_METHODS = {
  measureDistance,
  measureMoveDistance,
  elevationAtWaypoint,
  terrainElevationAtLocation
};


// ----- Helper functions ----- //

/**
 * Helper to add elevation increments to waypoint
 */
function addWaypointElevationIncrements(ruler, _point) {
  const ln = ruler.waypoints.length;
  const newWaypoint = ruler.waypoints[ln - 1];

  // Set defaults.
  newWaypoint._terrainElevation = 0;
  newWaypoint._userElevationIncrements = 0;

  if ( ln === 1 ) {
    const moveToken = ruler._getMovementToken();
    newWaypoint._terrainElevation = moveToken ? moveToken.elevationE : Ruler.terrainElevationAtLocation(newWaypoint);

  } else {
    newWaypoint._userElevationIncrements = ruler._userElevationIncrements ?? 0;
    newWaypoint._terrainElevation = ruler.elevationAtLocation(newWaypoint);
  }
}
