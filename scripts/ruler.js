/* globals
canvas,
Color,
CONST,
game,
getProperty,
Ray,
ui
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

import { SPEED } from "./const.js";

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
    pastDistance += s.distance;
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
  const walkSegments = splitSegment(remainingSegment, pastDistance, walkDist);
  if ( walkSegments.length ) {
    const segment0 = walkSegments[0];
    splitSegments.push(segment0);
    pastDistance += segment0.distance;
    remainingSegment = walkSegments.length > 1 ? walkSegments[1] : undefined;
  }

  // Dash
  if ( remainingSegment ) {
    remainingSegment.color = dashColor;
    const dashSegments = splitSegment(remainingSegment, pastDistance, dashDist);
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
function splitSegment(segment, pastDistance, cutoffDistance) {
  // Split the segment early so that the second segment has both squares highlighted.
  //const spacer = canvas.scene.grid.type === CONST.GRID_TYPES.SQUARE ? 1.41 : 1;
  // cutoffDistance -= spacer * 0.5;

  // If the cutoffDistance does not fall within the segment we are done.
  cutoffDistance -= pastDistance;
  if ( cutoffDistance <= 0 ) return [];
  if ( segment.distance <= cutoffDistance ) return [segment];

  // Split the segment into two.
  // TODO: Handle 3d segments.
  const t = cutoffDistance / segment.distance;
  const segment0 = { ray: new Ray(segment.ray.A, segment.ray.project(t)), color: segment.color };
  const segment1 = { ray: new Ray(segment0.ray.B, segment.ray.B) };
  const segments = [segment0, segment1];
  const distances = canvas.grid.measureDistances(segments, { gridSpaces: false });
  segment0.distance = distances[0];
  segment1.distance = distances[1];
  return segments;
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
  _animateMovement,
  _highlightMeasurementSegment
  // _postMove
};

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
