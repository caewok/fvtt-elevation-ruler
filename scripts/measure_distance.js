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
  segmentBounds } from "./util.js";
import { Settings } from "./settings.js";
import { Point3d } from "./geometry/3d/Point3d.js";

// Specialized distance measurement methods that can handle grids.

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
const CHANGE = {
  NONE: 0,
  V: 1,
  H: 2,
  D: 3,
  E: 4
};
export function measureDistance(a, b, { gridless = false } = {}) {
  gridless ||= canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
  if ( gridless ) return CONFIG.GeometryLib.utils.pixelsToGridUnits(Point3d.distanceBetween(a, b));

  a = Point3d.fromObject(a);
  b = Point3d.fromObject(b);
  const changeCount = countGridMoves(a, b);
  if ( !changeCount ) return 0;

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

  // For manhattan, every diagonal is done in two steps, so add an additional distance for each diagonal move.
  else if ( diagonalRule === DIAGONAL_RULES.MANHATTAN ) {
    d += (changeCount[CHANGE.D] * diagonalDist);
  }

  return d;
}


/**
 * Measure the move distance between two points, taking into account terrain and tokens.
 * This uses the `Ruler.prototype.measureDistance` approach for counting grid moves.
 * Each grid move is penalized based on the amount of terrain within the grid.
 *
 * @param {Point} a                     Starting point for the segment
 * @param {Point} b                     Ending point for the segment
 * @param {Token} token                 Token that is moving.
 * @param {boolean} [gridless=false]    If true, use the euclidean distance, ignoring grid.
 * @param {boolean} [useAllElevation=true]  If true, on gridless ensure elevation at end is b.z.
 * @returns {object}
 *  - {number} distance       Distance measurement
 *  - {number} moveDistance   Distance after move penalty applied.
 *  A segment wholly within a square may be 0 distance.
 */
export function measureMoveDistance(a, b, token, { gridless = false, useAllElevation = true, stopTarget } = {}) {
  gridless ||= canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
  a = Point3d.fromObject(a);
  b = Point3d.fromObject(b);
  if ( gridless ) return gridlessMoveDistance(a, b, token, { stopTarget });
  else return griddedMoveDistance(a, b, token, { useAllElevation, stopTarget });
}

/**
 * Calculate the move distance for gridless.
 * @param {PIXI.Point|Point3d} a                      Starting point for the segment
 * @param {PIXI.Point|Point3d} b                      Ending point for the segment
 * @param {Token} token                       Token that is moving.
 * @returns {object}
 *  - {number} distance       Distance measurement in grid units.
 *  - {number} moveDistance   Distance after move penalty applied.
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
 * @param {RulerMeasurementSegment} segment       Segment, with ray property, to split
 * @param {number} splitMoveDistance              Distance, in grid units, of the desired first subsegment move distance
 * @param {Token} token                           Token to use when measuring move distance
 * @returns {Point3d}
 */
function findGridlessBreakpoint(a, b, token, splitMoveDistance) {
  // Binary search to find a reasonably close t value for the split move distance.
  // Because the move distance can vary depending on terrain.
  const MAX_ITER = 20;
  const { moveDistance: fullMoveDistance } = gridlessMoveDistance(A, B, token);

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
 * Calculate the move distance for gridded.
 * Similar to measureDistance.
 * @param {Point3d} a                      Starting point for the segment
 * @param {Point3d} b                      Ending point for the segment
 * @returns {object}
 *  - {number} distance       Distance measurement in grid units.
 *  - {number} moveDistance   Distance after move penalty applied.
 */
function griddedMoveDistance(a, b, token, { useAllElevation = true, stopTarget } = {}) {
  const iter = iterateGridUnderLine(a, b);
  let prev = iter.next().value;
  if ( !prev ) return 0; // Should never happen, as passing the same point as a,b returns a single square.

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
 * Helper to get the number of grid moves: horizontal, vertical, diagonal.
 * @param {PIXI.Point|Point3d} a                 Starting point for the segment
 * @param {PIXI.Point|Point3d} b                   Ending point for the segment
 * @returns {Uint32Array[4]|0} Counts of changes: none, vertical, horizontal, diagonal.
 */
function countGridMoves(a, b) {
  const iter = iterateGridUnderLine(a, b);
  let prev = iter.next().value;
  if ( !prev ) return 0; // Should never happen, as passing the same point as a,b returns a single square.

  // No change, vertical change, horizontal change, diagonal change.
  const changeCount = new Uint32Array([0, 0, 0, 0]);
  if ( prev ) {
    for ( const next of iter ) {
      const xChange = prev[1] !== next[1]; // Column is x
      const yChange = prev[0] !== next[0]; // Row is y
      changeCount[((xChange * 2) + yChange)] += 1;
      prev = next;
    }
  }
  const elevSteps = numElevationGridSteps(Math.abs(b.z - a.z));
  return elevationChangeCount(elevSteps, changeCount);
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
 * Get speed multiplier for tokens between two points, assuming gridless.
 * Multiplier based on the percentage of the segment that overlaps 1+ tokens.
 * @param {PIXI.Point} a                  Starting point for the segment
 * @param {PIXI.Point} b                    Ending point for the segment
 * @param {Token} token                       Token to use
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

/**
 * Return a function that tracks the grid steps from a previous square/hex to a new square/hex.
 * The function returns the distance and move distance for a given move.
 * @param {Token} token
 * @returns {function}
 *   - @param {Array[2]} next    column, grid of the next square
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
    : doTokensOverlap(tokens, gridShape, prevElev, currElev);

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
      : doTokensOverlap(tokens, gridShape, prevElev, currElev);

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

/**
 * Determine if at least one token overlaps this grid square/hex.
 * @param {PIXI.Rectangle|PIXI.Polygon} gridShape
 * @param {number} prevElev     top/bottom of the grid
 * @param {number} currElev     top/bottom of the grid
 */
function doTokensOverlap(tokens, shape, prevElev = 0, currElev = 0) {
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
