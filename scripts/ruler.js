/* globals
canvas,
Color,
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
PATCHES.TOKEN_RULER = {};
PATCHES.DRAG_RULER = {};
PATCHES.SPEED_HIGHLIGHTING = {};

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

import { SPEED, MODULES_ACTIVE } from "./const.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";

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

  // If moving a token, start the origin at the token center.
  if ( this.waypoints.length === 1 ) {
    // Temporarily replace the waypoint with the point so we can detect the token properly.
    const snappedWaypoint = duplicate(this.waypoints[0]);
    this.waypoints[0].copyFrom(point);
    const token = this._getMovementToken();
    if ( token ) this.waypoints[0].copyFrom(token.center);
    else this.waypoints[0].copyFrom(snappedWaypoint);
  }

  // Otherwise if shift was held, use the precise point.
  else if ( this._unsnap ) this.waypoints.at(-1).copyFrom(point);

  // Elevate the waypoint.
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
 * Wrap Ruler.prototype._getMeasurementDestination
 * If shift was held, use the precise destination instead of snapping.
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
    if ( hasSegmentCollision(controlledToken, this.segments) ) {
      ui.notifications.error(`${game.i18n.localize("RULER.MovementNotAllowed")} for ${controlledToken.name}`);
      continue;
    }
    promises.push(wrapped(controlledToken));
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
 * Wrap Ruler.prototype._computeDistance
 * Add moveDistance property to each segment; track the total.
 * If token not present or Terrain Mapper not active, this will be the same as segment distance.
 * @param {boolean} gridSpaces    Base distance on the number of grid spaces moved?
 */
function _computeDistance(wrapped, gridSpaces) {
  wrapped(gridSpaces);

  // Add a movement distance based on token and terrain for the segment.
  // Default to segment distance.
  const token = this._getMovementToken();
  let totalMoveDistance = 0;
  for ( const segment of this.segments ) {
    segment.moveDistance = modifiedMoveDistance(segment.distance, segment.ray, token);
    totalMoveDistance += segment.moveDistance;
  }
  this.totalMoveDistance = totalMoveDistance;
}


/**
 * Modify distance by terrain mapper adjustment for token speed.
 * @param {number} distance   Distance of the ray
 * @param {Ray|Ray3d} ray     Ray to measure
 * @param {Token} token       Token to use
 * @returns {number} Modified distance
 */
function modifiedMoveDistance(distance, ray, token) {
  if ( !MODULES_ACTIVE.TERRAIN_MAPPER || !token ) return distance;
  const terrainAPI = game.modules.get("terrainmapper").api;
  const moveMult = terrainAPI.Terrain.percentMovementForTokenAlongPath(token, ray.A, ray.B);
  if ( !moveMult ) return distance;
  return distance * (1 / moveMult); // Invert because moveMult is < 1 if speed is penalized.
}


// ----- NOTE: Segment highlighting ----- //
/**
 * Wrap Ruler.prototype._highlightMeasurementSegment
 */
function _highlightMeasurementSegment(wrapped, segment) {
  const token = this._getMovementToken();
  if ( !token ) return wrapped(segment);
  const tokenSpeed = Number(getProperty(token, SPEED.ATTRIBUTE));
  if ( !tokenSpeed ) return wrapped(segment);

  // Based on the token being measured.
  // Track the distance to this segment.
  // Split this segment at the break points for the colors as necessary.
  let pastDistance = 0;
  for ( const s of this.segments ) {
    if ( s === segment ) break;
    pastDistance += s.moveDistance;
  }

  // Constants
  const walkDist = tokenSpeed;
  const dashDist = tokenSpeed * SPEED.MULTIPLIER;
  const walkColor = Color.from(0x00ff00);
  const dashColor = Color.from(0xffff00);
  const maxColor = Color.from(0xff0000);

  // Track the splits.
  let remainingSegment = segment;
  const splitSegments = [];

  // Walk
  remainingSegment.color = walkColor;
  const walkSegments = splitSegment(remainingSegment, pastDistance, walkDist, token);
  if ( walkSegments.length ) {
    const segment0 = walkSegments[0];
    splitSegments.push(segment0);
    pastDistance += segment0.moveDistance;
    remainingSegment = walkSegments[1]; // May be undefined.
  }

  // Dash
  if ( remainingSegment ) {
    remainingSegment.color = dashColor;
    const dashSegments = splitSegment(remainingSegment, pastDistance, dashDist, token);
    if ( dashSegments.length ) {
      const segment0 = dashSegments[0];
      splitSegments.push(segment0);
      if ( dashSegments.length > 1 ) {
        const remainingSegment = dashSegments[1];
        remainingSegment.color = maxColor;
        splitSegments.push(remainingSegment);
      }
    }
  }

  // Highlight each split in turn, changing highlight color each time.
  const priorColor = this.color;
  for ( const s of splitSegments ) {
    this.color = s.color;
    wrapped(s);

    // If gridless, highlight a rectangular shaped portion of the line.
    if ( canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ) {
      const { A, B } = s.ray;
      const width = Math.floor(canvas.scene.dimensions.size * 0.2);
      const ptsA = perpendicularPoints(A, B, width * 0.5);
      const ptsB = perpendicularPoints(B, A, width * 0.5);
      const shape = new PIXI.Polygon([
        ptsA[0],
        ptsA[1],
        ptsB[0],
        ptsB[1]
      ]);
      canvas.grid.highlightPosition(this.name, {color: this.color, shape});
    }
  }
  this.color = priorColor;
}

/**
 * Cut a segment, represented as a ray and a distance, at a given point.
 * @param {object} segment
 * @param {number} pastDistance
 * @param {number} cutoffDistance
 * @returns {object[]}
 * - If cutoffDistance is before the segment start, return [].
 * - If cutoffDistance is after the segment end, return [segment].
 * - If cutoffDistance is within the segment, return [segment0, segment1]
 */
function splitSegment(segment, pastDistance, cutoffDistance, token) {
  cutoffDistance -= pastDistance;
  if ( cutoffDistance <= 0 ) return [];
  if ( cutoffDistance >= segment.moveDistance ) return [segment];

  // Determine where on the segment ray the cutoff occurs.
  // Use canvas grid distance measurements to handle 5-5-5, 5-10-5, other measurement configs.
  // At this point, the segment is too long for the cutoff.
  // If we are using a grid, split the segment a grid/square hex.
  // Find where the segment intersects the last grid square/hex before the cutoff.
  let breakPoint;
  const { A, B } = segment.ray;
  if ( canvas.grid.type !== CONST.GRID_TYPES.GRIDLESS ) {
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
      shorterSegment.distance = canvas.grid.measureDistances([shorterSegment], { gridSpaces: true })[0];
      shorterSegment.moveDistance = modifiedMoveDistance(shorterSegment.distance, shorterSegment.ray, token);
      if ( shorterSegment.moveDistance <= cutoffDistance ) break;
    }
  } else {
    // Use t values.
    const t = cutoffDistance / segment.moveDistance;
    breakPoint = A.projectToward(B, t);
  }
  if ( breakPoint === B ) return [segment];

  // Split the segment into two at the break point.
  const segment0 = { ray: new Ray3d(A, breakPoint), color: segment.color };
  const segment1 = { ray: new Ray3d(breakPoint, B) };
  const segments = [segment0, segment1];
  const distances = canvas.grid.measureDistances(segments, { gridSpaces: false });
  segment0.distance = distances[0];
  segment1.distance = distances[1];
  segment0.moveDistance = modifiedMoveDistance(segment0.distance, segment0.ray, token);
  segment1.moveDistance = modifiedMoveDistance(segment1.distance, segment1.ray, token);
  return segments;
}

/*
 * Generator to iterate grid points under a line.
 * See Ruler.prototype._highlightMeasurementSegment
 * @param {x: Number, y: Number} origin       Origination point
 * @param {x: Number, y: Number} destination  Destination point
 * @param {object} [opts]                     Options affecting the result
 * @param {boolean} [opts.reverse]            Return the points from destination --> origin.
 * @return Iterator, which in turn
 *   returns [row, col] Array for each grid point under the line.
 */
export function * iterateGridUnderLine(origin, destination, { reverse = false } = {}) {
  if ( reverse ) [origin, destination] = [destination, origin];

  const distance = PIXI.Point.distanceBetween(origin, destination);
  const spacer = canvas.scene.grid.type === CONST.GRID_TYPES.SQUARE ? 1.41 : 1;
  const nMax = Math.max(Math.floor(distance / (spacer * Math.min(canvas.grid.w, canvas.grid.h))), 1);
  const tMax = Array.fromRange(nMax+1).map(t => t / nMax);

  // Track prior position
  let prior = null;
  let tPrior = null;
  for ( const t of tMax ) {
    const {x, y} = origin.projectToward(destination, t);

    // Get grid position
    const [r0, c0] = prior ?? [null, null];
    const [r1, c1] = canvas.grid.grid.getGridPositionFromPixels(x, y);
    if ( r0 === r1 && c0 === c1 ) continue;

    // Skip the first one
    // If the positions are not neighbors, also highlight their halfway point
    if ( prior && !canvas.grid.isNeighbor(r0, c0, r1, c1) ) {
      const th = (t + tPrior) * 0.5;
      const {x: xh, y: yh} = origin.projectToward(destination, th);
      yield canvas.grid.grid.getGridPositionFromPixels(xh, yh); // [rh, ch]
    }

    // After so the halfway point is done first.
    yield [r1, c1];

    // Set for next round.
    prior = [r1, c1];
    tPrior = t;
  }
}

// iter = iterateGridUnderLine(A, B, { reverse: false })
// points = [...iter]
// points = points.map(pt => canvas.grid.grid.getPixelsFromGridPosition(pt[0], pt[1]))
// points = points.map(pt => {
//   return {x: pt[0], y: pt[1]}
// })


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

// ----- NOTE: Event handling ----- //

/**
 * Wrap Ruler.prototype._onDragStart
 * Record whether shift is held.
 * @param {PIXI.FederatedEvent} event   The drag start event
 * @see {Canvas._onDragLeftStart}
 */
function _onDragStart(wrapped, event) {
  this._unsnap = event.shiftKey;
  return wrapped(event);
}

/**
 * Wrap Ruler.prototype._onClickLeft.
 * Record whether shift is held.
 * @param {PIXI.FederatedEvent} event   The pointer-down event
 * @see {Canvas._onDragLeftStart}
 */
function _onClickLeft(wrapped, event) {
  this._unsnap = event.shiftKey;
  return wrapped(event);
}

/**
 * Wrap Ruler.prototype._onClickRight
 * Record whether shift is held.
 * @param {PIXI.FederatedEvent} event   The pointer-down event
 * @see {Canvas._onClickRight}
 */
function _onClickRight(wrapped, event) {
  this._unsnap = event.shiftKey;
  return wrapped(event);
}

/**
 * Wrap Ruler.prototype._onMouseMove
 * Record whether shift is held.
 * @param {PIXI.FederatedEvent} event   The mouse move event
 * @see {Canvas._onDragLeftMove}
 */
function _onMouseMove(wrapped, event) {
  this._unsnap = event.shiftKey;
  return wrapped(event);
}

/**
 * Wrap Ruler.prototype._onMouseUp
 * Record whether shift is held
 * @param {PIXI.FederatedEvent} event   The pointer-up event
 * @see {Canvas._onDragLeftDrop}
 */
function _onMouseUp(wrapped, event) {
  this._unsnap = event.shiftKey;
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
  _computeDistance,

  // Move token methods
  _animateMovement,

  // Events
  _onDragStart,
  _onClickLeft,
  _onClickRight,
  _onMouseMove,
  _onMouseUp
};

PATCHES.SPEED_HIGHLIGHTING.WRAPS = { _highlightMeasurementSegment };

PATCHES.BASIC.MIXES = { _animateSegment };

PATCHES.DRAG_RULER.WRAPS = {
  dragRulerAddWaypoint,
  dragRulerClearWaypoints
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

/**
 * Check for token collision among the segments.
 * Differs from Ruler.prototype._canMove because it adjusts for token position.
 * See Ruler.prototype._animateMovement.
 * @param {Token} token         Token to test for collisions
 * @param {object} segments     Ruler segments to test
 * @returns {boolean} True if a collision is found.
 */
function hasSegmentCollision(token, segments) {
  const rulerOrigin = segments[0].ray.A;
  const collisionConfig = { type: "move", mode: "any" };
  const s2 = canvas.scene.grid.type === CONST.GRID_TYPES.GRIDLESS ? 1 : (canvas.dimensions.size / 2);
  let priorOrigin = { x: token.document.x, y: token.document.y };
  const dx = Math.round((priorOrigin.x - rulerOrigin.x) / s2) * s2;
  const dy = Math.round((priorOrigin.y - rulerOrigin.y) / s2) * s2;
  for ( const segment of segments ) {
    const adjustedDestination = canvas.grid.grid._getRulerDestination(segment.ray, {x: dx, y: dy}, token);
    collisionConfig.origin = priorOrigin;
    if ( token.checkCollision(adjustedDestination, collisionConfig) ) return true;
    priorOrigin = adjustedDestination;
  }
  return false;
}


/**
 * Helper to get the grid shape for given grid type.
 * @param {x: number, y: number} p    Location to use.
 * @returns {null|PIXI.Rectangle|PIXI.Polygon}
 */
function gridShape(p) {
  const { GRIDLESS, SQUARE } = CONST.GRID_TYPES;
  switch ( canvas.grid.type ) {
    case GRIDLESS: return null;
    case SQUARE: return squareGridShape(p);
    default: return hexGridShape(p);
  }
}

/**
 * From ElevatedVision ElevationLayer.js
 * Return the rectangle corresponding to the grid square at this point.
 * @param {x: number, y: number} p    Location within the square.
 * @returns {PIXI.Rectangle}
 */
function squareGridShape(p) {
  // Get the top left corner
  const [tlx, tly] = canvas.grid.grid.getTopLeft(p.x, p.y);
  const { w, h } = canvas.grid;
  return new PIXI.Rectangle(tlx, tly, w, h);
}

/**
 * From ElevatedVision ElevationLayer.js
 * Return the polygon corresponding to the grid hex at this point.
 * @param {x: number, y: number} p    Location within the square.
 * @returns {PIXI.Rectangle}
 */
function hexGridShape(p, { width = 1, height = 1 } = {}) {
  // Canvas.grid.grid.getBorderPolygon will return null if width !== height.
  if ( width !== height ) return null;

  // Get the top left corner
  const [tlx, tly] = canvas.grid.grid.getTopLeft(p.x, p.y);
  const points = canvas.grid.grid.getBorderPolygon(width, height, 0); // TO-DO: Should a border be included to improve calc?
  const pointsTranslated = [];
  const ln = points.length;
  for ( let i = 0; i < ln; i += 2) pointsTranslated.push(points[i] + tlx, points[i+1] + tly);
  return new PIXI.Polygon(pointsTranslated);
}

/**
 * Get the two points perpendicular to line A --> B at A, a given distance from the line A --> B
 * @param {PIXI.Point} A
 * @param {PIXI.Point} B
 * @param {number} distance
 * @returns {[PIXI.Point, PIXI.Point]} Points on either side of A.
 */
function perpendicularPoints(A, B, distance = 1) {
  const delta = B.subtract(A);
  const pt0 = new PIXI.Point(A.x - delta.y, A.y + delta.x);
  return [
    A.towardsPoint(pt0, distance),
    A.towardsPoint(pt0, -distance)
  ];
}

