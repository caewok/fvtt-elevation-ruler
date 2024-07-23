/* globals
canvas,
CanvasAnimation,
CONFIG,
CONST,
game,
PIXI,
Ruler
*/
"use strict";

import { MODULE_ID, MODULES_ACTIVE } from "./const.js";
import { Settings } from "./settings.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { perpendicularPoints, log  } from "./util.js";
import { Pathfinder, hasCollision } from "./pathfinding/pathfinding.js";
import { userElevationChangeAtWaypoint, elevationFromWaypoint, groundElevationAtWaypoint } from "./terrain_elevation.js";
import { MovePenalty } from "./MovePenalty.js";
import { tokenSpeedSegmentSplitter } from "./token_speed.js";

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
  const segments = elevateSegments(this, wrapped());
  const token = this.token;

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
  // Pathfinding when: the pathfinding icon is enabled or the temporary toggle key is held.
  const lastSegment = segments.at(-1);
  const pathPoints = (Settings.get(Settings.KEYS.CONTROLS.PATHFINDING) ^ Settings.FORCE_TOGGLE_PATHFINDING)
    ? calculatePathPointsForSegment(lastSegment, token)
    : [];

  const lastA = PIXI.Point.fromObject(lastSegment.ray.A); // Want 2d version.
  if ( pathPoints.length > 2 ) segmentMap.set(lastA.key, pathPoints);
  else segmentMap.delete(lastA.key);

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
  const A = Point3d.fromObject(segment.ray.A);
  const B = Point3d.fromObject(segment.ray.B);

  // If no collision present, no pathfinding required.
  const tC = performance.now();
  if ( !hasCollision(A, B, token)
    && !(CONFIG[MODULE_ID].pathfindingCheckTerrains && MovePenalty.anyTerrainPlaceablesAlongSegment(A, B, token)) ) {
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
  pathPoints = pf.cleanPath(pathPoints);
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
    const A = Point3d.fromObject(segment.ray.A);
    const B = Point3d.fromObject(segment.ray.B);
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
      newSegment.ray.pathfinding = true; // TODO: Was used by  canvas.grid.grid._getRulerDestination.
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

  if ( CONFIG[MODULE_ID].debug ) {
    if ( totalDistance >= 15 ) { console.debug("_getSegmentLabel: 15", segment, this); }
    if ( totalDistance > 30 ) { console.debug("_getSegmentLabel: 30", segment, this); }
    else if ( totalDistance > 60 ) { console.debug("_getSegmentLabel: 30", segment, this); }
  }

  let moveLabel = "";
  const units = (canvas.scene.grid.units) ? ` ${canvas.scene.grid.units}` : "";
  if ( segment.waypointDistance !== segment.waypointMoveDistance ) {
    if ( CONFIG[MODULE_ID].SPEED.useFontAwesome ) {
      const style = segment.label.style;
      if ( !style.fontFamily.includes("fontAwesome") ) style.fontFamily += ",fontAwesome";
      moveLabel = `\n${CONFIG[MODULE_ID].SPEED.terrainSymbol} ${newMoveDistance}${units}`;
    } else moveLabel = `\n${CONFIG[MODULE_ID].SPEED.terrainSymbol} ${newMoveDistance}${units}`;
  }

  let combatLabel = "";
  if ( game.combat?.started && Settings.get(Settings.KEYS.SPEED_HIGHLIGHTING.COMBAT_HISTORY) ) {
    const multiple = Settings.get(Settings.KEYS.TOKEN_RULER.ROUND_TO_MULTIPLE) || 1;
    const pastMoveDistance = this.token?.lastMoveDistance;
    if ( pastMoveDistance ) combatLabel = `\nPrior: ${pastMoveDistance.toNearest(multiple)}${units}`;
  }

  let label = `${origLabel}`;
  if ( !Settings.get(Settings.KEYS.HIDE_ELEVATION) ) {
    label += `\n${elevLabel}`;
  }
  label += `${moveLabel}${combatLabel}`;

  return label;
}

/**
 * Return modified segment and total distance labels
 * @param {number} segmentDistance
 * @param {number} segmentMoveDistance
 * @param {number} totalDistance
 * @returns {object}
 */
export function _getDistanceLabels(segmentDistance, moveDistance, totalDistance) {
  const multiple = Settings.get(Settings.KEYS.TOKEN_RULER.ROUND_TO_MULTIPLE) || 1;
  if ( canvas.grid.type !== CONST.GRID_TYPES.GRIDLESS ) return {
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
 * Override Ruler.prototype._animateSegment
 * When moving the token along the segments, update the token elevation to the destination + increment
 * for the given segment.
 * Mark the token update if pathfinding for this segment.
 */
export async function _animateSegment(token, segment, destination) {
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
  const waypoint = this.waypoints[segment.waypointIdx];
  const newElevation = (waypoint._forceToGround ? groundElevationAtWaypoint(waypoint) : token.elevationE)
    + userElevationChangeAtWaypoint(waypoint);
  if ( isFinite(newElevation) && token.elevationE !== newElevation ) await token.document.update({ elevation: newElevation })

  let name;
  if ( segment.animation?.name === undefined ) name = token.animationName;
  else name ||= Symbol(token.animationName);
  const updateOptions = {
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
}

// ----- NOTE: Segment highlighting ----- //

const TOKEN_SPEED_SPLITTER = new WeakMap();

/**
 * Wrap Ruler.prototype._highlightMeasurementSegment
 * @param {RulerMeasurementSegment} segment
 */
export function _highlightMeasurementSegment(wrapped, segment) {
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

/**
 * Highlight a rectangular shaped portion of the line.
 * For use on gridless maps where ruler does not highlight.
 * @param {RulerMeasurementSegment} segment
 * @param {Color} color   Color to use
 * @param {string} name   Name of the ruler for tracking the highlight graphics
 */
function highlightLineRectangle(segment, color, name) {
  const { A, B } = segment.ray;
  const width = Math.floor(canvas.scene.dimensions.size * (CONFIG[MODULE_ID].gridlessHighlightWidthMultiplier ?? 0.2));
  const ptsA = perpendicularPoints(A, B, width * 0.5);
  const ptsB = perpendicularPoints(B, A, width * 0.5);
  const shape = new PIXI.Polygon([
    ptsA[0],
    ptsA[1],
    ptsB[0],
    ptsB[1]
  ]);
  canvas.interface.grid.highlightPosition(name, { x: A.x, y: A.y, color, shape});
}

/**
 * Take 2d segments and make 3d.
 * @param {Ruler} ruler
 * @param {object[]} segments
 */
function elevateSegments(ruler, segments) {  // Add destination as the final waypoint
  const gridUnitsToPixels = CONFIG.GeometryLib.utils.gridUnitsToPixels;
  const Ruler = CONFIG.Canvas.rulerClass;

  // Add destination as the final waypoint
  ruler.destination._terrainElevation = Ruler.terrainElevationAtLocation(ruler.destination);
  ruler.destination._userElevationIncrements = 0; // All increments affect previous waypoints.
  const destWaypoint = {
    x: ruler.destination.x,
    y: ruler.destination.y,
    _userElevationIncrements: 0,
    _forceToGround: Settings.FORCE_TO_GROUND,
  }
  destWaypoint._prevElevation = elevationFromWaypoint(ruler.waypoints.at(-1), destWaypoint, ruler.token);
  const waypoints = [...ruler.waypoints, destWaypoint];

  // Add the waypoint elevations to the corresponding segment endpoints.
  for ( const segment of segments ) {
    const ray = segment.ray;
    const startWaypoint = waypoints.find(w => w.x === ray.A.x && w.y === ray.A.y);
    const endWaypoint = waypoints.find(w => w.x === ray.B.x && w.y === ray.B.y);
    if ( !startWaypoint || !endWaypoint ) continue;

    // Convert to 3d Rays
    // Starting elevation is before user elevation increments.
    const Az = gridUnitsToPixels(Ruler.elevationAtWaypoint(startWaypoint) - Ruler.userElevationChangeAtWaypoint(startWaypoint));
    const Bz = gridUnitsToPixels(Ruler.elevationAtWaypoint(endWaypoint) - Ruler.userElevationChangeAtWaypoint(endWaypoint) + Ruler.userElevationChangeAtWaypoint(startWaypoint));
    segment.ray = Ray3d.from2d(ray, { Az, Bz });
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
  const increment = s.waypointElevationIncrement;
  const multiple = Settings.get(Settings.KEYS.TOKEN_RULER.ROUND_TO_MULTIPLE) || 1;
  const elevation = (CONFIG.GeometryLib.utils.pixelsToGridUnits(s.ray.A.z) + s.waypointElevationIncrement).toNearest(multiple);

  const segmentArrow = (increment > 0) ? "↑"
    : (increment < 0) ? "↓" : "↕";

  // Take absolute value b/c segmentArrow will represent direction
  // Allow decimals to tenths ( Math.round(x * 10) / 10).
  let label = `${segmentArrow}${Math.abs(Number(increment))} ${units}`;
  label += ` [@${Number(elevation)} ${units}]`;

  return label;
}
