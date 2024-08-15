/* globals
canvas,
CanvasAnimation,
CONFIG,
CONST,
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

import { SPEED, MODULE_ID, MODULES_ACTIVE, MOVEMENT_TYPES } from "./const.js";
import { Settings } from "./settings.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";
import {
  elevationFromWaypoint,
  originElevation,
  destinationElevation,
  terrainElevationAtLocation,
  terrainElevationForMovement,
  terrainPathForMovement,
  userElevationChangeAtWaypoint } from "./terrain_elevation.js";
import {
  _computeSegmentDistances,
  elevateSegments,
  calculatePathPointsForSegment,
  constructPathfindingSegments } from "./segments.js";
import { movementTypeForTokenAt } from "./token_hud.js";
import {
  distanceLabel,
  getPriorDistance,
  segmentElevationLabel,
  segmentTerrainLabel,
  segmentCombatLabel,
  levelNameAtElevation,
  highlightLineRectangle } from "./segment_labels_highlighting.js";
import { tokenSpeedSegmentSplitter } from "./token_speed.js";
import { log, roundMultiple } from "./util.js";
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

/* Ruler measure workflow
- Update destination
- _getMeasurementSegments
  --> Create new array of segments
  * ER assigns elevation value to each segment based on user increments: `elevateSegments`
  * ER either uses pathfinding or TM's region path to expand the segments

- _computeDistance
  --> iterates over each segment
  --> calculates totalDistance and totalCost by iterating over segments.
  --> uses `canvas.grid.measurePath` for each with the _getCostFunction
  --> calculates distance, cost, cumulative distance, and cumulative cost for each segment
  * ER uses `_computeSegmentDistances` to calculate 3d distance with move penalty
  * ER adds segment properties used for labeling
- _broadcastMeasurement
- _drawMeasuredPath
  --> Iterates over each segment, assigning a label to each using _getSegmentLabel
    * ER adds elevation and move penalty label information
- _highlightMeasurementSegments
  * ER splits the highlighting at move breaks if speed highlighting is set
*/

/* Elevation measurement

Each waypoint has added properties:
- _userElevationIncrements: Elevation shifts up or down at this point due to user input
- _terrainElevation: Ground/terrain elevation at this location, calculated as needed
- elevation: The calculated elevation of this waypoint, which is the previous waypoint elevation
  plus changes due to user increments, terrain

*/

// ----- NOTE: Ruler broadcasting ----- //

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
  myObj.totalDiagonals = this.totalDiagonals;
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
  this.totalDiagonals = myData.totalDiagonals;

  wrapper(data);

  if ( triggerMeasure ) {
    const ruler = canvas.controls.ruler;
    this.destination.x -= 1;
    ruler.measure(this.destination);
  }
}

/**
 * Mixed wrap Ruler#_broadcastMeasurement
 * For token ruler, don't broadcast the ruler if the token is invisible or disposition secret.
 */
function _broadcastMeasurement(wrapped) {
  // Update the local token elevation if using token ruler.
  if ( this._isTokenRuler && this.token?.hasPreview ) {
    const destination = this.segments.at(-1)?.ray.B;
    const previewToken = this.token._preview;
    if ( destination ) {
      const destElevation = CONFIG.GeometryLib.utils.pixelsToGridUnits(destination.z);
      const elevationChanged = previewToken.document.elevation !== destElevation;
      if ( elevationChanged && isFinite(destElevation) ) {
        previewToken.document.elevation = destElevation;
        previewToken.renderFlags.set({ "refreshTooltip": true })
      }
    }
  }

  // Don't broadcast invisible, hidden, or secret token movement when dragging.
  if ( this._isTokenRuler
    && this.token
    && (this.token.document.disposition === CONST.TOKEN_DISPOSITIONS.SECRET
     || this.token.document.hasStatusEffect(CONFIG.specialStatusEffects.INVISIBLE)
     || this.token.document.isHidden) ) return;

  wrapped();
}

// ----- NOTE: Waypoints, origin, destination ----- //

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
  waypoint.elevation = 0;

  // Determine the elevation up until this point
  const isOriginWaypoint = !this.waypoints.length;
  if ( isOriginWaypoint ) {
    waypoint._forceToGround = false;
    waypoint.elevation = this.token?.elevationE ?? terrainElevationAtLocation(point) ?? 0;
  } else {
    waypoint.elevation = elevationFromWaypoint(this.waypoints.at(-1), waypoint, this.token);
  }

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

// ----- NOTE: Segments ----- //

/**
 * Mixed wrap of  Ruler.prototype._getMeasurementSegments
 * Add elevation information to the segments.
 * Add pathfinding segments.
 * Add segments for traversing regions.
 */
function _getMeasurementSegments(wrapped) {
  // If not the user's ruler, segments calculated by original user and copied via socket.
  if ( this.user !== game.user ) {
    // Reconstruct labels if necessary.
    let labelIndex = 0;
    this.segments ??= [];
    for ( const s of this.segments ) {
      if ( !s.label ) continue; // Not every segment has a label.
      s.label = this.labels.children[labelIndex++];
    }
    return this.segments;
  }

  // No segments are present if dragging back to the origin point.
  const segments = wrapped();
  const segmentMap = this._pathfindingSegmentMap ??= new Map();
  if ( !segments.length ) {
    segmentMap.clear();
    return segments;
  }

  // Add z value (elevation in pixel units) to the segments.
  elevateSegments(this, segments);

  // If no movement token, then no region paths or pathfinding.
  const token = this.token;
  if ( !token ) return segments;

  const usePathfinding = Settings.get(Settings.KEYS.CONTROLS.PATHFINDING) ^ Settings.FORCE_TOGGLE_PATHFINDING;
  let pathPoints = [];
  const t0 = performance.now();
  const lastSegment = segments.at(-1);
  if ( usePathfinding ) {
    // If currently pathfinding, set path for the last segment, overriding any prior path.
    // Pathfinding when: the pathfinding icon is enabled or the temporary toggle key is held.
    // TODO: Pathfinding should account for region elevation changes and handle flying/burrowing.
    pathPoints = calculatePathPointsForSegment(lastSegment, token);

  } else if ( MODULES_ACTIVE.TERRAIN_MAPPER ){
    // Determine the region path.
    const ElevationHandler = MODULES_ACTIVE.API.TERRAIN_MAPPER.ElevationHandler;
    const { gridUnitsToPixels, pixelsToGridUnits } = CONFIG.GeometryLib.utils;
    const { A, B } = lastSegment.ray;
    const start = { ...A, elevation: pixelsToGridUnits(A.z) };
    const end = { ...B, elevation: pixelsToGridUnits(B.z) };
    const movementTypeStart = movementTypeForTokenAt(token, A);
    const endGround = terrainElevationAtLocation(end, end.elevation);
    const movementTypeEnd =  MOVEMENT_TYPES.forCurrentElevation(end.elevation, endGround);
    const flying = movementTypeStart === MOVEMENT_TYPES.FLY || movementTypeEnd === MOVEMENT_TYPES.FLY;
    const burrowing = movementTypeStart === MOVEMENT_TYPES.BURROW || movementTypeEnd === MOVEMENT_TYPES.BURROW;
    const pathPoints = ElevationHandler.constructPath(start, end, { flying, burrowing, token });
    pathPoints.forEach(pt => pt.z = gridUnitsToPixels(pt.elevation));
  }
  const t1 = performance.now();
  const key = `${lastSegment.ray.A.key}|${lastSegment.ray.B.key}`;
  if ( pathPoints.length > 2 ) {
    segmentMap.set(key, pathPoints);
    log(`_getMeasurementSegments|Found path with ${pathPoints.length} points in ${t1-t0} ms.`, pathPoints);
  } else segmentMap.delete(key);

  // For each segment, replace with path sub-segment if pathfinding or region paths were used for that segment.
  const t2 = performance.now();
  const newSegments = constructPathfindingSegments(segments, segmentMap);
  const t3 = performance.now();
  log(`_getMeasurementSegments|${newSegments.length} segments processed in ${t3-t2} ms.`);
  return newSegments;
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

  log("_computeDistance");

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
  let waypointDistance = 0;
  let waypointMoveDistance = 0;
  let currWaypointIdx = -1;
  for ( const segment of this.segments ) {
    if ( Object.hasOwn(segment, "waypointIdx") && segment.waypointIdx !== currWaypointIdx ) {
      currWaypointIdx = segment.waypointIdx;
      waypointDistance = 0;
      waypointMoveDistance = 0;
    }

    waypointDistance += segment.distance;
    waypointMoveDistance += segment.moveDistance;
    segment.waypointDistance = waypointDistance;
    segment.waypointMoveDistance = waypointMoveDistance;
    segment.waypointElevationIncrement = userElevationChangeAtWaypoint(this.waypoints[currWaypointIdx]);
  }
}

// ----- NOTE: Segment labeling and highlighting ----- //

/**
 * Wrap Ruler.prototype._getSegmentLabel
 * Add elevation information to the label
 */
function _getSegmentLabel(wrapped, segment, totalDistance) {
  if ( CONFIG[MODULE_ID].debug ) {
    if ( totalDistance >= 15 ) { console.debug("_getSegmentLabel: 15", segment, this); }
    if ( totalDistance > 30 ) { console.debug("_getSegmentLabel: 30", segment, this); }
    else if ( totalDistance > 60 ) { console.debug("_getSegmentLabel: 30", segment, this); }
  }

  // Force distance to be between waypoints instead of (possibly pathfinding) segments.
  const origSegmentDistance = segment.distance;
  segment.distance = distanceLabel(origSegmentDistance);
  const priorDistance = getPriorDistance(this.token);
  const combinePriorWithTotal = Settings.get(Settings.KEYS.SPEED_HIGHLIGHTING.COMBINE_PRIOR_WITH_TOTAL)
  this.totalDistance = distanceLabel(totalDistance) + ((combinePriorWithTotal && segment.first) ? priorDistance : 0);
  const origLabel = wrapped(segment, distanceLabel(totalDistance));
  segment.distance = origSegmentDistance;

  // Label for elevation changes.
  let elevLabel = segmentElevationLabel(this, segment);

  // Label for Levels floors.
  const levelName = levelNameAtElevation(CONFIG.GeometryLib.utils.pixelsToGridUnits(segment.ray.B.z));
  if ( levelName ) elevLabel += `\n${levelName}`;

  // Label for difficult terrain (variation in move distance vs distance).
  const terrainLabel = segmentTerrainLabel(segment);

  // Label when in combat and there are past moves.
  const combatLabel = (combinePriorWithTotal) ? "" : segmentCombatLabel(this.token, priorDistance);

  // Put it all together.
  let label = `${origLabel}`;
  if ( !Settings.get(Settings.KEYS.HIDE_ELEVATION) ) label += `\n${elevLabel}`;
  label += `${terrainLabel}${combatLabel}`;
  return label;
}

/**
 * Wrap Ruler.prototype._highlightMeasurementSegment
 * @param {RulerMeasurementSegment} segment
 */
const TOKEN_SPEED_SPLITTER = new WeakMap();

function _highlightMeasurementSegment(wrapped, segment) {
  // Temporarily override cached ray.distance such that the ray distance is two-dimensional,
  // so highlighting selects correct squares.
  // Otherwise the highlighting algorithm can get confused for high-elevation segments.
  segment.ray._distance = PIXI.Point.distanceBetween(segment.ray.A, segment.ray.B);

  // Adjust the color if this user has selected speed highlighting.
  // Highlight each split in turn, changing highlight color each time.
  if ( Settings.useSpeedHighlighting(this.token) ) {
    if ( segment.first ) TOKEN_SPEED_SPLITTER.set(this.token, tokenSpeedSegmentSplitter(this, this.token))
    const splitterFn = TOKEN_SPEED_SPLITTER.get(this.token);
    if ( splitterFn ) {
      const priorColor = this.color;
      const segments = splitterFn(segment);
      if ( segments.length ) {
        for ( const segment of segments ) {
          this.color = segment.speed.color;
          segment.ray._distance = PIXI.Point.distanceBetween(segment.ray.A, segment.ray.B);
          wrapped(segment);

          // If gridless, highlight a rectangular shaped portion of the line.
          if ( canvas.grid.isGridless ) highlightLineRectangle(segment, this.color, this.name);
        }
        // Reset to the default color.
        this.color = priorColor;
        return;
      }
    }
  }

  wrapped(segment);
  segment.ray._distance = undefined; // Reset the distance measurement.
}


// ----- NOTE: Token movement ----- //

/**
 * Mixed wrap Ruler.prototype._animateMovement
 * Add additional controlled tokens to the move, if permitted.
 */
async function _animateMovement(wrapped, token) {
  if ( !this.segments || !this.segments.length ) return; // Ruler._animateMovement expects at least one segment.

  if ( CONFIG[MODULE_ID].debug ) {
    console.groupCollapsed(`${MODULE_ID}|_animateMovement`);
    log(`Moving ${token.name} ${this.segments.length} segments.`, [...this.segments]);
    console.table(this.segments.flatMap(s => {
      const A = { ...s.ray.A };
      const B = { ...s.ray.B };
      B.distance = s.distance;
      B.moveDistance = s.moveDistance;
      return [A, B];
    }));
    console.groupEnd(`${MODULE_ID}|_animateMovement`);
  }

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
 * Override Ruler.prototype._animateSegment
 * When moving the token along the segments, update the token elevation to the destination + increment
 * for the given segment.
 * Mark the token update if pathfinding for this segment.
 */
async function _animateSegment(token, segment, destination) {
  log(`Updating ${token.name} destination from ({${token.document.x},${token.document.y}) to (${destination.x},${destination.y}) for segment (${segment.ray.A.x},${segment.ray.A.y})|(${segment.ray.B.x},${segment.ray.B.y})`);

  // If the segment is teleporting and the segment destination is not a waypoint or ruler destination, skip.
  // Doesn't work because _animateMovement stops the movement if the token does not make it to the
  // next waypoint.
//   if ( segment.teleport
//     && !(segment.B.x === this.destination.x && segment.B.y === this.destination.y )
//     && !this.waypoints.some(w => segment.B.x === w.x && segment.B.y === w.y) ) return;

  // Update elevation before the token move.
  // Only update drop to ground and user increment changes.
  // Leave the rest to region elevation from Terrain Mapper or other modules.
  // const waypoint = this.waypoints[segment.waypointIdx];
  // const newElevation = waypoint.elevation;
  // if ( isFinite(newElevation) && token.elevationE !== newElevation ) await token.document.update({ elevation: newElevation })

  let name;
  if ( segment.animation?.name === undefined ) name = token.animationName;
  else name ||= Symbol(token.animationName);
  const updateOptions = {
    // terrainmapper: { usePath: false },
    rulerSegment: this.segments.length > 1,
    firstRulerSegment: segment.first,
    lastRulerSegment: segment.last,
    rulerSegmentOrigin: segment.ray.A,
    rulerSegmentDestination: segment.ray.B,
    teleport: segment.teleport,
    animation: {...segment.animation, name}
  }
  const {x, y} = token.document._source;
  await token.animate({x, y}, {name, duration: 0});
  await token.document.update(destination, updateOptions);
  await CanvasAnimation.getAnimation(name)?.promise;
  const newElevation = roundMultiple(CONFIG.GeometryLib.utils.pixelsToGridUnits(segment.ray.B.z));
  if ( isFinite(newElevation) && token.elevationE !== newElevation ) await token.document.update({ elevation: newElevation })
}



// ----- NOTE: Event handling ----- //

/**
 * Wrap Ruler.prototype.clear
 * Delete the move penalty instance
 */
function clear(wrapper) {
  log("-----Clearing movePenaltyInstance-----");
  delete this._movePenaltyInstance;
  return wrapper();
}

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


// ----- NOTE: New methods ----- //

/**
 * Add Ruler.prototype.incrementElevation
 * Increase the elevation at the current ruler waypoint by one grid unit.
 */
function incrementElevation() {
  const ruler = this;
  if ( !ruler || !ruler.active ) return;

  // Increment the elevation at the last waypoint.
  log("incrementElevation");
  const waypoint = this.waypoints.at(-1);
  waypoint._userElevationIncrements ??= 0;
  waypoint._userElevationIncrements += 1;

  // Update the ruler display (will also broadcast the measurement)
  ruler.measure(this.destination, { force: true });
}

/**
 * Add Ruler.prototype.decrementElevation
 * Decrease the elevation at the current ruler waypoint by one grid unit.
 */
function decrementElevation() {
  const ruler = this;
  if ( !ruler || !ruler.active ) return;

  // Decrement the elevation at the last waypoint.
  log("decrementElevation");
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

PATCHES.BASIC.WRAPS = {
  clear,
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
  userElevationChangeAtWaypoint,
  terrainElevationAtLocation,
  terrainElevationForMovement,
  terrainPathForMovement,
  elevationFromWaypoint,
  measureDistance: PhysicalDistance.measure.bind(PhysicalDistance),
  measureMoveDistance: MoveDistance.measure.bind(MoveDistance)
};



