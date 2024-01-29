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
  hexGridShape } from "./util.js";
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
  D: 3
};
export function measureDistance(a, b, gridless = false) {
  gridless ||= canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
  if ( gridless ) return CONFIG.GeometryLib.utils.pixelsToGridUnits(PIXI.Point.distanceBetween(a, b));

  a = PIXI.Point.fromObject(a);
  b = PIXI.Point.fromObject(b);
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
 * @returns {object}
 *  - {number} distance       Distance measurement
 *  - {number} moveDistance   Distance after move penalty applied.
 *  A segment wholly within a square may be 0 distance.
 */
export function measureMoveDistance(a, b, token, gridless = false) {
  gridless ||= canvas.grid.type === CONST.GRID_TYPES.GRIDLESS;
  a = PIXI.Point.fromObject(a);
  b = PIXI.Point.fromObject(b);

  if ( gridless ) return gridlessMoveDistance(a, b, token);
  else return griddedMoveDistance(a, b, token);
}

/**
 * Calculate the move distance for gridless.
 * @param {PIXI.Point} a                      Starting point for the segment
 * @param {PIXI.Point} b                      Ending point for the segment
 * @param {Token} token                       Token that is moving.
 * @returns {object}
 *  - {number} distance       Distance measurement in grid units.
 *  - {number} moveDistance   Distance after move penalty applied.
 */
function gridlessMoveDistance(a, b, token) {
  const terrainPenalty = terrainMovePenalty(a, b, token);
  const tokenPenalty = terrainTokenGridlessMoveMultiplier(a, b, token);
  const d = CONFIG.GeometryLib.utils.pixelsToGridUnits(PIXI.Point.distanceBetween(a, b));
  return {
    distance: d,
    moveDistance: d * terrainPenalty * tokenPenalty
  };
}

/**
 * Calculate the move distance for gridded.
 * Similar to measureDistance.
 * @param {PIXI.Point} a                      Starting point for the segment
 * @param {PIXI.Point} b                      Ending point for the segment
 * @returns {object}
 *  - {number} distance       Distance measurement in grid units.
 *  - {number} moveDistance   Distance after move penalty applied.
 */
function griddedMoveDistance(a, b, token) {
  const iter = iterateGridUnderLine(a, b);
  let prev = iter.next().value;
  if ( !prev ) return 0;

  // Find tokens along the ray whose constrained borders intersect the ray.
  const bounds = segmentBounds(a, b);
  const collisionTest = o => o.t.constrainedTokenBorder.lineSegmentIntersects(a, b, { inside: true });
  const tokens = canvas.tokens.quadtree.getObjects(bounds, { collisionTest });
  tokens.delete(token);

  // For each grid, count terrain from previous grid center to current grid center.
  // Count token multiplier 50% in previous, 50% in current.
  const gridShapeFn = canvas.grid.type === CONST.GRID_TYPES.SQUARE ? squareGridShape : hexGridShape;
  const mult = Settings.get(Settings.KEYS.TOKEN_RULER.TOKEN_MULTIPLIER) || 1;
  const [x, y] = canvas.grid.grid.getPixelsFromGridPosition(prev[0], prev[1]);
  const [cx, cy] = canvas.grid.grid.getCenter(x, y);
  const prevCenter = new PIXI.Point(cx, cy);
  const currCenter = new PIXI.Point();
  const ix = new PIXI.Point();

  // Do one or more token constrained borders overlap this grid space?
  let tokenOverlapsPrev = false;
  if ( mult !== 1 && tokens.size ) {
    const shape = gridShapeFn({x, y});
    tokenOverlapsPrev = tokens.some(t => {
      const border = t.constrainedTokenBorder ?? t.bounds;
      return border.overlaps(shape)
    });
  }

  // Pixel distance for each grid move.
  const distance = canvas.dimensions.distance;
  const diagonalRule = DIAGONAL_RULES[canvas.grid.diagonalRule] ?? DIAGONAL_RULES["555"];
  let diagonalDist = distance;
  if ( diagonalRule === DIAGONAL_RULES.EUCL ) diagonalDist = Math.hypot(distance, distance);

  // Step over each grid shape in turn.
  const changeCount = new Uint32Array([0, 0, 0, 0]);
  let nDiag = 0;
  let dTotal = 0;
  let dMoveTotal = 0;
  for ( const next of iter ) {
    // Count the move direction.
    const xChange = prev[1] !== next[1]; // Column is x
    const yChange = prev[0] !== next[0]; // Row is y
    changeCount[((xChange * 2) + yChange)] += 1;

    // Locate the center of this grid shape.
    const [x, y] = canvas.grid.grid.getPixelsFromGridPosition(next[0], next[1]);
    const [cx, cy] = canvas.grid.grid.getCenter(x, y);
    currCenter.x = cx;
    currCenter.y = cy;

    // Do one or more token constrained borders overlap this grid space?
    const shape = gridShapeFn({x, y});
    const tokenOverlaps = mult === 1 ? false : tokens.some(t => {
      const border = t.constrainedTokenBorder ?? t.bounds;
      return border.overlaps(shape)
    });

    // TODO: Handle when diagonal movement is disallowed by adding grid pieces.
    // Go from previous center to grid intersection to new center.
    const ixs = shape
      .segmentIntersections(prevCenter, currCenter)
      .map(ix => PIXI.Point.fromObject(ix));
    ix.copyFrom(ixs[0] ?? PIXI.Point.midPoint(prevCenter, currCenter));

    /** Debug
    Draw.point(prevCenter, { color: Draw.COLORS.blue});
    Draw.point(ix, { color: Draw.COLORS.red});
    Draw.point(currCenter, { color: Draw.COLORS.green });
    */

    const terrainPenaltyPrev = terrainMovePenalty(prevCenter, ix, token);
    const terrainPenaltyCurr = terrainMovePenalty(ix, currCenter, token);

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
    const tokenPenalty = ((tokenOverlaps ? mult : 1) + (tokenOverlapsPrev ? mult : 1)) * 0.5;
    const terrainPenalty = (terrainPenaltyCurr + terrainPenaltyPrev) * 0.5;
    const movePenalty = tokenPenalty * terrainPenalty;
    dTotal += d;
    dMoveTotal += (d * movePenalty);

    log(`griddedMoveDistance|${prevCenter.x},${prevCenter.y} -> ${ix.x},${ix.y} -> ${currCenter.x},${currCenter.y}\n\ttokenPenalty: ${(tokenOverlaps ? mult : 1)} | ${tokenOverlapsPrev ? mult : 1}\n\tterrainPenalty: ${terrainPenaltyPrev} | ${terrainPenalty}`);

    // Cycle to next.
    tokenOverlapsPrev = tokenOverlaps;
    prevCenter.copyFrom(currCenter);
    prev = next;
    changeCount.fill(0);
  }

  return {
    distance: dTotal,
    moveDistance: dMoveTotal
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
 * @param {PIXI.Point} a                 Starting point for the segment
 * @param {PIXI.Point} b                   Ending point for the segment
 * @returns {Uint32Array[4]|0} Counts of changes: none, vertical, horizontal, diagonal.
 */
function countGridMoves(a, b) {
  const iter = iterateGridUnderLine(a, b);
  let prev = iter.next().value;
  if ( !prev ) return 0;

  // No change, vertical change, horizontal change, diagonal change.
  const changeCount = new Uint32Array([0, 0, 0, 0]);
  for ( const next of iter ) {
    const xChange = prev[1] !== next[1]; // Column is x
    const yChange = prev[0] !== next[0]; // Row is y
    changeCount[((xChange * 2) + yChange)] += 1;
    prev = next;
  }

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
      const distance = PIXI.Point.distanceBetween(a, ix);
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
      const startPt = a.project(b, prevT);
      const endPt = a.project(b, tValue.t);
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
 * Helper to get a rectangular bounds between two points.
 * @param {PIXI.Point} a
 * @param {PIXI.Point} b
 * @returns {PIXI.Rectangle}
 */
function segmentBounds(a, b) {
  if ( !b || a.equals(b) ) return new PIXI.Rectangle(a.x - 1, a.y - 1, 3, 3);
  const xMinMax = Math.minMax(a.x, b.x);
  const yMinMax = Math.minMax(a.y, b.y);
  return new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
}
