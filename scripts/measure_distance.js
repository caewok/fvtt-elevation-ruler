/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI
*/
"use strict";

import { MODULES_ACTIVE, SPEED, MODULE_ID, FLAGS } from "./const.js";
import {
  iterateGridUnderLine,
  segmentBounds,
  gridShape } from "./util.js";
import { Settings } from "./settings.js";
import { Point3d } from "./geometry/3d/Point3d.js";
import { CenteredRectangle } from "./geometry/CenteredPolygon/CenteredRectangle.js";
import { CenteredPolygon } from "./geometry/CenteredPolygon/CenteredPolygon.js";
import { Ellipse } from "./geometry/Ellipse.js";

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
  // Sum the horizontal and vertical moves.
  let d = (changeCount.V + changeCount.H) * canvas.dimensions.distance;

  // Add diagonal distance based on varying diagonal rules.
  const diagAdder = diagonalDistanceAdder();
  d += diagAdder(changeCount.D);

  return d;
}

/**
 * Additional distance for diagonal moves.
 * @returns {function}
 *  - @param {number} nDiag
 *  - @returns {number} Diagonal distance. Accounts for alternating rules.
 */
function diagonalDistanceAdder() {
  const distance = canvas.dimensions.distance;
  const diagonalMult = diagonalDistanceMultiplier();
  const diagonalDist = distance * diagonalMult;
  const diagonalRule = canvas.grid.grid.diagonals;
  const D = CONST.GRID_DIAGONALS;
  switch ( diagonalRule ) {
    case D.ALTERNATING_1: {
      let totalDiag = 0;
      return nDiag => {
        const pastOdd = totalDiag % 2;
        const nEven = ~~(nDiag * 0.5) + pastOdd;
        totalDiag += nDiag;
        return (nDiag + nEven) * diagonalDist;
      };
    }

    case D.ALTERNATING_2: {
      let totalDiag = 0;
      return nDiag => {
        // Adjust if the past total puts us on an even square
        const pastOdd = totalDiag % 2;
        const nOdd = Math.ceil(nDiag * 0.5) - pastOdd;
        totalDiag += nDiag;
        return (nDiag + nOdd) * diagonalDist;
      };

    }
    default: return nDiag => nDiag * diagonalDist;
  }
}

/**
 * Determine the diagonal distance multiplier.
 */
function diagonalDistanceMultiplier() {
  if ( canvas.grid.isHexagonal || canvas.grid.isGridless ) return Math.SQRT2;
  const D = CONST.GRID_DIAGONALS;
  switch ( canvas.grid.grid.diagonals ) {
    case D.EQUIDISTANT: return 1;
    case D.EXACT: return Math.SQRT2;
    case D.APPROXIMATE: return 1.5;
    case D.RECTILINEAR: return 2;
    case D.ILLEGAL: return 2;  // Move horizontal + vertical for every diagonal
    default: return 1;
  }
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
  const drawingPenalty = terrainDrawingGridlessMoveMultiplier(a, b);
  const d = CONFIG.GeometryLib.utils.pixelsToGridUnits(Point3d.distanceBetween(a, b));
  return {
    distance: d,
    moveDistance: d * terrainPenalty * tokenPenalty * drawingPenalty,
    endElevationZ: b.z,
    endPoint: b,
    terrainPenalty,
    tokenPenalty,
    drawingPenalty
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
  return percentagePenaltyShapeIntersection(a, b, tokens.map(t => t.constrainedTokenBorder), mult);
}

/**
 * Get speed multiplier for drawings between two points, assuming gridless.
 * Multiplier based on the percentage of the segment that overlaps 1+ drawings.
 * @param {Point3d} a                     Starting point for the segment
 * @param {Point3d} b                     Ending point for the segment
 * @returns {number} Percent penalty
 */
function terrainDrawingGridlessMoveMultiplier(a, b) {
  // Find drawings along the ray whose borders intersect the ray.
  const bounds = segmentBounds(a, b);
  const collisionTest = o => o.t.bounds.lineSegmentIntersects(a, b, { inside: true });
  const drawings = canvas.drawings.quadtree.getObjects(bounds, { collisionTest })
    .filter(d => hasActiveDrawingTerrain(d, b.z ?? 0, a.z ?? 0));
  if ( !drawings.size ) return 1;

  // Determine the percentage of the ray that intersects the constrained token shapes.
  return percentagePenaltyShapeIntersection(
    a,
    b,
    drawings.map(d => shapeForDrawing(d)),
    drawings.map(d => d.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY) || 1 )
  );
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
  let prevGridCoords = iter.next().value.gridCoords;

  // Should never happen, as passing the same point as a,b returns a single square.
  if ( !prevGridCoords ) {
    console.warn("griddedMoveDistance|iterateGridMoves return undefined first value.");
    return 0;
  }

  // Step over each grid shape in turn.
  const diagAdder = diagonalDistanceAdder();
  const { distance, size } = canvas.scene.dimensions;
  let dTotal = 0;
  let dMoveTotal = 0;
  let prevElev = a.z;
  let elevSteps = 0;
  let tokenMovePenalty = false;
  let terrainMovePenalty = false;
  let drawingMovePenalty = false;
  for ( const { movementChange, gridCoords } of iter ) {
    adjustGridMoveForElevation(movementChange);
    const currElev = prevElev + (movementChange.E * size); // In pixel units.

    // Determine move penalty.
    const terrainPenalty = griddedTerrainMovePenalty(token, gridCoords, prevGridCoords, currElev, prevElev);
    const tokenPenalty = griddedMovePenalty(gridCoords, prevGridCoords, { currElev, prevElev, token });
    const drawingPenalty = griddedMovePenalty(gridCoords, prevGridCoords, { currElev, prevElev });
    if ( !tokenPenalty || tokenPenalty < 0 ) console.warn("griddedMoveDistance", { tokenPenalty });
    if ( !terrainPenalty || terrainPenalty < 0 ) console.warn("griddedMoveDistance", { terrainPenalty });
    if ( !drawingPenalty || drawingPenalty < 0 ) console.warn("griddedMoveDistance", { drawingPenalty });

    // Calculate the distance for this step.
    let d = (movementChange.V + movementChange.H) * distance;
    d += diagAdder(movementChange.D);

    // Apply move penalty, if any.
    const dMove = d * (tokenPenalty * terrainPenalty * drawingPenalty);

    // Early stop if the stop target is met.
    if ( stopTarget && (dMoveTotal + dMove) > stopTarget ) break;

    // Update distance totals.
    dTotal += d;
    dMoveTotal += dMove;
    elevSteps += movementChange.E;

    // Cycle to next.
    prevGridCoords = gridCoords;
    prevElev = currElev;
    terrainMovePenalty ||= (terrainPenalty !== 1);
    tokenMovePenalty ||= (tokenPenalty !== 1);
    drawingMovePenalty ||= (drawingPenalty !== 1);
  }

  // Handle remaining elevation change, if any, by moving directly up/down.
  const targetElevSteps = numElevationGridSteps(Math.abs(b.z - a.z));
  let elevStepsNeeded = Math.max(targetElevSteps - elevSteps, 0);
  if ( useAllElevation && !stopTarget && elevStepsNeeded ) {
    // Determine move penalty.
    const terrainPenalty = griddedTerrainMovePenalty(token, prevGridCoords, prevGridCoords, b.z, prevElev);
    const tokenPenalty = griddedMovePenalty(prevGridCoords, prevGridCoords, { currElev: b.z, prevElev, token });
    const drawingPenalty = griddedMovePenalty(prevGridCoords, prevGridCoords, { currElev: b.z, prevElev });
    const d = elevStepsNeeded * distance;
    dTotal += d;
    dMoveTotal += (d * (tokenPenalty * terrainPenalty * drawingPenalty));
    elevStepsNeeded = 0;
    prevElev = b.z;
    terrainMovePenalty ||= (terrainPenalty !== 1);
    tokenMovePenalty ||= (tokenPenalty !== 1);
    drawingMovePenalty ||= (drawingPenalty !== 1);
  }

  // Force to not go beyond b.z.
  if ( b.z > a.z ) prevElev = Math.min(b.z, prevElev);
  else if ( b.z < a.z ) prevElev = Math.max(b.z, prevElev);
  else prevElev = b.z;

  return {
    distance: dTotal,
    moveDistance: dMoveTotal,
    remainingElevationSteps: elevStepsNeeded,
    endElevationZ: prevElev,
    endGridCoords: prevGridCoords,
    tokenMovePenalty,
    terrainMovePenalty,
    drawingMovePenalty
  };
}

/**
 * Helper to adjust a single grid move by elevation change.
 * If moving horizontal or vertical with elevation, move diagonally instead.
 * If moving diagonally, include elevation move in that diagonal move.
 * Sum the remaining elevation and add to diagonal.
 * @param {object} gridMove
 * @returns {gridMove} For convenience. Modified in place.
 */
function adjustGridMoveForElevation(gridMove) {
  let totalE = gridMove.E;
  let totalD = gridMove.D;
  // Move one elevation step per diagonal.
  while ( totalE > 0 && totalD > 0 ) {
    totalE -= 1;
    totalD -= 1;
  }

  if ( canvas.grid.grid.diagonals !== CONST.GRID_DIAGONALS.ILLEGAL ) {
    // Move one elevation step per horizontal, changing horizontal to diagonal.
    while ( totalE > 0 && gridMove.H > 0 ) {
      totalE -= 1;
      gridMove.H -= 1;
      gridMove.D += 1;
    }

    // Move one elevation step per vertical, changing vertical to diagonal.
    while ( totalE > 0 && gridMove.V > 0 ) {
      totalE -= 1;
      gridMove.V -= 1;
      gridMove.D += 1;
    }
  }

  // All other elevation moves, if any, can be vertical.
  gridMove.V += totalE;

  return gridMove;
}

/**
 * Count the number of horizontal, vertical, diagonal, elevation grid moves.
 * Adjusts vertical and diagonal for elevation.
 * @param {PIXI.Point|Point3d} a                 Starting point for the segment
 * @param {PIXI.Point|Point3d} b                   Ending point for the segment
 * @returns {Uint32Array[4]|0} Counts of changes: none, vertical, horizontal, diagonal.
 */
export function sumGridMoves(a, b) {
  const iter = iterateGridMoves(a, b);
  const totalChangeCount = { NONE: 0, H: 0, V: 0, D: 0, E: 0 };
  for ( const move of iter ) {
    const movementChange = move.movementChange;
    adjustGridMoveForElevation(movementChange);
    Object.keys(totalChangeCount).forEach(key => totalChangeCount[key] += movementChange[key]);
  }
  return totalChangeCount;
}

/**
 * Count number of grid spaces needed for an elevation change.
 * @param {number} elevZ      Elevation in pixel units
 * @returns {number} Number of grid steps
 */
function numElevationGridSteps(elevZ) {
  const gridE = CONFIG.GeometryLib.utils.pixelsToGridUnits(elevZ || 0);
  return Math.ceil(gridE / canvas.dimensions.distance);
}

/**
 * Determine the percentage of the ray that intersects a set of shapes.
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @param {Set<PIXI.Polygon|PIXI.Rectangle>|Array} [shapes=[]]
 * @param {number[]} [penalties]
 * @returns {number}
 */
function percentagePenaltyShapeIntersection(a, b, shapes, penalties) { // eslint-disable-line default-param-last
  if ( !shapes ) return 1;

  if ( !Array.isArray(shapes) ) shapes = [...shapes];
  const nShapes = shapes.length;
  if ( !nShapes ) return 1;

  if ( Number.isNumeric(penalties) ) penalties = Array(nShapes).fill(penalties ?? 1);
  if ( !Array.isArray(penalties) ) penalties = [...penalties];

  const tValues = [];
  const deltaMag = b.to2d().subtract(a).magnitude();

  // Determine the percentage of the a|b segment that intersects the shapes.
  for ( let i = 0; i < nShapes; i += 1 ) {
    const shape = shapes[i];
    const penalty = penalties[i] ?? 1;
    let inside = false;
    if ( shape.contains(a.x, a.y) ) {
      inside = true;
      tValues.push({ t: 0, inside, penalty });
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
      tValues.push({ t: ix.t0, inside, penalty });
    });
  }

  // Sort tValues and calculate distance between inside start/end.
  // May be multiple inside/outside entries.
  tValues.sort((a, b) => a.t0 - b.t0);
  let nInside = 0;
  let prevT = 0;
  let distInside = 0;
  let distOutside = 0;
  let penaltyDistInside = 0;
  let currPenalty = 1;
  for ( const tValue of tValues ) {
    if ( tValue.inside ) {
      nInside += 1;
      if ( !tValue.t ) {
        currPenalty *= tValue.penalty;
        continue; // Skip because t is 0 so no distance moved yet.
      }

      // Calculate distance for this segment
      const startPt = a.projectToward(b, prevT ?? 0);
      const endPt = a.projectToward(b, tValue.t);
      const dist = Point3d.distanceBetween(startPt, endPt);
      if ( nInside === 1 ) distOutside += dist;
      else {
        distInside += dist;
        penaltyDistInside += (dist * currPenalty); // Penalty before this point.
      }

      // Cycle to next.
      currPenalty *= tValue.penalty;
      prevT = tValue.t;

    } else if ( nInside > 2 ) {  // !tValue.inside
      nInside -= 1;

      // Calculate distance for this segment
      const startPt = a.projectToward(b, prevT ?? 0);
      const endPt = a.projectToward(b, tValue.t);
      const dist = Point3d.distanceBetween(startPt, endPt);
      distInside += dist;
      penaltyDistInside += (dist * currPenalty); // Penalty before this point.

      // Cycle to next.
      currPenalty *= (1 / tValue.penalty);
      prevT = tValue.t;
    }
    else if ( nInside === 1 ) { // Inside is false and we are now outside.
      nInside = 0;

      // Calculate distance for this segment
      const startPt = a.projectToward(b, prevT);
      const endPt = a.projectToward(b, tValue.t);
      const dist = Point3d.distanceBetween(startPt, endPt);
      distInside += dist;
      penaltyDistInside += (dist * currPenalty); // Penalty before this point.


      // Cycle to next.
      currPenalty *= (1 / tValue.penalty);
      prevT = tValue.t;
    }
  }

  // If still inside, we can go all the way to t = 1
  const startPt = a.projectToward(b, prevT);
  const dist = Point3d.distanceBetween(startPt, b);
  if ( nInside > 0 ) {
    distInside += dist;
    penaltyDistInside += (dist * currPenalty); // Penalty before this point.
  } else distOutside += dist;


  if ( !distInside ) return 1;

  const totalDistance = Point3d.distanceBetween(a, b);
  return (distOutside + penaltyDistInside) / totalDistance;
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
  const ixArea = intersection.area;
  totalArea ??= areaShape.area;
  return ixArea / totalArea;
}

// ----- NOTE: Movement penalty methods ----- //


/**
 * Determine whether this grid space applies a move penalty/bonus because one or more drawings or tokens occupy it.
 * @param {number[2]} currGridCoords        The row,col coordinates for the grid space to test
 * @param {number[2]} [prevGridCoords]      Previous grid coordinates; required for Euclidean setting; otherwise ignored
 * @param {object} [opts]                   Options needed for some settings
 * @param {number} [opts.currElev=0]                Elevation at current grid point, in pixel units
 * @param {number} [opts.prevElev=0]                Elevation at current grid point, in pixel units
 * @param {Token} [opts.token]                      If using token measurement, token to exclude
 * @returns {number} Percent move penalty to apply. Returns 1 if no penalty.
 */
function griddedMovePenalty(currGridCoords, prevGridCoords, { currElev = 0, prevElev = 0, token } = {}) {
  let mult;
  let objectBoundsFn;
  let filterFn;
  let quadtree;
  if ( token ) {
    mult = Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER);
    objectBoundsFn = t => t.constrainedTokenBorder;
    filterFn = t => currElev.between(t.bottomZ, t.topZ);
    quadtree = canvas.tokens.quadtree;
  } else {
    objectBoundsFn = shapeForDrawing;
    filterFn = hasActiveDrawingTerrain;
    quadtree = canvas.drawings.quadtree;
  }
  if ( mult === 1 ) return 1;

  // Get the bounds and collision test for the algorithm type.
  const GT = Settings.KEYS.GRID_TERRAIN;
  const alg = Settings.get(GT.ALGORITHM);
  let collisionTest;
  let bounds;
  let currCenter;
  let prevCenter;
  switch ( alg ) {
    case GT.CHOICES.CENTER: {
      const shape = gridShape(currGridCoords);
      currCenter = canvas.grid.grid.getCenterPoint(currGridCoords);
      collisionTest = o => objectBoundsFn(o.t).contains(currCenter.x, currCenter.y);
      bounds = shape.getBounds();
      break;
    }

    case GT.CHOICES.PERCENT: {
      const shape = gridShape(currGridCoords);
      const percentThreshold = Settings.get(GT.AREA_THRESHOLD);
      const totalArea = shape.area;
      collisionTest = o => percentOverlap(objectBoundsFn(o.t), shape, totalArea) >= percentThreshold;
      bounds = shape.getBounds();
      break;
    }

    case GT.CHOICES.EUCLIDEAN: {
      currCenter = canvas.grid.grid.getCenterPoint(currGridCoords);
      currCenter = Point3d.fromObject(currCenter);
      currCenter.z = currElev;

      prevCenter = canvas.grid.grid.getCenterPoint(prevGridCoords);
      prevCenter = Point3d.fromObject(prevCenter);
      prevCenter.z = prevElev;

      const fn = token ? terrainTokenGridlessMoveMultiplier : terrainDrawingGridlessMoveMultiplier;
      return fn(prevCenter, currCenter, token);
    }
  }

  // Check that the drawing has a movement penalty and is within elevation.
  // Infinite elevations mean all elevations count
  prevElev = undefined; // So hasActiveDrawingTerrain works.
  const objects = quadtree.getObjects(bounds, { collisionTest })
    .filter(o => filterFn(o, currElev, prevElev));
  if ( token ) objects.delete(token);
  if ( !objects.size ) return 1;
  return token ? mult : calculateDrawingsMovePenalty(objects);
}


/**
 * Helper to calculate the percentage penalty for a set of drawings.
 * @param {Set<Drawing>} drawings
 * @returns {number}
 */
function calculateDrawingsMovePenalty(drawings) {
  return drawings.reduce((acc, curr) => {
    const penalty = curr.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY) || 1;
    return acc * penalty;
  }, 1);
}

/** Helper to calculate a shape for a given drawing.
 * @param {Drawing} drawing
 * @returns {CenteredPolygon|CenteredRectangle|PIXI.Circle}
 */
function shapeForDrawing(drawing) {
  switch ( drawing.type ) {
    case Drawing.SHAPE_TYPES.RECTANGLE: return CenteredRectangle.fromDrawing(drawing);
    case Drawing.SHAPE_TYPES.POLYGON: return CenteredPolygon.fromDrawing(drawing);
    case Drawing.SHAPE_TYPES.ELLIPSE: return Ellipse.fromDrawing(drawing);
    default: return drawing.bounds;
  }
}

/**
 * Helper to test if a drawing has a terrain that is active for this elevation.
 * @param {Drawing} drawing       Placeable drawing to test
 * @param {number} currElev       Elevation to test
 * @param {number} [prevElev]     If defined, drawing must be between prevElev and currElev.
 *   If not defined, drawing must be at currElev
 * @returns {boolean}
 */
function hasActiveDrawingTerrain(drawing, currElev, prevElev) {
  if ( !drawing.document.getFlag(MODULE_ID, FLAGS.MOVEMENT_PENALTY) ) return false;
  const drawingE = foundry.utils.getProperty(drawing.document, "flags.elevatedvision.elevation");
  if ( typeof drawingE === "undefined" ) return true;

  const drawingZ = CONFIG.GeometryLib.utils.gridUnitsToPixels(drawingE);
  if ( typeof prevElev === "undefined" ) return currElev.almostEqual(drawingZ);
  return drawingZ.between(prevElev, currElev);
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
      const currCenter = Point3d.fromObject(canvas.grid.grid.getCenterPoint(currGridCoords));
      currCenter.z = currElev;
      return Terrain.percentMovementChangeForTokenAtPoint(token, currCenter, speedAttribute);
    }

    case GT.CHOICES.PERCENT: {
      const shape = gridShape(currGridCoords);
      const percentThreshold = Settings.get(GT.AREA_THRESHOLD);
      return Terrain.percentMovementChangeForTokenWithinShape(token, shape,
        percentThreshold, speedAttribute, currElev);
    }

    case GT.CHOICES.EUCLIDEAN: {
      const currCenter = Point3d.fromObject(canvas.grid.grid.getCenterPoint(currGridCoords));
      const prevCenter = Point3d.fromObject(canvas.grid.grid.getCenterPoint(prevGridCoords));
      currCenter.z = currElev;
      prevCenter.z = prevElev;
      return Terrain.percentMovementForTokenAlongPath(token, prevCenter, currCenter, speedAttribute);
    }
  }
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
  if ( !token ) return 1;
  const terrainAPI = MODULES_ACTIVE.API.TERRAIN_MAPPER;
  if ( !terrainAPI || !token ) return 1;
  return terrainAPI.Terrain.percentMovementForTokenAlongPath(token, a, b) || 1;
}


// ----- NOTE: Helper methods ----- //


/**
 * From a given origin, move horizontally the total 2d distance between A and B.
 * Then move vertically up/down in elevation.
 * Return an iterator for that movement.
 * @param {Point3d} origin
 * @param {Point3d} destination
 * @return Iterator, which in turn
 *   returns [row, col] Array for each grid point under the line.
 */
export function iterateGridProjectedElevation(origin, destination) {
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
  const xChange = (prevGridCoord.j !== nextGridCoord.j) || (prevGridCoord.x !== nextGridCoord.x);
  const yChange = (prevGridCoord.i !== nextGridCoord.i) || (prevGridCoord.y !== nextGridCoord.y);
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
export function iterateGridMoves(origin, destination) {
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
  let movementChange = { NONE: 0, H: 0, V: 0, D: 0, E: 0 };

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
  movementChange = { NONE: 0, H: 0, V: 0, D: 0, E: 0 }; // Copy; don't keep same object.

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
        movementChange = { NONE: 0, H: 0, V: 0, D: 0, E: 0 };
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
  let movementChange = { NONE: 0, H: 0, V: 0, D: 0, E: 0 };

  yield {
    movementChange,
    gridCoords: prev2d
  };

  movementChange = { NONE: 0, H: 0, V: 0, D: 0, E: 0 }; // Copy; don't keep same object.

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
      case "D": movementChange.E += 1;
      case "H": {  // eslint-disable-line no-fallthrough
        const next2d = iter2d.next().value ?? prev2d;
        const moveType = gridChangeType(prev2d, next2d);
        prev2d = next2d;
        movementChange[moveType] += 1;
        yield {
          movementChange,
          gridCoords: next2d
        };
        movementChange = { NONE: 0, H: 0, V: 0, D: 0, E: 0 };
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
api = game.modules.get("elevationruler").api
iterateGridUnderLine = api.iterateGridUnderLine
iterateGridProjectedElevation = api.iterateGridProjectedElevation
iterateGridMoves = api.iterateGridMoves
sumGridMoves = api.sumGridMoves

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
  rulerShapes.push(gridShape([gridCoords[i][0], gridCoords[i][1]]))
}
rulerShapes.forEach(shape => Draw.shape(shape, { color: Draw.COLORS.green }))

Draw.point(origin);
Draw.point(destination)

moveArr = gridMoves.map(elem => elem.movementChange);
console.table(moveArr)

sumGridMoves(origin, destination)

*/
