/* globals
canvas,
CanvasAnimation,
CONFIG,
CONST,
foundry,
game,
PIXI
*/
"use strict";

import { SPEED, MODULE_ID, MODULES_ACTIVE } from "./const.js";
import { Settings } from "./settings.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";
import { perpendicularPoints, log, segmentBounds } from "./util.js";
import { Pathfinder } from "./pathfinding/pathfinding.js";
import { BorderEdge } from "./pathfinding/BorderTriangle.js";
import { SCENE_GRAPH } from "./pathfinding/WallTracer.js";
import { elevationAtWaypoint } from "./terrain_elevation.js";

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
    this.segments ??= [];
    for ( const s of this.segments ) {
      if ( !s.label ) continue; // Not every segment has a label.
      s.label = this.labels.children[labelIndex++];
    }
    return this.segments;
  }

  // Elevate the segments
  const segments = elevateSegments(this, wrapped()) ?? [];
  const token = this._getMovementToken();

  // If no movement token, then no pathfinding.
  if ( !token ) return segments;

  // If no segments present, clear the path map and return.
  // No segments are present if dragging back to the origin point.
  const segmentMap = this._pathfindingSegmentMap ??= new Map();
  if ( !segments.length ) {
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

  // If no collision present, no pathfinding required.
  const tC = performance.now();
  if ( !hasCollision(A, B, token) ) {
    const tEnd = performance.now();
    log(`Determined no collision for ${Pathfinder.triangleEdges.size} edges in ${tEnd - tC} ms.`);
    return [];
  }
  const tEnd = performance.now();
  log(`Found collision for ${Pathfinder.triangleEdges.size} edges in ${tEnd - tC} ms.`);

  // Find path between last waypoint and destination.
  const t0 = performance.now();
  token[MODULE_ID] ??= {};
  const pf = token[MODULE_ID].pathfinder ??= new Pathfinder(token);
  const path = pf.runPath(A, B);
  let pathPoints = Pathfinder.getPathPoints(path);
  const t1 = performance.now();
  log(`Found ${pathPoints.length} path points between ${A.x},${A.y} -> ${B.x},${B.y} in ${t1 - t0} ms.`, pathPoints);

  // Clean the path
  const t2 = performance.now();
  pathPoints = Pathfinder.cleanPath(pathPoints);
  const t3 = performance.now();
  log(`Cleaned to ${pathPoints?.length} path points between ${A.x},${A.y} -> ${B.x},${B.y} in ${t3 - t2} ms.`, pathPoints);

  // If less than 3 points after cleaning, just use the original segment.
  if ( pathPoints.length < 2 ) {
    log(`Only ${pathPoints.length} path points found.`, [...pathPoints]);
    return [];
  }

  return pathPoints;
}

/**
 * Instead of a typical `token.checkCollision` test, test for collisions against the edge graph.
 * With this approach, collisions with enemy tokens trigger pathfinding.
 * @param {PIXI.Point} A          Origin point for the move
 * @param {PIXI.Point} B          Destination point for the move
 * @param {Token} token           Token that is moving
 * @returns {boolean}
 */
function hasCollision(A, B, token) {
  BorderEdge.moveToken = token; // Set the token so we can test token edge blocking.
  const lineSegmentIntersects = foundry.utils.lineSegmentIntersects;

  // SCENE_GRAPH has way less edges than Pathfinder and has quadtree for the edges.
  const edges = SCENE_GRAPH.edgesQuadtree.getObjects(segmentBounds(A, B));
  const tokenBlockType = Settings._tokenBlockType();
  return edges.some(edge => lineSegmentIntersects(A, B, edge.A, edge.B)
    && edge.edgeBlocks(A, token, tokenBlockType));
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
    prevPt.z = segment.ray.A.z;
    for ( let i = 1; i < nPoints; i += 1 ) {
      const currPt = pathPoints[i];
      currPt.z = A.z;
      const newSegment = { ray: new Ray3d(prevPt, currPt) };
      newSegment.ray.pathfinding = true; // Used by  canvas.grid.grid._getRulerDestination.
      newSegments.push(newSegment);
      prevPt = currPt;
    }

    const lastPathSegment = newSegments.at(-1);
    if ( lastPathSegment ) {
      lastPathSegment.ray.B.z = B.z;
      lastPathSegment.label = segment.label;
      lastPathSegment.ray.pathfinding = false;
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
  const {
    newSegmentDistance,
    newMoveDistance,
    newTotalDistance } = _getDistanceLabels(segment.waypointDistance, segment.waypointMoveDistance, totalDistance);
  segment.distance = newSegmentDistance;
  const origLabel = wrapped(segment, newTotalDistance);
  segment.distance = origSegmentDistance;
  let elevLabel = segmentElevationLabel(segment);
  const levelName = levelNameAtElevation(CONFIG.GeometryLib.utils.pixelsToGridUnits(segment.ray.B.z));
  if ( levelName ) elevLabel += `\n${levelName}`;

  let moveLabel = "";
  const units = (canvas.scene.grid.units) ? ` ${canvas.scene.grid.units}` : "";
  if ( segment.waypointDistance !== segment.waypointMoveDistance ) {
    if ( CONFIG[MODULE_ID].SPEED.useFontAwesome ) {
      const style = segment.label.style;
      if ( !style.fontFamily.includes("fontAwesome") ) style.fontFamily += ",fontAwesome"
      moveLabel = `\n${CONFIG[MODULE_ID].SPEED.terrainSymbol} ${newMoveDistance}${units}`;
      // moveLabel = `\n \uf0e7 ${newMoveDistance}${units}`;
    } else moveLabel = `\n${CONFIG[MODULE_ID].SPEED.terrainSymbol} ${newMoveDistance}${units}`;
  }

  return `${origLabel}\n${elevLabel}${moveLabel}`;
}

/**
 * Return modified segment and total distance labels
 * @param {number} segmentDistance
 * @param {number} segmentMoveDistance
 * @param {number} totalDistance
 * @returns {object}
 */
export function _getDistanceLabels(segmentDistance, moveDistance, totalDistance) {
  const multiple = Settings.get(Settings.KEYS.TOKEN_RULER.ROUND_TO_MULTIPLE) || null;
  if (canvas.grid.type !== CONST.GRID_TYPES.GRIDLESS || !multiple) return {
    newSegmentDistance: segmentDistance,
    newMoveDistance: Number(moveDistance.toFixed(2)),
    newTotalDistance: totalDistance
  };

  const newSegmentDistance = segmentDistance.toNearest(multiple);
  const newMoveDistance = moveDistance.toNearest(multiple);
  const newTotalDistance = totalDistance.toNearest(multiple);

  return { newSegmentDistance, newMoveDistance, newTotalDistance };
}

/**
 * Mixed wrap Ruler.prototype._animateSegment
 * When moving the token along the segments, update the token elevation to the destination + increment
 * for the given segment.
 * Mark the token update if pathfinding for this segment.
 */
export async function _animateSegment(wrapped, token, segment, destination) {
  // If the token is already at the destination, _animateSegment will throw an error when the animation is undefined.
  // This can happen when setting artificial segments for highlighting or pathfinding.
  if ( token.document.x !== destination.x
    || token.document.y !== destination.y ) {
    // Same as wrapped but pass an option.
    await token.document.update(destination, {
      rulerSegment: this.segments.length > 1,
      firstRulerSegment: segment.first,
      lastRulerSegment: segment.last
    });
    const anim = CanvasAnimation.getAnimation(token.animationName);
    await anim.promise;
  }

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
 * Take 2d segments and make 3d.
 * @param {Ruler} ruler
 * @param {object[]} segments
 */
function elevateSegments(ruler, segments) {  // Add destination as the final waypoint
  const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;

  // Add destination as the final waypoint
  ruler.destination._terrainElevation = ruler.elevationAtLocation(ruler.destination);
  ruler.destination._userElevationIncrements = ruler._userElevationIncrements ?? 0;
  const waypoints = ruler.waypoints.concat([ruler.destination]);

  log(`Destination ${ruler.destination} terrainElevation: ${ruler.destination._terrainElevation} increments: ${ruler.destination._userElevationIncrements}`);

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
  if ( !MODULES_ACTIVE.LEVELS ) return false;
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
  let label = `${segmentArrow}${Math.abs(Number(CONFIG.GeometryLib.utils.pixelsToGridUnits(increment).toFixed(1)))} ${units}`;
  label += ` [@${Number(CONFIG.GeometryLib.utils.pixelsToGridUnits(Bz).toFixed(1))} ${units}]`;

  return label;
}
