/* globals
canvas,
CONFIG,
CONST,
PIXI
*/
"use strict";

import { DIAGONAL_RULES, MODULES_ACTIVE } from "./const.js";
import {
  log,
  iterateGridUnderLine,
  squareGridShape,
  hexGridShape,
  segmentBounds,
  gridShapeFromGridCoords,
  gridCenterFromGridCoords } from "./util.js";
import { Settings } from "./settings.js";
import { Point3d } from "./geometry/3d/Point3d.js";

// Specialized distance measurement methods that can handle grids.

/** @type {enum} */
const CHANGE = {
  NONE: 0,
  V: 1,
  H: 2,
  D: 3,
  E: 4
};

// Store the flipped key/values.
Object.entries(CHANGE).forEach(([key, value]) => CHANGE[value] = key);

/**
 * Measure physical distance between two points, accounting for grid rules.
 * @param {Point} a                     Starting point for the segment
 * @param {Point} b                     Ending point for the segment
 * @param {boolean} [gridless=false]    If true, use the euclidean distance, ignoring grid.
 * @returns {number} Distance in grid units.
 *  A segment wholly within a square may be 0 distance.
 *  Instead of mathematical shortcuts from center, actual grid squares are counted.
 *  Euclidean on a grid also uses grid squares, but measures using actual diagonal from center to center.
 */
export function measureDistance(a, b, { gridless = false } = {}) {
  gridless ||= canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
  if ( gridless ) return CONFIG.GeometryLib.utils.pixelsToGridUnits(Point3d.distanceBetween(a, b));

  a = Point3d.fromObject(a);
  b = Point3d.fromObject(b);
  const changeCount = sumGridMoves(a, b);

  // Convert each grid step into a distance value.
  const distance = canvas.dimensions.distance;
  const diagonalRule = DIAGONAL_RULES[canvas.grid.diagonalRule] ?? DIAGONAL_RULES["555"];
  let diagonalDist = distance;
  if ( !canvas.grid.isHex && diagonalRule === DIAGONAL_RULES.EUCL ) diagonalDist = Math.hypot(distance, distance);

  // Sum the horizontal, vertical, and diagonal grid moves.
  let d = (changeCount.V * distance)
    + (changeCount.H * distance)
    + (changeCount.D * diagonalDist);

  // If diagonal is 5-10-5, every even move gets an extra 5.
  if ( !canvas.grid.isHex && diagonalRule === DIAGONAL_RULES["5105"] ) {
    const nEven = ~~(changeCount.D * 0.5);
    d += (nEven * distance);
  }

  // For manhattan, every diagonal is done in two steps, so add an additional distance for each diagonal move.
  else if ( !canvas.grid.isHex && diagonalRule === DIAGONAL_RULES.MANHATTAN ) {
    d += (changeCount.D * diagonalDist);
  }

  return d;
}

/**
 * @typedef {object} GridlessMoveDistanceMeasurement
 * @property {number} distance        Physical euclidean distance.
 * @property {number} moveDistance    Distance adjusted for difficult terrain(s) encountered.
 * @property {number} endElevationZ   End elevation, which may differ from segment b.z if stopTarget is defined.
 * @property {Point3d} endPoint       End point, which may differ from segment b if stopTarget is defined.
 */

/**
 * @typedef {object} GriddedMoveDistanceMeasurement
 * @property {number} distance        Physical distance given the grid type and grid rules.
 * @property {number} moveDistance    Distance adjusted for difficult terrain(s) encountered.
 * @property {number} endElevationZ   End elevation, which may differ from segment b.z if stopTarget is defined.
 * @property {Number[2]} endGridCoords  End grid square/hex coordinates
 * @property {number} remainingElevationSteps   Number of elevation grid steps remaining.
 *   (Number of grid squares straight down required to reach segment b.z elevation. )
 */

/**
 * Measure the move distance between two points, taking into account terrain and tokens.
 * This uses the `Ruler.prototype.measureDistance` approach for counting grid moves.
 * Each grid move is penalized based on the amount of terrain within the grid.
 * A segment wholly within a square may be 0 distance.
 * @param {Point} a                     Starting point for the segment
 * @param {Point} b                     Ending point for the segment
 * @param {Token} token                 Token that is moving.
 * @param {boolean} [gridless=false]    If true, use the euclidean distance, ignoring grid.
 * @param {boolean} [useAllElevation=true]  If true, on gridless ensure elevation at end is b.z.
 * @returns {GriddedMoveDistanceMeasurement|GridlessMoveDistanceMeasurement}
 */
export function measureMoveDistance(a, b, token, { gridless = false, useAllElevation = true, stopTarget } = {}) {
  gridless ||= canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
  a = Point3d.fromObject(a);
  b = Point3d.fromObject(b);
  if ( gridless ) return gridlessMoveDistance(a, b, token, { stopTarget });
  else return griddedMoveDistance(a, b, token, { useAllElevation, stopTarget });
}

// ----- NOTE: Gridless ----- //

/**
 * Calculate the move distance for gridless.
 * @param {PIXI.Point|Point3d} a              Starting point for the segment
 * @param {PIXI.Point|Point3d} b              Ending point for the segment
 * @param {Token} [token]                     Token that is moving.
 * @param {object} [opts]                     Options that affect the measurement
 * @param {number} [opts.stopTarget]          Maximum move distance, in canvas scene units, to measure.
 *   If set, the measurement may terminate early.
 *   This can be used to project a ray from point a for a specific move distance.
 * @returns {GridlessMoveDistanceMeasurement}
 */
function gridlessMoveDistance(a, b, token, { stopTarget } = {}) {
  // Recursively calls gridlessMoveDistance without a stop target to find a breakpoint.
  if ( stopTarget ) b = findGridlessBreakpoint(a, b, token, stopTarget);

  // Determine penalty proportion of the a|b segment.
  const terrainPenalty = terrainMovePenalty(a, b, token);
  const tokenPenalty = terrainTokenGridlessMoveMultiplier(a, b, token);
  const d = CONFIG.GeometryLib.utils.pixelsToGridUnits(Point3d.distanceBetween(a, b));
  return {
    distance: d,
    moveDistance: d * terrainPenalty * tokenPenalty,
    endElevationZ: b.z,
    endPoint: b
  };
}

/**
 * Search for the best point at which to split a segment on a gridless Canvas so that
 * the first half of the segment is splitMoveDistance.
 * @param {PIXI.Point|Point3d} a              Starting point for the segment
 * @param {PIXI.Point|Point3d} b              Ending point for the segment
 * @param {Token} [token]                     Token to use when measuring move distance
 * @param {number} [splitMoveDistance]        Distance, in grid units, of the desired first subsegment move distance
 * @returns {Point3d}
 */
function findGridlessBreakpoint(a, b, token, splitMoveDistance) {
  // Binary search to find a reasonably close t value for the split move distance.
  // Because the move distance can vary depending on terrain.
  const MAX_ITER = 20;
  const { moveDistance: fullMoveDistance } = gridlessMoveDistance(a, b, token);

  let t = splitMoveDistance / fullMoveDistance;
  if ( t <= 0 ) return a;
  if ( t >= 1 ) return b;

  let maxHigh = 1;
  let maxLow = 0;
  let testSplitPoint;
  for ( let i = 0; i < MAX_ITER; i += 1 ) {
    testSplitPoint = a.projectToward(b, t);
    const { moveDistance } = gridlessMoveDistance(a, testSplitPoint, token);

    // Adjust t by half the distance to the max/min t value.
    // Need not be all that exact but must be over the target distance.
    if ( moveDistance.almostEqual(splitMoveDistance, .01) ) break;
    if ( moveDistance > splitMoveDistance ) {
      maxHigh = t;
      t -= ((t - maxLow) * 0.5);
    } else {
      maxLow = t;
      t += ((maxHigh - t) * 0.5);
    }
  }
  return testSplitPoint;
}

/**
 * Get speed multiplier for tokens between two points, assuming gridless.
 * Multiplier based on the percentage of the segment that overlaps 1+ tokens.
 * @param {Point3d} a                     Starting point for the segment
 * @param {Point3d} b                     Ending point for the segment
 * @param {Token} [token]                 Token to use
 * @returns {number} Percent penalty
 */
function terrainTokenGridlessMoveMultiplier(a, b, token) {
  const mult = Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER);
  if ( mult === 1 ) return 1;

  // Find tokens along the ray whose constrained borders intersect the ray.
  const bounds = segmentBounds(a, b);
  const collisionTest = o => o.t.constrainedTokenBorder.lineSegmentIntersects(a, b, { inside: true });
  const tokens = canvas.tokens.quadtree.getObjects(bounds, { collisionTest });
  tokens.delete(token);
  if ( !tokens.size ) return 1;

  // Determine the percentage of the ray that intersects the constrained token shapes.
  const tValues = [];
  const deltaMag = b.to2d().subtract(a).magnitude();
  for ( const t of tokens ) {
    const border = t.constrainedTokenBorder;
    let inside = false;
    if ( border.contains(a) ) {
      inside = true;
      tValues.push({ t: 0, inside });
    }

    // At each intersection, we switch between inside and outside.
    const ixs = border.segmentIntersections(a, b); // Can we assume the ixs are sorted by t0?

    // See Foundry issue #10336. Don't trust the t0 values.
    ixs.forEach(ix => {
      // See PIXI.Point.prototype.towardsPoint
      const distance = Point3d.distanceBetween(a, ix);
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
      const startPt = a.projectToward(b, prevT);
      const endPt = a.projectToward(b, tValue.t);
      distInside += Point3d.distanceBetween(startPt, endPt);
      nInside = 0;
      prevT = undefined;
    }
  }

  // If still inside, we can go all the way to t = 1
  if ( nInside > 0 ) {
    const startPt = a.projectToward(b, prevT);
    distInside += Point3d.distanceBetween(startPt, b);
  }

  if ( !distInside ) return 1;

  const totalDistance = Point3d.distanceBetween(a, b);
  return ((totalDistance - distInside) + (distInside * mult)) / totalDistance;
}

// ----- NOTE: Gridded ----- //

/**
 * Calculate the move distance for gridded.
 * Similar to measureDistance.
 * @param {Point3d} a                      Starting point for the segment
 * @param {Point3d} b                      Ending point for the segment
 * @param {Token} [token]                     Token that is moving.
 * @param {object} [opts]                     Options that affect the measurement
 * @param {number} [opts.stopTarget]          Maximum move distance, in grid units, to measure.
 * @param {boolean} [opts.useAllElevation]    If false, elevation will be decreased one grid unit
 *   for each step from a to b (or a to stopTarget). But remaining elevation, if any, will not
 *   be accounted for in the distance measurement or moveDistance measurement.
 *   Used for multiple segment moves, where elevation can be further decreased in a future segment move.
 * @returns {GriddedMoveDistanceMeasurement}
 */
function griddedMoveDistance(a, b, token, { useAllElevation = true, stopTarget } = {}) {
  const iter = iterateGridMoves(a, b);
  let prev = iter.next().value;

  if ( !prev ) {
    // Should never happen, as passing the same point as a,b returns a single square.
    console.warn("griddedMoveDistance|iterateGridMoves return undefined first value.");
    return 0;
  }

  // Step over each grid shape in turn.
  let dTotal = 0;
  let dMoveTotal = 0;
  let currElevSteps = 0;
  let prevStep = prev;
  let finalElev = 0;
  const distanceGridStepFn = distanceForGridStepFunction(prev, a, b, token);
  for ( const next of iter ) {
    const { distance, movePenalty, elevSteps, currElev } = distanceGridStepFn(next);

    // Early stop if the stop target is met.
    const moveDistance = (distance * movePenalty);
    if ( stopTarget && (dMoveTotal + moveDistance) > stopTarget ) break;

    dTotal += distance;
    dMoveTotal += (distance * movePenalty);
    currElevSteps = elevSteps;
    prevStep = next;
    finalElev = currElev;
  }

  // Handle remaining elevation change, if any, by moving directly up/down.
  if ( useAllElevation ) {
    while ( currElevSteps > 0 ) {
      const { distance, movePenalty, elevSteps, currElev } = distanceGridStepFn(prevStep);
      dTotal += distance;
      dMoveTotal += (distance * movePenalty);
      currElevSteps = elevSteps;
      finalElev = currElev;
    }
  }

  return {
    distance: dTotal,
    moveDistance: dMoveTotal,
    remainingElevationSteps: currElevSteps,
    endElevationZ: finalElev,
    endGridCoords: prevStep
  };
}

/**
 * Helper to adjust a single grid move by elevation change.
 * If moving horizontal or vertical with elevation, move diagonally instead.
 * Sum the remaining elevation and add to diagonal.
 * @param {object} gridMove
 * @returns {gridMove} For convenience. Modified in place.
 */
function adjustGridMoveForElevation(gridMove) {
  let totalE = gridMove.E;
  while ( totalE > 0 && gridMove.H > 0 ) {
    totalE -= 1;
    gridMove.H -= 1;
    gridMove.D += 1;
  }
  while ( totalE > 0 && gridMove.V > 0 ) {
    totalE -= 1;
    gridMove.V -= 1;
    gridMove.D += 1;
  }
  gridMove.D += totalE;

  return gridMove;
}



/**
 * Count the number of horizontal, vertical, diagonal, elevation grid moves.
 * Adjusts vertical and diagonal for elevation.
 * @param {PIXI.Point|Point3d} a                 Starting point for the segment
 * @param {PIXI.Point|Point3d} b                   Ending point for the segment
 * @returns {Uint32Array[4]|0} Counts of changes: none, vertical, horizontal, diagonal.
 */
function sumGridMoves(a, b) {
  const iter = iterateGridMoves(a, b);
  const totalChangeCount = { H: 0, V: 0, D: 0, E: 0 };
  for ( const move of iter ) {
    const movementChange = move.movementChange;
    adjustGridMoveForElevation(movementChange);
    Object.keys(totalChangeCount).forEach(key => totalChangeCount[key] += movementChange[key]);
  }
  return totalChangeCount;
}

/**
 * Helper to determine the center of a grid shape given a grid position.
 * @param {Array[2]} gridCoords     Grid coordinates, [row, col]
 * @returns {Point}
 */
function gridCenterFromGridCoordinates(gridCoords) {
  const [x, y] = canvas.grid.grid.getPixelsFromGridPosition(gridCoords[0], gridCoords[1]);
  const [cx, cy] = canvas.grid.grid.getCenter(x, y);
  return new PIXI.Point(cx, cy);
}

/**
 * Helper to get the terrain penalty for a given move from previous point to next point
 * across a grid square/hex.
 * @param {PIXI.Rectangle|PIXI.Polygon} gridShape
 * @param {Point3d} startPt
 * @param {Point3d} endPt
 * @param {Token} token
 * @returns {number} Terrain penalty, averaged across the two portions.
 */
function terrainPenaltyForGridStep(gridShape, startPt, endPt, token) {
  const ixs = gridShape
    .segmentIntersections(startPt, endPt)
    .map(ix => PIXI.Point.fromObject(ix));
  const ix = PIXI.Point.fromObject(ixs[0] ?? PIXI.Point.midPoint(startPt, endPt));

  // Build 3d points for calculating the terrain intersections
  const midPt = Point3d.fromObject(ix);
  midPt.z = (startPt.z + endPt.z) * 0.5;

  // Get penalty percentages, which might be 3d.
  const terrainPenaltyPrev = terrainMovePenalty(startPt, midPt, token);
  const terrainPenaltyCurr = terrainMovePenalty(midPt, endPt, token);

  // TODO: Does it matter that the 3d distance may be different than the 2d distance?
  return (terrainPenaltyCurr + terrainPenaltyPrev) * 0.5;
}

/**
 * Helper to determine the grid shape from grid coordiantes
 * @param {Array[2]} gridCoords     Grid coordinates, [row, col]
 * @returns {PIXI.Rectangle|PIXI.Polygon}
 */
export function gridShapeFromGridCoordinates(gridCoords) {
  const gridShapeFn = canvas.grid.type === CONST.GRID_TYPES.SQUARE ? squareGridShape : hexGridShape;
  const [x, y] = canvas.grid.grid.getPixelsFromGridPosition(gridCoords[0], gridCoords[1]);
  return gridShapeFn({x, y});
}

/**
 * Determine if at least one token overlaps this grid square/hex.
 * @param {PIXI.Rectangle|PIXI.Polygon} gridShape
 * @param {number} prevElev     top/bottom of the grid
 * @param {number} currElev     top/bottom of the grid
 */
function doTokensOverlapGridShape(tokens, shape, prevElev = 0, currElev = 0) {
  return tokens.some(t => {
    // Token must be at the correct elevation to intersect the move.
    if ( !minMaxOverlap(prevElev, currElev, t.bottomZ, t.topZ, true) ) return false;

    // Token constrained border, shrunk to avoid false positives from adjacent grid squares.
    const border = t.constrainedTokenBorder ?? t.bounds;
    border.pad(-2);
    return border.overlaps(shape);
  });
}

/**
 * Count number of grid spaces needed for an elevation change.
 * @param {number} e      Elevation in pixel units
 * @returns {number} Number of grid steps
 */
function numElevationGridSteps(e) {
  const gridE = CONFIG.GeometryLib.utils.pixelsToGridUnits(e || 0);
  return Math.ceil(gridE / canvas.dimensions.distance);
}

/**
 * Modify the change count by elevation moves.
 * Assume diagonal can move one elevation.
 * If no diagonal available, convert horizontal/vertical to diagonal.
 * If no moves available, add horizontal (don't later convert to diagonal).
 * @param {number} elevSteps
 * @param {Uint32Array[4]} changeCount
 * @returns {Uint32Array[4]} The same changeCount array, for convenience.
 */
function elevationChangeCount(elevSteps, changeCount) {
  let availableDiags = changeCount[CHANGE.D];
  let addedH = 0;
  while ( elevSteps > 0 ) { // Just in case we screw this up and send elevSteps negative.
    if ( availableDiags ) availableDiags -= 1;
    else if ( changeCount[CHANGE.H] ) {
      changeCount[CHANGE.H] -= 1;
      changeCount[CHANGE.D] += 1;
    } else if ( changeCount[CHANGE.V] ) {
      changeCount[CHANGE.V] -= 1;
      changeCount[CHANGE.D] += 1;
    } else addedH += 1; // Add an additional move "down."
    elevSteps -= 1;
  }
  changeCount[CHANGE.H] += addedH;
  return changeCount;
}

/**
 * Determine whether this grid space applies a move penalty because one or more tokens occupy it.
 * @param {number[2]} currGridCoords
 * @param {number[2]} [prevGridCoords]      Required for Euclidean setting; otherwise ignored.
 * @param {number} currElev                 Elevation at current grid point, in pixel units
 * @param {number} prevElev                 Elevation at current grid point, in pixel units
 * @returns {number} Percent move penalty to apply. Returns 1 if no penalty.
 */
function griddedTokenMovePenalty(currGridCoords, prevGridCoords, currElev = 0, prevElev = 0) {
  const mult = Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER);
  if ( mult === 1 ) return 1;

  // Locate tokens that overlap this grid space.
  const GT = Settings.KEYS.GRID_TERRAIN;
  const alg = Settings.get(GT.ALGORITHM);
  let collisionTest;
  let bounds;
  let currCenter;
  let prevCenter;
  switch ( alg ) {
    case GT.CHOICES.CENTER: {
      currCenter = gridCenterFromGridCoords(currGridCoords);
      collisionTest = o => o.t.constrainedTokenBorder.contains(currCenter.x, currCenter.y);
      bounds = gridShape.getBounds();
      break;
    }

    case GT.CHOICES.PERCENT: {
      const gridShape = gridShapeFromGridCoords(currGridCoords);
      const percentThreshold = Settings.get(GT.AREA_THRESHOLD);
      const totalArea = gridShape.area();
      collisionTest = o => percentOverlap(o.t.constrainedBorder, gridShape, totalArea) >= percentThreshold;
      bounds = gridShape.getBounds();
      break;
    }

    case GT.CHOICES.EUCLIDEAN: {
      currCenter = gridCenterFromGridCoords(currGridCoords);
      prevCenter = gridCenterFromGridCoords(prevGridCoords);
      collisionTest = o => o.t.constrainedTokenBorder.lineSegmentIntersects(prevCenter, currCenter, { inside: true });
      bounds = segmentBounds(prevCenter, currCenter);
      break;
    }
  }

  // Check that elevation is within the token height.
  const tokens = canvas.tokens.quadtree.getObjects(bounds, { collisionTest })
    .filter(t => currElev.between(t.bottomZ, t.topZ));
  if ( alg !== GT.CHOICES.EUCLIDEAN ) return tokens.size ? mult : 1;

  // For Euclidean, determine the percentage intersect.
  prevCenter = Point3d.fromObject(prevCenter);
  currCenter = Point3d.fromObject(currCenter);
  prevCenter.z = prevElev;
  currCenter.z = currElev;
  return percentageShapeIntersection(prevCenter, currCenter, tokens.map(t => t.constrainedTokenBorder));
}


/**
 * Determine the percentage of the ray that intersects a set of shapes.
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @param {(PIXI.Polygon|PIXI.Rectangle)[]} shapes
 * @returns {number}
 */
percentageShapeIntersection(a, b, shapes = []) {
  const tValues = [];
  const deltaMag = b.to2d().subtract(a).magnitude();

  // Determine the percentage of the a|b segment that intersects the shapes.
  for ( const shape of shapes ) {
    let inside = false;
    if ( shape.contains(a) ) {
      inside = true;
      tValues.push({ t: 0, inside });
    }

    // At each intersection, we switch between inside and outside.
    const ixs = shape.segmentIntersections(a, b); // Can we assume the ixs are sorted by t0?

    // See Foundry issue #10336. Don't trust the t0 values.
    ixs.forEach(ix => {
      // See PIXI.Point.prototype.towardsPoint
      const distance = Point3d.distanceBetween(a, ix);
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
      const startPt = a.projectToward(b, prevT);
      const endPt = a.projectToward(b, tValue.t);
      distInside += Point3d.distanceBetween(startPt, endPt);
      nInside = 0;
      prevT = undefined;
    }
  }

  // If still inside, we can go all the way to t = 1
  if ( nInside > 0 ) {
    const startPt = a.projectToward(b, prevT);
    distInside += Point3d.distanceBetween(startPt, b);
  }

  if ( !distInside ) return 1;

  const totalDistance = Point3d.distanceBetween(a, b);
  return distanceInside / totalDistance;
}

/**
 * Calculate the percent area overlap of one shape on another.
 * @param {PIXI.Rectangle|PIXI.Polygon} overlapShape
 * @param {PIXI.Rectangle|PIXI.Polygon} areaShape
 * @returns {number} Value between 0 and 1.
 */
function percentOverlap(overlapShape, areaShape, totalArea) {
  if ( !overlapShape.overlaps(areaShape) ) return 0;
  const intersection = overlapShape.intersectPolygon(areaShape.toPolygon());
  const ixArea = intersection.area();
  totalArea ??= areaShape.area();
  return ixArea / totalArea;
}

/**
 * Determine whether this grid space applies a move penalty/bonus because one or more terrains occupy it.
 * @param {Token} token
 * @param {number[2]} currGridCoords
 * @param {number[2]} [prevGridCoords]      Required for Euclidean setting; otherwise ignored.
 * @param {number} currElev                 Elevation at current grid point, in pixel units
 * @param {number} prevElev                 Elevation at current grid point, in pixel units
 * @returns {number} Percent move penalty to apply. Returns 1 if no penalty.
 */
function griddedTerrainMovePenalty(token, currGridCoords, prevGridCoords, currElev = 0, prevElev = 0) {
  if ( !MODULES_ACTIVE.TERRAIN_MAPPER ) return 1;
  const Terrain = MODULES_ACTIVE.API.TERRAIN_MAPPER.Terrain;
  const speedAttribute = SPEED.ATTRIBUTES[token.movementType] ?? SPEED.ATTRIBUTES.WALK;
  const GT = Settings.KEYS.GRID_TERRAIN;
  const alg = Settings.get(GT.ALGORITHM);
  switch ( alg ) {
    case GT.CHOICES.CENTER: {
      const currCenter = Point3d.fromObject(gridCenterFromGridCoords(currGridCoords));
      currCenter.z = currElev;
      return Terrain.percentMovementChangeForTokenAtPoint(token, currCenter, speedAttribute);
    }

    case GT.CHOICES.PERCENT: {
      const gridShape = gridShapeFromGridCoords(currGridCoords);
      const percentThreshold = Settings.get(GT.AREA_THRESHOLD);
      return Terrain.percentMovementChangeForTokenWithinShape(token, gridShape, percentThreshold, speedAttribute, currElev);
    }

    case GT.CHOICES.EUCLIDEAN: {
      const currCenter = Point3d.fromObject(gridCenterFromGridCoords(currGridCoords));
      const prevCenter = Point3d.fromObject(gridCenterFromGridCoords(prevGridCoords));
      currCenter.z = currElev;
      prevCenter.z = prevElev;
      return Terrain.percentMovementForTokenAlongPath(token, prevCenter, currCenter, speedAttribute);
    }
  }
}

/**
 * Return a function that tracks the grid steps from a previous square/hex to a new square/hex.
 * The function returns the distance and move distance for a given move.
 * @param {number[2]} prev                    Column, row of the starting grid square
 * @param {PIXI.Point|Point3d} a              Starting point for the segment
 * @param {PIXI.Point|Point3d} b              Ending point for the segment
 * @param {Token} [token]                     Token that is moving.
 * @returns {function}
 *   - @param {number[2]} next    column, row of the next square
 */
function distanceForGridStepFunction(prev, a, b, token ) {
  const zUnitDistance = CONFIG.GeometryLib.utils.gridUnitsToPixels(canvas.scene.dimensions.distance);
  const tokenMult = Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER) || 1;
  const distance = canvas.dimensions.distance;

  // Rule for measuring diagonal distance.
  const diagonalRule = DIAGONAL_RULES[canvas.grid.diagonalRule] ?? DIAGONAL_RULES["555"];
  let diagonalDist = distance;
  if ( diagonalRule === DIAGONAL_RULES.EUCL ) diagonalDist = Math.hypot(distance, distance);
  let nDiag = 0;

  // Track elevation changes.
  let elevSteps = numElevationGridSteps(Math.abs(b.z - a.z));
  const elevDir = Math.sign(b.z - a.z);
  let currElev = a.z || 0;
  let prevElev = a.z || 0;

  // Find tokens along the ray whose constrained borders intersect the ray.
  const bounds = segmentBounds(a, b);
  const collisionTest = o => o.t.constrainedTokenBorder.lineSegmentIntersects(a, b, { inside: true });
  const tokens = canvas.tokens.quadtree.getObjects(bounds, { collisionTest });
  tokens.delete(token);

  // Track if token overlaps this space
  const gridShape = gridShapeFromGridCoordinates(prev);
  let tokenOverlapsPrev = (tokenMult === 1 || !tokens.size) ? false
    : doTokensOverlapGridShape(tokens, gridShape, prevElev, currElev);

  // Find the center of this grid shape.
  const prevCenter = Point3d.fromObject(gridCenterFromGridCoordinates(prev));
  prevCenter.z = a.z;

  // Function to track movement changes
  const gridStepFn = countGridStep(prev, elevSteps);

  // Return a function that calculates distance between previous and next grid spaces.
  return next => {
    // Track movement changes from previous grid square/hex to next.
    const changeCount = gridStepFn(next);

    // Track current elevation. Ensure it is bounded between a.z and b.z.
    currElev += (zUnitDistance * changeCount[CHANGE.E] * elevDir);
    currElev = elevDir > 0 ? Math.min(b.z, currElev) : Math.max(b.z, currElev);

    // Do one or more token constrained borders overlap this grid space?
    const gridShape = gridShapeFromGridCoordinates(next);
    const tokenOverlaps = (tokenMult === 1 || !tokens.size) ? false
      : doTokensOverlapGridShape(tokens, gridShape, prevElev, currElev);

    // Locate the center of this grid shape.
    const currCenter = Point3d.fromObject(gridCenterFromGridCoordinates(next));
    currCenter.z = currElev;

    // Calculate the terrain penalty as an average of the previous grid and current grid shape.
    const terrainPenalty = terrainPenaltyForGridStep(gridShape, prevCenter, currCenter, token);

    // Moves this iteration.
    let d = (changeCount[CHANGE.V] * distance)
    + (changeCount[CHANGE.H] * distance)
    + (changeCount[CHANGE.D] * diagonalDist);

    // If diagonal is 5-10-5, every even move gets an extra 5.
    nDiag += changeCount[CHANGE.D];
    if ( diagonalRule === DIAGONAL_RULES["5105"] ) {
      const nEven = ~~(nDiag * 0.5);
      d += (nEven * distance);
    }

    // Average
    const tokenPenalty = ((tokenOverlaps ? tokenMult : 1) + (tokenOverlapsPrev ? tokenMult : 1)) * 0.5;
    log(`griddedMoveDistance|${prevCenter.x},${prevCenter.y},${prevCenter.z} -> ${currCenter.x},${currCenter.y},${currCenter.z}\n\ttokenPenalty: ${tokenPenalty}\n\tterrainPenalty: ${terrainPenalty}`);
    if ( !isFinite(currCenter.z) || !isFinite(prevCenter.z) ) {
      log("Non-finite z value in distanceForGridStepFunction");
    }


    // Cycle to next.
    tokenOverlapsPrev = tokenOverlaps;
    prevCenter.copyFrom(currCenter);
    prev = next;
    prevElev = currElev;
    elevSteps = Math.max(elevSteps - 1, 0);

    return { distance: d, movePenalty: terrainPenalty * tokenPenalty, elevSteps, currElev };
  };
}

/**
 * Helper to count the moves for a given step.
 * @param {number} elevSteps    Number of steps of elevation
 * @returns {function} Function that will count a step change.
 *  Function will take:
 *  @param {Array[2]} prev    column, grid of the previous square
 *  @param {Array[2]} next    column, grid of the next square
 *  @returns {A}
 */
function countGridStep(prev, elevSteps = 0) {
  const changeCount = new Uint32Array([0, 0, 0, 0, 0]);
  return next => {
    changeCount.fill(0);
    // Count the move direction.
    if ( next ) {
      const xChange = prev[1] !== next[1]; // Column is x
      const yChange = prev[0] !== next[0]; // Row is y
      changeCount[((xChange * 2) + yChange)] += 1;
    }

    // Account for an elevation change of maximum 1 grid space. See elevationChangeCount.
    if ( elevSteps > 0 ) {
      if ( changeCount[CHANGE.D] ) {
        // Do nothing.
      } else if ( changeCount[CHANGE.H] ) {
        changeCount[CHANGE.H] -= 1;
        changeCount[CHANGE.D] += 1;
      } else if ( changeCount[CHANGE.V] ) {
        changeCount[CHANGE.V] -= 1;
        changeCount[CHANGE.D] += 1;
      } else {
        changeCount[CHANGE.H] += 1; // Add an additional move "down."
      }
      elevSteps -= 1;
      changeCount[CHANGE.E] += 1;
    }
    prev = next;
    return changeCount;
  };
}


// ----- NOTE: Helper methods ----- //

/**
 * Calculate terrain penalty between two points.
 * Multiply this by distance to get the move distance.
 * @param {}
 * @param {PIXI.Point} a                      Starting point for the segment
 * @param {PIXI.Point} b                      Ending point for the segment
 * @param {Token} token                       Token that is moving.
 * @returns {number} Percent penalty
 */
function terrainMovePenalty(a, b, token) {
  const terrainAPI = MODULES_ACTIVE.API.TERRAIN_MAPPER;
  if ( !terrainAPI || !token ) return 1;
  return terrainAPI.Terrain.percentMovementForTokenAlongPath(token, a, b) || 1;
}

/**
 * Does one number range overlap another?
 * @param {number} a0
 * @param {number} a1
 * @param {number} b0
 * @param {number} b1
 * @param {boolean} [inclusive=true]
 * @returns {boolean}
 */
function minMaxOverlap(a0, a1, b0, b1, inclusive = true) {
  const aMinMax = Math.minMax(a0, a1);
  const bMinMax = Math.minMax(b0, b1);
  return aMinMax.min.between(bMinMax.min, bMinMax.max, inclusive)
    || aMinMax.max.between(bMinMax.min, bMinMax.max, inclusive)
    || bMinMax.min.between(aMinMax.min, aMinMax.max, inclusive)
    || bMinMax.max.between(aMinMax.min, aMinMax.max, inclusive);
}

/**
 * From a given origin, move horizontally the total 2d distance between A and B.
 * Then move vertically up/down in elevation.
 * Return an iterator for that movement.
 * @param {Point3d} origin
 * @param {Point3d} destination
 * @return Iterator, which in turn
 *   returns [row, col] Array for each grid point under the line.
 */
function iterateGridProjectedElevation(origin, destination) {
  const dist2d = PIXI.Point.distanceBetween(origin, destination);
  let elev = (destination.z ?? 0) - (origin.z ?? 0);

  // Must round up to the next grid step for elevation.
  const size = canvas.dimensions.size;
  if ( elev % size ) elev = (Math.floor(elev / size) + 1) * size;

  // For hexagonal grids, move in the straight line (row or col) to represent elevation.
  const b = isHexRow()
    ? new PIXI.Point(origin.x + elev, origin.y + dist2d)
    : new PIXI.Point(origin.x + dist2d, origin.y + elev);
  return iterateGridUnderLine(origin, b);
}

/**
 * @returns {boolean} True if the grid is a row hex.
 */
function isHexRow() {
  return canvas.grid.type === CONST.GRID_TYPES.HEXODDR
    || canvas.grid.type === CONST.GRID_TYPES.HEXEVENR;
}

/**
 * Type of change between two grid coordinates.
 * @param {number[2]} prevGridCoord
 * @param {number[2]} nextGridCoord
 * @returns {CHANGE}
 */
function gridChangeType(prevGridCoord, nextGridCoord) {
  const xChange = prevGridCoord[1] !== nextGridCoord[1]; // Column is x
  const yChange = prevGridCoord[0] !== nextGridCoord[0]; // Row is y
  return CHANGE[((xChange * 2) + yChange)];
}

/**
 * From a given origin to a destination, iterate over each grid coordinate in turn.
 * Track data related to the move at each iteration, taking the delta from the previous.
 * @param {Point3d} origin
 * @param {Point3d} destination
 * @returnIterator, which in turn returns {object}
 *   - @prop {number[2]} gridCoords
 *   - @prop {object} movementChange
 */
function iterateGridMoves(origin, destination) {
  if ( canvas.grid.type === CONST.GRID_TYPES.SQUARE
    || canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ) return iterateNonHexGridMoves(origin, destination);
  return iterateHexGridMoves(origin, destination);
}

/**
 * For hex grids.
 * From a given origin to a destination, iterate over each grid coordinate in turn.
 * Track data related to the move at each iteration, taking the delta from the previous.
 * @param {Point3d} origin
 * @param {Point3d} destination
 * @returnIterator, which in turn returns {object}
 *   - @prop {number[2]} gridCoords
 *   - @prop {object} movementChange
 */
function * iterateHexGridMoves(origin, destination) {
  const iter2d = iterateGridUnderLine(origin, destination);
  const iterElevation = iterateGridProjectedElevation(origin, destination);
  // First coordinate is always the origin grid.
  let prev2d = iter2d.next().value;
  let prevElevation = iterElevation.next().value;
  let movementChange = { H: 0, V: 0, D: 0, E: 0 };

  yield {
    movementChange,
    gridCoords: prev2d
  };

  // Moving along the aligned column/row of the hex grid represents elevation-only change.
  // Moves in other direction represents 2d movement.
  // Assume no reverse-elevation, so elevation must always go the same direction.
  // Hex grid is represented as smaller square grid in Foundry.

  const elevOnlyMoveType = isHexRow() ? "H" : "V";
  const elevOnlyIndex = isHexRow() ? 1 : 0;
  const elevSign = Math.sign(destination.z - origin.z);
  const elevTest = elevSign ? (a, b) => a > b : (a, b) => a < b;
  let currElev = prevElevation[elevOnlyIndex];
  movementChange = { H: 0, V: 0, D: 0, E: 0 }; // Copy; don't keep same object.

  // Use the elevation iteration to tell us when to move to the next 2d step.
  // Horizontal or diagonal elevation moves indicate next step.
  for ( const nextElevation of iterElevation ) {
    const elevChangeType = gridChangeType(prevElevation, nextElevation);
    switch ( elevChangeType ) {
      case "NONE": console.warn("iterateGridMoves unexpected elevChangeType === NONE"); break;
      case elevOnlyMoveType: {
        currElev = nextElevation[elevOnlyIndex];
        movementChange.E += 1;
        break;
      }
      default: {
        const next2d = iter2d.next().value ?? prev2d;
        const moveType = gridChangeType(prev2d, next2d);
        prev2d = next2d;
        const newElev = nextElevation[elevOnlyIndex];
        if ( elevTest(newElev, currElev) ) {
          currElev = newElev;
          movementChange.E += 1;
        }
        movementChange[moveType] += 1;
        yield {
          movementChange,
          gridCoords: next2d
        };
        movementChange = { H: 0, V: 0, D: 0, E: 0 };
      }
    }
    prevElevation = nextElevation;
  }

  if ( movementChange.E ) {
    yield {
      movementChange,
      gridCoords: prev2d
    };
  }
}

/**
 * For square grids.
 * From a given origin to a destination, iterate over each grid coordinate in turn.
 * Track data related to the move at each iteration, taking the delta from the previous.
 * @param {Point3d} origin
 * @param {Point3d} destination
 * @returnIterator, which in turn returns {object}
 *   - @prop {number[2]} gridCoords
 *   - @prop {number[5]} movementChange
 *   - @prop {number[5]} totalMovementChange
 */
function * iterateNonHexGridMoves(origin, destination) {
  const iter2d = iterateGridUnderLine(origin, destination);
  const iterElevation = iterateGridProjectedElevation(origin, destination);
  // First coordinate is always the origin grid.
  let prev2d = iter2d.next().value;
  let prevElevation = iterElevation.next().value;
  let movementChange = { H: 0, V: 0, D: 0, E: 0 };

  yield {
    movementChange,
    gridCoords: prev2d
  };

  movementChange = { H: 0, V: 0, D: 0, E: 0 }; // Copy; don't keep same object.

  // Use the elevation iteration to tell us when to move to the next 2d step.
  // Horizontal or diagonal elevation moves indicate next step.
  for ( const nextElevation of iterElevation ) {
    const elevChangeType = gridChangeType(prevElevation, nextElevation);
    switch ( elevChangeType ) {
      case "NONE": console.warn("iterateGridMoves unexpected elevChangeType === NONE"); break;
      case "V": {
        movementChange.E += 1;
        break;
      }
      case "D": movementChange.E += 1; // eslint-disable-line no-fallthrough
      case "H": {
        const next2d = iter2d.next().value ?? prev2d;
        const moveType = gridChangeType(prev2d, next2d);
        prev2d = next2d;
        movementChange[moveType] += 1;
        yield {
          movementChange,
          gridCoords: next2d
        };
        movementChange = { H: 0, V: 0, D: 0, E: 0 };
      }
    }
    prevElevation = nextElevation;
  }

  if ( movementChange.E ) {
    yield {
      movementChange,
      gridCoords: prev2d
    };
  }
}

/* Testing
Draw = CONFIG.GeometryLib.Draw


gridCoords = [...iterateGridUnderLine(origin, destination)]
gridCoords = [...iterateGridProjectedElevation(origin, destination)]

gridMoves = [...iterateHexGridMoves(origin, destination)]


Draw.clearDrawings()
gridMoves = [...iterateGridMoves(origin, destination)]
gridCoords = gridMoves.map(elem => elem.gridCoords)


rulerPts = [];
for ( let i = 0; i < gridCoords.length; i += 1 ) {
  const [tlx, tly] = canvas.grid.grid.getPixelsFromGridPosition(gridCoords[i][0], gridCoords[i][1]);
  const [x, y] = canvas.grid.grid.getCenter(tlx, tly);
  rulerPts.push({x, y})
}
rulerPts.forEach(pt => Draw.point(pt, { color: Draw.COLORS.green }))

rulerShapes = [];
for ( let i = 0; i < gridCoords.length; i += 1 ) {
  rulerShapes.push(gridShapeFromGridCoords([gridCoords[i][0], gridCoords[i][1]]))
}
rulerShapes.forEach(shape => Draw.shape(shape, { color: Draw.COLORS.green }))

Draw.point(origin);
Draw.point(destination)

moveArr = gridMoves.map(elem => elem.movementChange);
console.table(moveArr)

sumGridMoves(origin, destination)

*/
