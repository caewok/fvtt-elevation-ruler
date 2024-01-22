/* globals
canvas,
CONFIG
CONST,
duplicate,
game,
getProperty,
PIXI,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Ruler class
export const PATCHES = {};
PATCHES.BASIC = {};
PATCHES.SPEED_HIGHLIGHTING = {};

import { SPEED } from "./const.js";
import { Settings } from "./settings.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";
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

import {
  tokenIsSnapped,
  iterateGridUnderLine,
  squareGridShape,
  hexGridShape } from "./util.js";

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
 */
function toJSON(wrapper) {
  // If debugging, log will not display on user's console
  // console.log("constructing ruler json!")
  const obj = wrapper();

  // Segment information
  // Simplify the ray.
  if ( this.segments ) obj._segments = this.segments.map(s => {
    const newObj = { ...s };
    newObj.ray = {
      A: s.ray.A,
      B: s.ray.B
    };

    newObj.label = Boolean(s.label);
    return newObj;
  });

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

  // Reconstruct segments.
  if ( data._segments ) this.segments = data._segments.map(s => {
    s.ray = new Ray3d(s.ray.A, s.ray.B);
    return s;
  });

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
  // If not this ruler's user, use the segments already calculated and passed via socket.
  if ( this.user !== game.user ) return;

  const gridless = !gridSpaces;
  const token = this._getMovementToken();
  const { measureDistance, modifiedMoveDistance } = this.constructor;
  let totalDistance = 0;
  let totalMoveDistance = 0;

  if ( this.segments.some(s => !s) ) {
    console.error("Segment is undefined.");
  }

  for ( const segment of this.segments ) {
    segment.distance = measureDistance(segment.ray.A, segment.ray.B, gridless);
    segment.moveDistance = modifiedMoveDistance(segment, token);
    totalDistance += segment.distance;
    totalMoveDistance += segment.moveDistance;
    segment.last = false;
  }
  this.totalDistance = totalDistance;
  this.totalMoveDistance = totalMoveDistance;

  const tokenSpeed = Number(getProperty(token, SPEED.ATTRIBUTE));
  if ( Settings.get(Settings.KEYS.TOKEN_RULER.SPEED_HIGHLIGHTING)
    && tokenSpeed ) this._computeTokenSpeed(token, tokenSpeed, gridless);
  if ( this.segments.length ) this.segments.at(-1).last = true;

  if ( this.segments.some(s => !s) ) {
    console.error("Segment is undefined.");
  }


}

function _computeTokenSpeed(token, tokenSpeed, gridless = false) {
  let totalMoveDistance = 0;
  let dashing = false;
  let atMaximum = false;
  const walkDist = tokenSpeed;
  const dashDist = tokenSpeed * SPEED.MULTIPLIER;
  const newSegments = [];
  for ( let segment of this.segments ) {
    if ( atMaximum ) {
      segment.speed = SPEED.TYPES.MAXIMUM;
      newSegments.push(segment);
      continue;
    }

    let newMoveDistance = totalMoveDistance + segment.moveDistance;
    if ( !dashing && Number.between(walkDist, totalMoveDistance, newMoveDistance, false) ) {
      // Split required
      const splitMoveDistance = walkDist - totalMoveDistance;
      const segments = splitSegment(segment, splitMoveDistance, token, gridless);
      if ( segments.length === 1 ) {
        segment.speed = SPEED.TYPES.WALK;
        newSegments.push(segment);
        totalMoveDistance += segment.moveDistance;
        continue;
      } else if ( segments.length === 2 ) {
        segments[0].speed = SPEED.TYPES.WALK;
        newSegments.push(segments[0]);
        totalMoveDistance += segments[0].moveDistance;
        segment = segments[1];
        newMoveDistance = totalMoveDistance + segment.moveDistance;
      }
    }

    if ( !atMaximum && Number.between(dashDist, totalMoveDistance, newMoveDistance, false) ) {
      // Split required
      const splitMoveDistance = dashDist - totalMoveDistance;
      const segments = splitSegment(segment, splitMoveDistance, token, gridless);
      if ( segments.length === 1 ) {
        segment.speed = SPEED.TYPES.DASH;
        newSegments.push(segment);
        totalMoveDistance += segment.moveDistance;
        continue;
      } else if ( segments.length === 2 ) {
        segments[0].speed = SPEED.TYPES.DASH;
        newSegments.push(segments[0]);
        totalMoveDistance += segments[0].moveDistance;
        segment = segments[1];
        newMoveDistance = totalMoveDistance + segment.moveDistance;
      }
    }

    if ( totalMoveDistance > dashDist ) {
      segment.speed = SPEED.TYPES.MAXIMUM;
      dashing ||= true;
      atMaximum ||= true;
    } else if ( totalMoveDistance > walkDist ) {
      segment.speed = SPEED.TYPES.DASH;
      dashing ||= true;
    } else segment.speed = SPEED.TYPES.WALK;

    totalMoveDistance += segment.moveDistance;
    newSegments.push(segment);
  }

  this.segments = newSegments;
  return newSegments;
}

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
  if ( splitMoveDistance > segment.moveDistance ) return [segment];


  // Determine where on the segment ray the cutoff occurs.
  // Use canvas grid distance measurements to handle 5-5-5, 5-10-5, other measurement configs.
  // At this point, the segment is too long for the cutoff.
  // If we are using a grid, split the segment at grid/square hex.
  // Find where the segment intersects the last grid square/hex before the cutoff.
  const rulerClass = CONFIG.Canvas.rulerClass;
  let breakPoint;
  const { A, B } = segment.ray;
  gridless ||= (canvas.grid.type === CONST.GRID_TYPES.GRIDLESS);
  if ( gridless ) {
    // Use ratio (t) value
    const t = splitMoveDistance / segment.moveDistance;
    breakPoint = A.projectToward(B, t);
  } else {
    // Cannot just use the t value because segment distance may not be Euclidean.
    // Also need to handle that a segment might break on a grid border.
    // Determine all the grid positions, and drop each one in turn.
    const z = segment.ray.A.z;
    const gridShapeFn = canvas.grid.type === CONST.GRID_TYPES.SQUARE ? squareGridShape : hexGridShape;
    const segmentDistZ = segment.ray.distance;

    // Cannot just use the t value because segment distance may not be Euclidean.
    // Also need to handle that a segment might break on a grid border.
    // Determine all the grid positions, and drop each one in turn.
    breakPoint = B;
    const gridIter = iterateGridUnderLine(A, B, { reverse: true });
    for ( const [r1, c1] of gridIter ) {
      const [x, y] = canvas.grid.grid.getPixelsFromGridPosition(r1, c1);
      const shape = gridShapeFn({x, y});
      const ixs = shape
        .segmentIntersections(A, B)
        .map(ix => PIXI.Point.fromObject(ix));
      if ( !ixs.length ) continue;

      // If more than one, split the distance.
      // This avoids an issue whereby a segment is too short and so the first square is dropped when highlighting.
      if ( ixs.length === 1 ) breakPoint = ixs[0];
      else {
        ixs.forEach(ix => {
          ix.distance = ix.subtract(A).magnitude();
          ix.t0 = ix.distance / segmentDistZ;
        });
        const t = (ixs[0].t0 + ixs[1].t0) * 0.5;
        breakPoint = A.projectToward(B, t);
      }

      // Construct a shorter segment.
      breakPoint.z = z;
      const shorterSegment = { ray: new Ray3d(A, breakPoint) };
      shorterSegment.moveDistance = rulerClass.modifiedMoveDistance(shorterSegment, token);
      if ( shorterSegment.moveDistance <= splitMoveDistance ) break;
    }
  }

  if ( breakPoint.almostEqual(B) ) return [segment];
  if ( breakPoint.almostEqual(A) ) return [];

  // Split the segment into two at the break point.
  const segment0 = { ray: new Ray3d(A, breakPoint) };
  const segment1 = { ray: new Ray3d(breakPoint, B) };
  segment0.moveDistance = rulerClass.modifiedMoveDistance(segment0, token);
  segment1.moveDistance = rulerClass.modifiedMoveDistance(segment1, token);
  return [segment0, segment1];
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
    console.debug("Waypoints length 0");
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

PATCHES.BASIC.MIXES = { _animateSegment, _getMovementToken, _getMeasurementSegments };

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

  _computeTokenSpeed
};

PATCHES.BASIC.STATIC_METHODS = {
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
