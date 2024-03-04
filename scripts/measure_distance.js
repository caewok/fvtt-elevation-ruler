/* globals
canvas,
CONFIG,
CONST,
Drawing,
foundry,
PIXI,
Ruler
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULES_ACTIVE, SPEED, MODULE_ID, FLAGS } from "./const.js";
import {
  segmentBounds,
  gridShape,
  getCenterPoint3d,
  canvasElevationFromCoordinates,
  unitElevationFromCoordinates,
  pointFromGridCoordinates } from "./util.js";
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
 * @param {GridCoordinates3d} a                     Starting point for the segment
 * @param {GridCoordinates3d} b                     Ending point for the segment
 * @param {boolean} [gridless=false]    If true, use the euclidean distance, ignoring grid.
 * @returns {number} Distance in grid units.
 *  A segment wholly within a square may be 0 distance.
 *  Instead of mathematical shortcuts from center, actual grid squares are counted.
 *  Euclidean on a grid also uses grid squares, but measures using actual diagonal from center to center.
 */
export function measureDistance(a, b, { gridless = false } = {}) {
  gridless ||= canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
  if ( gridless ) {
    a = pointFromGridCoordinates(a);
    b = pointFromGridCoordinates(b);
    return CONFIG.GeometryLib.utils.pixelsToGridUnits(Point3d.distanceBetween(a, b));
  }

  // Convert each grid step into a distance value.
  // Sum the horizontal and vertical moves.
  const changeCount = sumGridMoves(a, b);
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
 * @param {GridCoordinates3d} a                     Starting point for the segment
 * @param {GridCoordinates3d} b                     Ending point for the segment
 * @param {Token} token                 Token that is moving.
 * @param {boolean} [gridless=false]    If true, use the euclidean distance, ignoring grid.
 * @param {boolean} [useAllElevation=true]  If true, on gridless ensure elevation at end is b.z.
 * @returns {GriddedMoveDistanceMeasurement|GridlessMoveDistanceMeasurement}
 */
export function measureMoveDistance(a, b, token,
  { gridless = false, useAllElevation = true, stopTarget, penaltyFn } = {}) {

  gridless ||= canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
  a = Point3d.fromObject(a);
  b = Point3d.fromObject(b);
  if ( gridless ) return gridlessMoveDistance(a, b, token, { stopTarget, penaltyFn });
  else return griddedMoveDistance(a, b, token, { useAllElevation, stopTarget, penaltyFn });
}

// ----- NOTE: Gridless ----- //

/**
 * Calculate the move distance for gridless.
 * @param {GridCoordinates3d} a              Starting point for the segment
 * @param {GridCoordinates3d} b              Ending point for the segment
 * @param {Token} [token]                     Token that is moving.
 * @param {object} [opts]                     Options that affect the measurement
 * @param {number} [opts.stopTarget]          Maximum move distance, in canvas scene units, to measure.
 *   If set, the measurement may terminate early.
 *   This can be used to project a ray from point a for a specific move distance.
 * @returns {GridlessMoveDistanceMeasurement}
 */
function gridlessMoveDistance(a, b, token, { stopTarget, penaltyFn, useAllElevation = true } = {}) {
  penaltyFn ??= movePenaltyFn();
  a = pointFromGridCoordinates(a);
  b = pointFromGridCoordinates(b);

  // Recursively calls gridlessMoveDistance without a stop target to find a breakpoint.
  if ( stopTarget ) {
    const fullZ = b.z;
    b = findGridlessBreakpoint(a, b, token, stopTarget, { penaltyFn });
    if ( useAllElevation ) b.z = fullZ;
  }

  // Determine penalty proportion of the a|b segment.
  const penalty = penaltyFn(a, b, token);
  const d = CONFIG.GeometryLib.utils.pixelsToGridUnits(Point3d.distanceBetween(a, b));
  return {
    distance: d,
    moveDistance: d * penalty,
    endGridCoords: b
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
function findGridlessBreakpoint(a, b, token, splitMoveDistance, opts = {}) {
  // Binary search to find a reasonably close t value for the split move distance.
  // Because the move distance can vary depending on terrain.
  const MAX_ITER = 20;
  const { moveDistance: fullMoveDistance } = gridlessMoveDistance(a, b, token, opts);

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
function terrainTokenGridlessMoveMultiplier(a, b, token, mult) {
  mult ??= Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER);
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

/* Testing
Point3d = CONFIG.GeometryLib.threeD.Point3d
Draw = CONFIG.GeometryLib.Draw
a = _token.center;
b = _token.center;
coords = gridUnder2dLine(a, b)
coords.forEach(c => Draw.point(canvas.grid.getCenterPoint(c)))

b.z = 300
coords = gridUnder3dLine(a, b)

*/

/**
 * Get the grid coordinates for a segment between origin and destination.
 * Supplies coordinates in 3 dimensions.
 * @param {GridCoordinates3d} origin        Origination point
 * @param {GridCoordinates3d} destination   Destination point
 * @returns {GridCoordinates3d[]} Array containing each grid point under the line.
 *   For gridless, returns the GridCoordinates of the origin and destination.
 */
export function gridUnder3dLine(origin, destination) {
  // If no elevatin change, return the 2d version.
  const originK = unitElevationFromCoordinates(origin);
  const destK = unitElevationFromCoordinates(destination);
  const elevSign = Math.sign(destK - originK);
  if ( !elevSign ) return gridUnder2dLine(origin, destination).map(pt => {
    pt.k = originK;
    return pt;
  });

  // For gridless, this is simply the origin and destination points, with scene elevation.
  if ( canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ) {
    const pts = gridUnder2dLine(origin, destination);
    pts[0].k = originK;
    pts[1].k = destK;
    return pts;
  }

  // Retrieve iterator for the 2d canvas points and the elevation representation from the projection.
  const pts2dIter = gridUnder2dLine(origin, destination).values();
  const projPtsIter = projectedGridUnder3dLine(origin, destination).values();

  // Link the pts to the projected point movement.
  // If vertical projection, increment elevation only.
  // If diagonal or horizontal, increment both elevation and grid step.
  // Flip horizontal/vertical for hex rows.
  const diagAllowed = canvas.grid.grid.diagonals !== CONST.GRID_DIAGONALS.ILLEGAL;
  const [elevOnlyMove, canvasOnlyMove] = isHexRow() ? ["H", "V"] : ["V", "H"];
  let prevProjPt = projPtsIter.next().value;
  let prevPt = pts2dIter.next().value;

  // Start by adding the origin point at the origin elevation.
  prevPt.k = originK;
  const resPts = [prevPt];

  const elevationOnlyStep = () => {
    prevPt = {...prevPt};
    prevPt.k += elevSign;
    resPts.push(prevPt);
  };

  const canvasStep = (elevStep = 0) => {
    const currPt2d = pts2dIter.next().value;
    if ( !currPt2d ) {
      if ( elevStep ) elevationOnlyStep();
      return false;
    }
    currPt2d.k = prevPt.k + elevStep;
    resPts.push(currPt2d);
    prevPt = currPt2d;
    return true;
  };

  const dualStep = diagAllowed
    ? () => canvasStep(elevSign)
    : () => {
      canvasStep(0);
      elevationOnlyStep();
    };

  // Cycle through each elevation change. If moving both elevation and 2d, or just 2d,
  // increment to the next 2d point. Otherwise add an interval point with the elevation-only change.
  for ( const nextProjPt of projPtsIter ) {
    const elevChangeType = gridChangeType(prevProjPt, nextProjPt);
    switch ( elevChangeType ) {
      case elevOnlyMove: elevationOnlyStep(); break;
      case canvasOnlyMove: canvasStep(0); break;
      case "NONE": console.warn("gridUnder3dLine|unexpected elevOnlyMoveType === NONE"); break;
      default: dualStep(); break;
    }
    prevProjPt = nextProjPt;
  }

  // Add in remaining 2d moves, if any.
  while ( canvasStep(0) ) { } // eslint-disable-line no-empty

  return resPts;
}

/**
 * Move penalty for tokens measured from the center.
 */
function _gridCenterTokenMovePenalty(currGridCoords, prevGridCoords, token, mult) {
  mult ??= Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER);
  const objectBoundsFn = t => t.constrainedTokenBorder;
  const filterFn = (t, currZ, _prevZ) => currZ.between(t.bottomZ && t.topZ);
  const tokens = _getMoveObjectsCenterGrid(
    currGridCoords,
    prevGridCoords,
    canvas.tokens.quadtree,
    objectBoundsFn,
    filterFn);
  tokens.delete(token);
  return tokens.size ? mult : 1;
}

/**
 * Move penalty for tokens measured using percent area.
 */
function _gridPercentTokenMovePenalty(currGridCoords, prevGridCoords, token, mult) {
  mult ??= Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER);
  const objectBoundsFn = t => t.constrainedTokenBorder;
  const filterFn = (t, currZ, _prevZ) => currZ.between(t.bottomZ && t.topZ);
  const tokens = _getMoveObjectsPercentGrid(
    currGridCoords,
    prevGridCoords,
    canvas.tokens.quadtree,
    objectBoundsFn,
    filterFn);
  tokens.delete(token);
  return tokens.size ? mult : 1;
}

/**
 * Move penalty for tokens measured using euclidean distance between two grid centers.
 */
function _gridEuclideanTokenMovePenalty(currGridCoords, prevGridCoords, token, mult) {
  mult ??= Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER);
  const currCenter = getCenterPoint3d(prevGridCoords);
  const prevCenter = getCenterPoint3d(currGridCoords);
  return terrainTokenGridlessMoveMultiplier(prevCenter, currCenter, token, mult);
}

/**
 * Move penalty for drawings measured from the center.
 */
function _gridCenterDrawingMovePenalty(currGridCoords, prevGridCoords) {
  const drawings = _getMoveObjectsCenterGrid(
    currGridCoords,
    prevGridCoords,
    canvas.drawings.quadtree,
    shapeForDrawing,
    hasActiveDrawingTerrain);
  return calculateDrawingsMovePenalty(drawings);
}

/**
 * Move penalty for drawings measured using percent area.
 */
function _gridPercentDrawingMovePenalty(currGridCoords, prevGridCoords) {
  const drawings = _getMoveObjectsPercentGrid(
    currGridCoords,
    prevGridCoords,
    canvas.drawings.quadtree,
    shapeForDrawing,
    hasActiveDrawingTerrain);
  return calculateDrawingsMovePenalty(drawings);
}

/**
 * Move penalty for drawings measured using euclidean distance between two grid centers.
 */
function _gridEuclideanDrawingMovePenalty(currGridCoords, prevGridCoords) {
  const currCenter = getCenterPoint3d(prevGridCoords);
  const prevCenter = getCenterPoint3d(currGridCoords);
  return terrainDrawingGridlessMoveMultiplier(prevCenter, currCenter);
}

/**
 * Retrieve objects that have an overlap with the grid center.
 */
function _getMoveObjectsCenterGrid(currGridCoords, prevGridCoords, quadtree, objectBoundsFn, filterFn) {
  const shape = gridShape(currGridCoords);
  const bounds = shape.getBounds();
  const currCenter = getCenterPoint3d(currGridCoords);
  const prevZ = canvasElevationFromCoordinates(prevGridCoords);
  const collisionTest = o => shapeForDrawing(o.t).contains(currCenter.x, currCenter.y)
    && filterFn(o.t, currCenter.z, prevZ);
  return quadtree.getObjects(bounds, { collisionTest });
}

/**
 * Retrieve objects that have a percent overlap with the grid bounds.
 */
function _getMoveObjectsPercentGrid(currGridCoords, prevGridCoords, quadtree, objectBoundsFn, filterFn) {
  const currZ = canvasElevationFromCoordinates(currGridCoords);
  const prevZ = canvasElevationFromCoordinates(prevGridCoords);
  const shape = gridShape(currGridCoords);
  const bounds = shape.getBounds();
  const percentThreshold = Settings.get(Settings.KEYS.GRID_TERRAIN.AREA_THRESHOLD);
  const totalArea = shape.area;
  const collisionTest = o => percentOverlap(objectBoundsFn(o.t), shape, totalArea) >= percentThreshold
    && filterFn(o.t, currZ, prevZ);
  return quadtree.getObjects(bounds, { collisionTest });
}

/**
 * Move penalty for terrain measured from the center.
 */
function _gridCenterTerrainMovePenalty(currGridCoords, _prevGridCoords, token, Terrain) {
  const currCenter = getCenterPoint3d(currGridCoords);
  const speedAttribute = SPEED.ATTRIBUTES[token.movementType] ?? SPEED.ATTRIBUTES.WALK;
  Terrain.percentMovementChangeForTokenAtPoint(token, currCenter, speedAttribute);
}

/**
 * Move penalty for terrain measured using percent area.
 */
function _gridPercentTerrainMovePenalty(currGridCoords, _prevGridCoords, token, Terrain) {
  const currElev = canvasElevationFromCoordinates(currGridCoords);
  const shape = gridShape(currGridCoords);
  const percentThreshold = Settings.get(Settings.KEYS.GRID_TERRAIN.AREA_THRESHOLD);
  const speedAttribute = SPEED.ATTRIBUTES[token.movementType] ?? SPEED.ATTRIBUTES.WALK;
  return Terrain.percentMovementChangeForTokenWithinShape(token, shape, percentThreshold, speedAttribute, currElev);
}

/**
 * Move penalty for terrain measured using euclidean distance between two grid centers.
 */
function _gridEuclideanTerrainMovePenalty(currGridCoords, prevGridCoords, token, Terrain) {
  const currCenter = getCenterPoint3d(prevGridCoords);
  const prevCenter = getCenterPoint3d(currGridCoords);
  const speedAttribute = SPEED.ATTRIBUTES[token.movementType] ?? SPEED.ATTRIBUTES.WALK;
  return Terrain.percentMovementForTokenAlongPath(token, prevCenter, currCenter, speedAttribute);
}

/**
 * Returns a penalty function that can be used with griddedMoveDistance or gridlessMoveDistance.
 *
 * @param {GridCoordinates3d} prevCoord
 * @param {GridCoordinates3d} currCoord
 */
export function movePenaltyFn(gridless = false) {
  gridless ||= canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
  if ( gridless ) return _movePenaltyGridlessFn();
  return _movePenaltyGriddedFn();
}

/**
 * Returns a penalty function that can be used with gridlessMoveDistance.
 * @returns {function}
 *   - @param {GridCoordinates3d} a
 *   - @param {GridCoordinates3d} b
 *   - @param {Token} [token]                 Token doing the move. Required for token moves.
 *   - @returns {number} Percent penalty to apply for the move.
 */
function _movePenaltyGridlessFn() {
  const mult = Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER);
  const terrainAPI = MODULES_ACTIVE.API.TERRAIN_MAPPER;

  if ( mult !== 1 && terrainAPI ) { // Terrain, token, drawing
    return (a, b, token) => {
      const terrainPenalty = terrainMovePenalty(a, b, token);
      const tokenPenalty = terrainTokenGridlessMoveMultiplier(a, b, token);
      const drawingPenalty = terrainDrawingGridlessMoveMultiplier(a, b);
      return terrainPenalty * tokenPenalty * drawingPenalty;
    };
  }

  if ( mult !== 1 ) { // No terrain
    return (a, b, token) => {
      const tokenPenalty = terrainTokenGridlessMoveMultiplier(a, b, token);
      const drawingPenalty = terrainDrawingGridlessMoveMultiplier(a, b);
      return tokenPenalty * drawingPenalty;
    };
  }

  if ( terrainAPI ) { // No token
    return (a, b, token) => {
      const terrainPenalty = terrainMovePenalty(a, b, token);
      const drawingPenalty = terrainDrawingGridlessMoveMultiplier(a, b);
      return terrainPenalty * drawingPenalty;
    };
  }

  // Drawing only
  return (a, b, _token) => terrainDrawingGridlessMoveMultiplier(a, b);
}

/**
 * Returns a penalty function that can be used with griddedMoveDistance.
 * @returns {function}
 *   - @param {GridCoordinates3d} prevCoord
 *   - @param {GridCoordinates3d} currCoord
 *   - @param {Token} [token]                 Token doing the move. Required for token moves.
 *   - @returns {number} Percent penalty to apply for the move.
 */
function _movePenaltyGriddedFn() {
  /**
   * Enumerated objects of functions for different move penalty combinations.
   */
  const GRIDDED_ALGORITHM_FN = {
    [Settings.KEYS.GRID_TERRAIN.CHOICES.CENTER]: {
      Token: _gridCenterTokenMovePenalty,
      Drawing: _gridCenterDrawingMovePenalty,
      Terrain: _gridCenterTerrainMovePenalty
    },
    [Settings.KEYS.GRID_TERRAIN.CHOICES.PERCENT]: {
      Token: _gridPercentTokenMovePenalty,
      Drawing: _gridPercentDrawingMovePenalty,
      Terrain: _gridPercentTerrainMovePenalty
    },
    [Settings.KEYS.GRID_TERRAIN.CHOICES.EUCLIDEAN]: {
      Token: _gridEuclideanTokenMovePenalty,
      Drawing: _gridEuclideanDrawingMovePenalty,
      Terrain: _gridEuclideanTerrainMovePenalty
    }
  };

  const alg = Settings.get(Settings.KEYS.GRID_TERRAIN.ALGORITHM);
  const mult = Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER);
  const terrainAPI = MODULES_ACTIVE.API.TERRAIN_MAPPER;
  const penaltyFns = GRIDDED_ALGORITHM_FN[alg];

  if ( mult !== 1 && terrainAPI ) { // Terrain, token, drawing
    return (currGridCoords, prevGridCoords, token) => {
      const terrainPenalty = penaltyFns.Terrain(currGridCoords, prevGridCoords, token, terrainAPI.Terrain);
      const tokenPenalty = penaltyFns.Token(currGridCoords, prevGridCoords, token, mult);
      const drawingPenalty = penaltyFns.Drawing(currGridCoords, prevGridCoords);
      return terrainPenalty * tokenPenalty * drawingPenalty;
    };
  }

  if ( mult !== 1 ) { // No terrain
    return (currGridCoords, prevGridCoords, token) => {
      const tokenPenalty = penaltyFns.Token(currGridCoords, prevGridCoords, token, mult);
      const drawingPenalty = penaltyFns.Drawing(currGridCoords, prevGridCoords);
      return tokenPenalty * drawingPenalty;
    };
  }

  if ( terrainAPI ) { // No token
    return (currGridCoords, prevGridCoords, token) => {
      const terrainPenalty = penaltyFns.Terrain(currGridCoords, prevGridCoords, token, terrainAPI.Terrain);
      const drawingPenalty = penaltyFns.Drawing(currGridCoords, prevGridCoords);
      return terrainPenalty * drawingPenalty;
    };
  }
  // Drawing only
  return (currGridCoords, prevGridCoords, _token) => penaltyFns.Drawing(currGridCoords, prevGridCoords);
}


/**
 * Calculate the move distance for gridded.
 * Similar to measureDistance.
 * @param {GridCoordinates3d} a                      Starting point for the segment
 * @param {GridCoordinates3d} b                      Ending point for the segment
 * @param {Token} [token]                     Token that is moving.
 * @param {object} [opts]                     Options that affect the measurement
 * @param {number} [opts.stopTarget]          Maximum move distance, in grid units, to measure.
 * @param {boolean} [opts.useAllElevation]    If false, elevation will be decreased one grid unit
 *   for each step from a to b (or a to stopTarget). But remaining elevation, if any, will not
 *   be accounted for in the distance measurement or moveDistance measurement.
 *   Used for multiple segment moves, where elevation can be further decreased in a future segment move.
 * @returns {GriddedMoveDistanceMeasurement}
 */
function griddedMoveDistance(a, b, token, { useAllElevation = true, stopTarget, penaltyFn } = {}) {
  const iter = gridUnder3dLine(a, b).values();
  let prevGridCoords = iter.next().value;

  // Should never happen, as passing the same point as a,b returns a single square.
  if ( !prevGridCoords ) {
    console.warn("griddedMoveDistance|iterateGridMoves return undefined first value.");
    return 0;
  }

  // Step over each grid shape in turn. Change the distance by penalty amount.
  penaltyFn ??= _movePenaltyGriddedFn();
  let dTotal = 0;
  let dMoveTotal = 0;

  let currGridCoords;
  for ( currGridCoords of iter ) {
    const d = Ruler.measureDistance(prevGridCoords, currGridCoords);
    const penalty = penaltyFn(currGridCoords, prevGridCoords, token);
    const dMove = d * penalty;

    // Early stop if the stop target is met.
    if ( stopTarget && (dMoveTotal + dMove) > stopTarget ) break;

    // Cycle to next.
    dTotal += d;
    dMoveTotal += dMove;
    prevGridCoords = currGridCoords;
  }

  if ( useAllElevation && currGridCoords ) {
    const endGridCoords = { ...currGridCoords };
    endGridCoords.k = unitElevationFromCoordinates(b);
    const res = griddedMoveDistance(currGridCoords, endGridCoords, { penaltyFn, useAllElevation: false });
    dTotal += res.distance;
    dMoveTotal += res.moveDistance;
    currGridCoords = endGridCoords;
  }

  return {
    distance: dTotal,
    moveDistance: dMoveTotal,
    endGridCoords: currGridCoords
  };
}

/**
 * Count the number of horizontal, vertical, diagonal, elevation grid moves.
 * Adjusts vertical and diagonal for elevation.
 * @param {GridCoordinates3d} a                   Starting point for the segment
 * @param {GridCoordinates3d} b                   Ending point for the segment
 * @returns {Uint32Array[4]|0} Counts of changes: none, vertical, horizontal, diagonal.
 */
export function sumGridMoves(a, b) {
  const pts = gridUnder3dLine(a, b);
  const totalChangeCount = { NONE: 0, H: 0, V: 0, D: 0, E: 0 };
  let prevGridCoords = pts[0];
  const nPts = pts.length;
  for ( let i = 1; i < nPts; i += 1 ) {
    const currGridCoords = pts[i];
    const movementChange = gridChangeType3d(prevGridCoords, currGridCoords);
    Object.keys(totalChangeCount).forEach(key => totalChangeCount[key] += movementChange[key]);
  }
  return totalChangeCount;
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

/*
 * Get the grid coordinates for a segment between origin and destination.
 * @param {GridCoordinates} origin       Origination point
 * @param {GridCoordinates} destination  Destination point
 * @returns {GridCoordinates[]} Array containing each grid point under the line.
 *   For gridless, returns the GridCoordinates of the origin and destination.
 */
export function gridUnder2dLine(origin, destination) { return canvas.grid.getDirectPath([origin, destination]); }

/*
 * Get the grid coordinates for a 3d segment projected to 2d.
 * Projected in a specific manner such that a straight line move represents elevation-only travel.
 * For hex rows, this is a horizontal move. For hex columns or squares, this is a vertical move.
 * @param {GridCoordinates} origin       Origination point
 * @param {GridCoordinates} destination  Destination point
 * @returns {GridCoordinates[]} Array containing each grid point under the line.
 */
function projectedGridUnder3dLine(origin, destination) {
  // Determine the number of elevation steps.
  const cOrigin = getCenterPoint3d(origin);
  const cDest = getCenterPoint3d(destination);
  const zElev = cDest.z - cOrigin.z;

  // Projected distance.
  const dist2d = PIXI.Point.distanceBetween(cOrigin, cDest);
  const b = isHexRow()
    ? { x: cOrigin.x + zElev, y: cOrigin.y + dist2d }
    : { x: cOrigin.x + dist2d, y: cOrigin.y + zElev };
  return gridUnder2dLine(cOrigin, b);
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

function gridChangeType3d(prevGridCoord, nextGridCoord) {
  const zChange = (prevGridCoord.k !== nextGridCoord.k) || (prevGridCoord.z !== nextGridCoord.z);
  const res = { NONE: 0, H: 0, V: 0, D: 0, E: 0 };
  res[gridChangeType(prevGridCoord, nextGridCoord)] = 1;
  if ( zChange ) res.E = 1;
  return res;
}


/* Testing
api = game.modules.get("elevationruler").api
gridUnder2dLine = api.gridUnder2dLine
gridUnder3dLine = api.gridUnder3dLine
sumGridMoves = api.sumGridMoves

Draw = CONFIG.GeometryLib.Draw

gridUnder2dLine(origin, destination)
gridUnder3dLine(origin, destination)

destination.z = 200
gridUnder3dLine(origin, destination)

Ruler.measureDistance(origin, destination)
Ruler.measureDistance(origin, destination, { gridless: true })

Ruler.measureMoveDistance(origin, destination, _token)
Ruler.measureMoveDistance(origin, destination, _token, { gridless: true })


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
