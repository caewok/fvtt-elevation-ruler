/* globals
Color,
CONST,
game,
getProperty,
canvas,
PIXI,
CONFIG
*/
"use strict";

import { MODULE_ID, SPEED, MODULES_ACTIVE } from "./const.js";
import { Settings } from "./settings.js";
import { Ray3d } from "./geometry/3d/Ray3d.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import {
  squareGridShape,
  hexGridShape,
  perpendicularPoints,
  iterateGridUnderLine } from "./util.js";

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
 * Wrap Ruler.prototype._getMeasurementSegments
 * Add elevation information to the segments
 */
export function _getMeasurementSegments(wrapped) {
  const segments = wrapped();
  return elevateSegments(this, segments);
}

/**
 * Wrap Ruler.prototype._getSegmentLabel
 * Add elevation information to the label
 */
export function _getSegmentLabel(wrapped, segment, totalDistance) {
  const orig_label = wrapped(segment, totalDistance);
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
  const res = await wrapped(token, segment, destination);

  // Update elevation after the token move.
  if ( segment.ray.A.z !== segment.ray.B.z ) {
    const elevation = CONFIG.GeometryLib.utils.pixelsToGridUnits(segment.ray.B.z);
    await token.document.update({ elevation });
  }

  return res;
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

/**
 * Modify distance by terrain mapper adjustment for token speed.
 * @param {number} distance   Distance of the ray
 * @param {Ray|Ray3d} ray     Ray to measure
 * @param {Token} token       Token to use
 * @returns {number} Modified distance
 */
export function modifiedMoveDistance(distance, ray, token) {
  const terrainMult = 1 / (terrainMoveMultiplier(ray, token) || 1); // Invert because moveMult is < 1 if speed is penalized.
  const tokenMult = terrainTokenMoveMultiplier(ray, token);
  const moveMult = terrainMult * tokenMult;
  return distance * moveMult;
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
      tValues.push({ t: ix.t0, inside })
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
    else if ( nInside === 1 ) { // inside is false and we are now outside.
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
