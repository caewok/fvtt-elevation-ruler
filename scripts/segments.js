/* globals
canvas,
CONFIG,
CONST,
game,
PIXI
*/
"use strict";

import { SPEED, MODULES_ACTIVE, MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { perpendicularPoints, log } from "./util.js";
import { Pathfinder } from "./pathfinding/pathfinding.js";

/**
 * Calculate the elevation for a given waypoint.
 * Terrain elevation + user increment
 * @param {object} waypoint
 * @returns {number}
 */
export function elevationAtWaypoint(waypoint) {
  return waypoint._terrainElevation + (waypoint._userElevationIncrements * canvas.dimensions.distance);
}

/**
 * Mixed wrap of  Ruler.prototype._getMeasurementSegments
 * Add elevation information to the segments.
 * Add pathfinding segments.
 */
export function _getMeasurementSegments(wrapped) {
  // If not the user's ruler, segments calculated by original user and copied via socket.
  if ( this.user !== game.user ) {
    // Reconstruct labels if necessary.
    let labelIndex = 0;
    for ( const s of this.segments ) {
      if ( !s.label ) continue; // Not every segment has a label.
      s.label = this.labels.children[labelIndex++];
    }
    return this.segments;
  }

  // Elevate the segments
  const segments = elevateSegments(this, wrapped());
  const token = this._getMovementToken();

  // If no movement token, then no pathfinding.
  if ( !token ) return segments;

  // If no segments present, clear the path map and return.
  // No segments are present if dragging back to the origin point.
  const segmentMap = this._pathfindingSegmentMap ??= new Map();
  if ( !segments || !segments.length ) {
    segmentMap.clear();
    return segments;
  }

  // If currently pathfinding, set path for the last segment, overriding any prior path.
  const lastSegment = segments.at(-1);
  const pathPoints = Settings.get(Settings.KEYS.CONTROLS.PATHFINDING)
    ? calculatePathPointsForSegment(lastSegment, token)
    : [];
  if ( pathPoints.length > 2 ) segmentMap.set(lastSegment.ray.A.to2d().key, pathPoints);
  else segmentMap.delete(lastSegment.ray.A.to2d().key);

  // For each segment, replace with path sub-segment if pathfinding was used for that segment.
  const t2 = performance.now();
  const newSegments = constructPathfindingSegments(segments, segmentMap);
  const t3 = performance.now();
  log(`${newSegments.length} segments processed in ${t3-t2} ms.`);
  return newSegments;
}

/**
 * Calculate a path to get from points A to B on the segment.
 * @param {RulerMeasurementSegment} segment
 * @returns {PIXI.Point[]}
 */
function calculatePathPointsForSegment(segment, token) {
  const { A, B } = segment.ray;
  if ( !token.checkCollision(B, { origin: A, type: "move", mode: "any" }) ) return [];

  // Find path between last waypoint and destination.
  const t0 = performance.now();
  token[MODULE_ID] ??= {};
  const pf = token[MODULE_ID].pathfinder ??= new Pathfinder(token);
  const path = pf.runPath(A, B);
  let pathPoints = Pathfinder.getPathPoints(path);
  const t1 = performance.now();
  log(`Found ${pathPoints.length} path points between ${A.x},${A.y} -> ${B.x},${B.y} in ${t1 - t0} ms.`);

  // Clean the path
  const t2 = performance.now();
  pathPoints = Pathfinder.cleanPath(pathPoints);
  const t3 = performance.now();
  log(`Cleaned to ${pathPoints?.length} path points between ${A.x},${A.y} -> ${B.x},${B.y} in ${t3 - t2} ms.`);

  // If less than 3 points after cleaning, just use the original segment.
  if ( pathPoints.length < 2 ) {
    log(`Only ${pathPoints.length} path points found.`, [...pathPoints]);
    return [];
  }

  return pathPoints;
}

/**
 * Check provided array of segments against stored path points.
 * For each segment with pathfinding points, replace the segment with sub-segments
 * between each pathfinding point.
 * @param {RulerMeasurementSegment[]} segments
 * @returns {RulerMeasurementSegment[]} Updated segment array
 */
function constructPathfindingSegments(segments, segmentMap) {
  // For each segment, check the map for pathfinding points.
  // If any, replace segment with the points.
  // Make sure to keep the label for the last segment piece only
  if ( !segmentMap.size ) return segments;
  const newSegments = [];
  for ( const segment of segments ) {
    const { A, B } = segment.ray;
    const pathPoints = segmentMap.get(A.to2d().key);
    if ( !pathPoints ) {
      newSegments.push(segment);
      continue;
    }

    const nPoints = pathPoints.length;
    let prevPt = pathPoints[0];
    prevPt.z = segment.ray.A.z; // TODO: Handle 3d in path points?
    for ( let i = 1; i < nPoints; i += 1 ) {
      const currPt = pathPoints[i];
      currPt.z = A.z;
      newSegments.push({ ray: new Ray3d(prevPt, currPt) });
      prevPt = currPt;
    }

    const lastPathSegment = newSegments.at(-1);
    if ( lastPathSegment ) {
      lastPathSegment.ray.B.z = B.z;
      lastPathSegment.label = segment.label;
    }
  }
  return newSegments;
}

/**
 * Wrap Ruler.prototype._getSegmentLabel
 * Add elevation information to the label
 */
export function _getSegmentLabel(wrapped, segment, totalDistance) {
  // Force distance to be between waypoints instead of (possibly pathfinding) segments.
  const origSegmentDistance = segment.distance;
  segment.distance = segment.waypointDistance;
  const orig_label = wrapped(segment, totalDistance);
  segment.distance = origSegmentDistance;
  let elevation_label = segmentElevationLabel(segment);
  const level_name = levelNameAtElevation(CONFIG.GeometryLib.utils.pixelsToGridUnits(segment.ray.B.z));
  if ( level_name ) elevation_label += `\n${level_name}`;
  return `${orig_label}\n${elevation_label}`;
}

/**
 * Wrap Ruler.prototype._animateSegment
 * When moving the token along the segments, update the token elevation to the destination + increment
 * for the given segment.
 */
export async function _animateSegment(wrapped, token, segment, destination) {
  // If the token is already at the destination, _animateSegment will throw an error when the animation is undefined.
  // This can happen when setting artificial segments for highlighting or pathfinding.
  if ( token.document.x !== destination.x
    || token.document.y !== destination.y ) await wrapped(token, segment, destination);

  // Update elevation after the token move.
  if ( segment.ray.A.z !== segment.ray.B.z ) {
    const elevation = CONFIG.GeometryLib.utils.pixelsToGridUnits(segment.ray.B.z);
    await token.document.update({ elevation });
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
export function hasSegmentCollision(token, segments) {
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

// ----- NOTE: Segment highlighting ----- //
/**
 * Wrap Ruler.prototype._highlightMeasurementSegment
 */
export function _highlightMeasurementSegment(wrapped, segment) {
  if ( !(this.user === game.user
      && Settings.get(Settings.KEYS.TOKEN_RULER.SPEED_HIGHLIGHTING)) ) return wrapped(segment);

  const token = this._getMovementToken();
  if ( !token ) return wrapped(segment);

  // Highlight each split in turn, changing highlight color each time.
  const priorColor = this.color;
  this.color = SPEED.COLORS[segment.speed];
  wrapped(segment);

  // If gridless, highlight a rectangular shaped portion of the line.
  if ( canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ) {
    const { A, B } = segment.ray;
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

  // Reset to the default color.
  this.color = priorColor;
}

/**
 * Modify distance by terrain mapper adjustment for token speed.
 * @param {RulerMeasurementSegment}   segment
 * @param {Token} token               Token to use
 * @param {boolean} gridless          Passed to Ruler.measureDistance if segment distance not defined.
 * @returns {number} Modified distance
 */
export function modifiedMoveDistance(segment, token, gridless = false) {
  if ( !token ) return segment.distance;
  const ray = segment.ray;
  segment.distance ??= this.measureDistance(ray.A, ray.B, gridless);
  const terrainMult = 1 / (terrainMoveMultiplier(ray, token) || 1); // Invert because moveMult is < 1 if speed is penalized.
  const tokenMult = terrainTokenMoveMultiplier(ray, token);
  const moveMult = terrainMult * tokenMult;
  return segment.distance * moveMult;
}

/**
 * Get speed multiplier for terrain mapper along a given ray.
 * @param {number} distance   Distance of the ray
 * @param {Ray|Ray3d} ray     Ray to measure
 * @param {Token} token       Token to use
 * @returns {number} Modified distance
 */
function terrainMoveMultiplier(ray, token) {
  if ( !MODULES_ACTIVE.TERRAIN_MAPPER || !token ) return 1;
  const terrainAPI = game.modules.get("terrainmapper").api;
  return terrainAPI.Terrain.percentMovementForTokenAlongPath(token, ray.A, ray.B);
}

/**
 * Get speed multiplier for tokens along a given ray.
 * @param {number} distance   Distance of the ray
 * @param {Ray|Ray3d} ray     Ray to measure
 * @param {Token} token       Token to use
 */
function terrainTokenMoveMultiplier(ray, token) {
  const mult = Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER);
  if ( mult === 1 ) return 1;

  // Find tokens along the ray whose constrained borders intersect the ray.
  const { A, B } = ray;
  const collisionTest = o => o.t.constrainedTokenBorder.lineSegmentIntersects(A, B, { inside: true });
  const tokens = canvas.tokens.quadtree.getObjects(ray.bounds, { collisionTest });
  tokens.delete(token);
  if ( !tokens.size ) return 1;

  // Determine the percentage of the ray that intersects the constrained token shapes.
  const tValues = [];
  const deltaMag = B.to2d().subtract(A).magnitude();
  for ( const t of tokens ) {
    const border = t.constrainedTokenBorder;
    let inside = false;
    if ( border.contains(A) ) {
      inside = true;
      tValues.push({ t: 0, inside });
    }

    // At each intersection, we switch between inside and outside.
    const ixs = border.segmentIntersections(A, B); // Can we assume the ixs are sorted by t0?

    // See Foundry issue #10336. Don't trust the t0 values.
    ixs.forEach(ix => {
      // See PIXI.Point.prototype.towardsPoint
      const distance = PIXI.Point.distanceBetween(A, ix);
      ix.t0 = distance / deltaMag;
    });
    ixs.sort((a, b) => a.t0 - b.t0);

    ixs.forEach(ix => {
      inside ^= true;
      tValues.push({ t: ix.t0, inside });
    });
  }

  // Sort tValues and calculate distance between inside start/end.
  // May be multiple inside/outside entries.
  tValues.sort((a, b) => a.t0 - b.t0);
  let nInside = 0;
  let prevT = undefined;
  let distInside = 0;
  for ( const tValue of tValues ) {
    if ( tValue.inside ) {
      nInside += 1;
      prevT ??= tValue.t; // Store only the first t to take us inside.
    } else if ( nInside > 2 ) nInside -= 1;
    else if ( nInside === 1 ) { // Inside is false and we are now outside.
      const startPt = ray.project(prevT);
      const endPt = ray.project(tValue.t);
      distInside += Point3d.distanceBetween(startPt, endPt);
      nInside = 0;
      prevT = undefined;
    }
  }

  // If still inside, we can go all the way to t = 1
  if ( nInside > 0 ) {
    const startPt = ray.project(prevT);
    distInside += Point3d.distanceBetween(startPt, B);
  }

  if ( !distInside ) return 1;

  const totalDistance = ray.distance;
  return ((totalDistance - distInside) + (distInside * mult)) / totalDistance;
}

/**
 * Modify dist


/**
 * Take 2d segments and make 3d.
 * @param {Ruler} ruler
 * @param {object[]} segments
 */
function elevateSegments(ruler, segments) {  // Add destination as the final waypoint
  const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;

  // Add destination as the final waypoint
  ruler.destination._terrainElevation = ruler.terrainElevationAtDestination();
  ruler.destination._userElevationIncrements = ruler._userElevationIncrements;
  const waypoints = ruler.waypoints.concat([ruler.destination]);

  // Add the waypoint elevations to the corresponding segment endpoints.
  // Skip the first waypoint, which will (likely) end up as p0.
  const ln = waypoints.length;
  for ( let i = 1, j = 0; i < ln; i += 1, j += 1 ) {
    const segment = segments[j];
    const p0 = waypoints[i - 1];
    const p1 = waypoints[i];
    const dist2 = PIXI.Point.distanceSquaredBetween(p0, p1);
    if ( dist2 < 100 ) { // 10 ^ 2, from _getMeasurementSegments
      j -= 1; // Stay on this segment and skip this waypoint
      continue;
    }

    // Convert to 3d Rays
    const Az = gridUnitsToPixels(elevationAtWaypoint(p0));
    const Bz = gridUnitsToPixels(elevationAtWaypoint(p1));
    segment.ray = Ray3d.from2d(segment.ray, { Az, Bz });
  }

  return segments;
}


/**
 * Should Levels floor labels be used?
 * @returns {boolean}
 */
function useLevelsLabels() {
  if ( !game.modules.get("levels")?.active ) return false;

  const labelOpt = Settings.get(Settings.KEYS.USE_LEVELS_LABEL);
  return labelOpt === Settings.KEYS.LEVELS_LABELS.ALWAYS
    || (labelOpt === Settings.KEYS.LEVELS_LABELS.UI_ONLY && CONFIG.Levels.UI.rendered);
}

/**
 * Find the name of the level, if any, at a given elevation.
 * @param {number} e    Elevation to use.
 * @returns First elevation found that is named and has e within its range.
 */
function levelNameAtElevation(e) {
  if ( !useLevelsLabels() ) return undefined;
  const sceneLevels = canvas.scene.getFlag("levels", "sceneLevels"); // Array with [0]: bottom; [1]: top; [2]: name
  if ( !sceneLevels ) return undefined;

  // Just get the first labeled
  const lvl = sceneLevels.find(arr => arr[2] !== "" && e >= arr[0] && e <= arr[1]);
  return lvl ? lvl[2] : undefined;
}

/*
 * Construct a label to represent elevation changes in the ruler.
 * Waypoint version: 10 ft↑ [@10 ft]
 * Total version: 10 ft↑ [@20 ft]
 * @param {object} s  Ruler segment
 * @return {string}
 */
function segmentElevationLabel(s) {
  const units = canvas.scene.grid.units;
  const increment = s.ray.dz;
  const Bz = s.ray.B.z;

  const segmentArrow = (increment > 0) ? "↑"
    : (increment < 0) ? "↓" : "↕";

  // Take absolute value b/c segmentArrow will represent direction
  // Allow decimals to tenths ( Math.round(x * 10) / 10).
  let label = `${segmentArrow}${Math.abs(Math.round(CONFIG.GeometryLib.utils.pixelsToGridUnits(increment) * 10) / 10)} ${units}`;
  label += ` [@${Math.round(CONFIG.GeometryLib.utils.pixelsToGridUnits(Bz) * 10) / 10} ${units}]`;

  return label;
}
