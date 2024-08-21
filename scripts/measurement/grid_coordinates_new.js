/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../geometry/3d/Point3d.js";
import { isOdd } from "../util.js";


// ----- NOTE: Foundry typedefs  ----- //

/**
 * A pair of row and column coordinates of a grid space.
 * @typedef {object} GridOffset
 * @property {number} i    The row coordinate
 * @property {number} j    The column coordinate
 */

/**
 * An offset of a grid space or a point with pixel coordinates.
 * @typedef {GridOffset|Point} GridCoordinates
 */



/**
 * A 2d point that can function as Point|GridOffset. For just a point, use PIXI.Point.
 */
export class GridCoordinates extends PIXI.Point {
  /**
   * Factory function that converts a GridOffset to GridCoordinates.
   * The {x, y} coordinates are centered.
   * @param {GridOffset} offset
   * @returns {GridCoordinates}
   */
  static fromOffset(offset) {
    const pt = new this();
    pt.setOffset(offset);
    return pt;
  }

  /** @type {number} */
  get i() { return canvas.grid.getOffset({ x: this.x, y: this.y }).i }

  /** @type {number} */
  get j() { return canvas.grid.getOffset({ x: this.x, y: this.y }).j }

  /** @type {number} */
  set i(value) { this.y = canvas.grid.getCenterPoint({ i: value, j: this.j }).y; }

  /** @type {number} */
  set j(value) { this.x = canvas.grid.getCenterPoint({ i: this.i, j: value }).x; }

  /**
   * Faster than getting i and j separately.
   * @type {object}
   */
  get offset() { return canvas.grid.getOffset({ x: this.x, y: this.y }); }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the top left for i,j,k
   * @returns {PIXI.Point} New object
   */
  get topLeft() {
    return this.constructor.fromObject(canvas.grid.getTopLeftPoint({ x: this.x, y: this.y }));
  }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the center for i,j,k
   * @returns {GridCoordinates3d} New object
   */
  get center() {
    return this.constructor.fromObject(canvas.grid.getCenterPoint({ x: this.x, y: this.y }));
  }

  toPoint() { return PIXI.Point.fromObject(this); }

  /**
   * Change this point to a specific offset value. The point will be centered.
   * @param {GridOffset} offset
   */
  setOffset(offset) {
    const { x, y } = canvas.grid.getCenterPoint(offset);
    this.x = x;
    this.y = y;
    return this;
  }

  /**
   * Center this point based on its current offset value.
   */
  centerToOffset() { return this.setOffset(this); }

  /**
   * For compatibility with PIXI.Point.
   * @returns {this}
   */
  to2d() { return this; }

  /**
   * Convert to 3d.
   * @returns {GridCoordinates3d}
   */
  to3d() { return GridCoordinates3d.fromObject(this); }

  /**
   * Determine the number of diagonals based on two 2d offsets for a square grid.
   * If hexagonal, no diagonals.
   * @param {GridOffset} aOffset
   * @param {GridOffset} bOffset
   * @returns {number}
   */
  static numDiagonal(aOffset, bOffset) {
    if ( canvas.grid.isHexagonal ) return 0;
    let di = Math.abs(aOffset.i - bOffset.i);
    let dj = Math.abs(aOffset.j - bOffset.j);
    return Math.min(di, dj);
  }

  /**
   * Measure the distance between two points accounting for the current grid rules.
   * For square, this accounts for the diagonal rules. For hex, measures in number of hexes.
   * @param {Point} a
   * @param {Point} b
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetween(a, b, altGridDistFn) {
    if ( canvas.grid.isGridless ) return this.distanceBetween(a, b);
    const distFn = canvas.grid.isHexagonal ? hexGridDistanceBetween : squareGridDistanceBetween;
    const dist = distFn(a, b, altGridDistFn);

    // Round to the nearest grid distance if close.
    const gridD = canvas.grid.distance;
    if ( (dist % gridD).almostEqual(0) ) return Math.round(dist / gridD) * gridD;
    return dist;
  }

  /**
   * Measure the distance between two offsets accounting for the current grid rules.
   * Uses `gridDistanceBetween`.
   * @param {GridOffset} aOffset
   * @param {GridOffset} bOffset
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetweenOffsets(aOffset, bOffset, altGridDistFn) {
    return this.gridDistanceBetween(this.fromOffset(aOffset), this.fromOffset(bOffset), altGridDistFn);
  }

  /**
   * Return a function that can repeatedly measure segments, tracking the alternating diagonals.
   */
  static alternatingGridDistanceFn = alternatingGridDistance;
}

/**
 * Measure the 3d segment distance for a hex grid.
 * @param {Point|Point3d} a
 * @param {Point|Point3d} b
 * @returns {number} Number of hexes accounting for grid size.
 */
function hexGridDistanceBetween(p0, p1, altGridDistFn) {
  const D = CONST.GRID_DIAGONALS;
  p0.z ??= 0;
  p1.z ??= 0;

  // Translate the 2d movement to cube units. Elevation is in grid size units.
  const d0 = canvas.grid.pointToCube(p0);
  const d1 = canvas.grid.pointToCube(p1);
  d0.k = (p0.z / canvas.grid.size) || 0; // Normalize so that elevation movement = 1 when traversing 1 grid space vertically.
  d1.k = (p1.z / canvas.grid.size) || 0;
  const dist2d = foundry.grid.HexagonalGrid.cubeDistance(d0, d1);
  const distElev = Math.abs(d0.k - d1.k);

  // Like with squareGridDistanceBetween, use the maximum axis to avoid Math.max(), Max.min() throughout.
  const [maxAxis, minAxis] = dist2d > distElev ? [dist2d, distElev] : [distElev, dist2d];

  // TODO: Make setting to use Euclidean distance.
  // exactDistanceFn = setting ? Math.hypot : exactGridDistance;
  let l;
  const diagonals = game.settings.get("core", "gridDiagonals");
  switch ( diagonals ) {
    case D.EQUIDISTANT: l = maxAxis; break; // Max dx, dy, dz
    case D.EXACT: l = exactGridDistance(maxAxis, minAxis); break;
    case D.APPROXIMATE: l = approxGridDistance(maxAxis, minAxis); break;
    case D.ALTERNATING_1:
    case D.ALTERNATING_2: {
      altGridDistFn ??= alternatingGridDistance();
      l = altGridDistFn(maxAxis, minAxis);
      break;
    }
    case D.RECTILINEAR:
    case D.ILLEGAL: l = maxAxis + minAxis; break;
  }
  return l * canvas.grid.distance;
}

function approxGridDistance(maxAxis = 0, midAxis = 0, minAxis = 0) {
  return maxAxis + (0.5 * midAxis) + (0.25 * minAxis);
  // Equivalent to:
  // return maxAxis + ((0.5 * (midAxis - minAxis)) + (0.75 * minAxis))
}

function exactGridDistance(maxAxis = 0, midAxis = 0, minAxis = 0) {
  const A = Math.SQRT2 - 1;
  const B = Math.SQRT3 - 1;
  return maxAxis + (A * midAxis) + ((B - A) * minAxis);
  // Equivalent to:
  // maxAxis + (A * (midAxis - minAxis)) + (B * minAxis);
}

/**
 * Track the diagonals required for measuring alternating grid distance.
 * Returns a function that calls _alternatingGridDistance with the cached previous diagonals.
 * Handles hex or square grids.
 * @param {object} [opts]
 *   - @param {number} [opts.lPrev]
 *   - @param {number} [opts.prevMaxAxis]
 *   - @param {number} [opts.prevMidAxis]
 *   - @param {number} [opts.prevMinAxis]
 * @returns {function}
 *   - @param {Point|Point3d} p0
 *   - @param {Point|Point3d} p1
 *   - @param {object} [opts]     Same opts as the original function.
 *   - @returns {number} The distance in number of squares or hexes
 */
function alternatingGridDistance(opts = {}) {
  let lPrev = opts.lPrev ?? canvas.grid.diagonals === CONST.GRID_DIAGONALS.ALTERNATING_2 ? 1 : 0;
  let prevMaxAxis = opts.prevMaxAxis ?? lPrev;
  let prevMidAxis = opts.prevMidAxis ?? lPrev;
  let prevMinAxis = opts.prevMinAxis ?? lPrev;
  return (maxAxis = 0, midAxis = 0, minAxis = 0) => {
    prevMaxAxis += maxAxis;
    prevMidAxis += midAxis;
    prevMinAxis += minAxis;
    const lCurr = _alternatingGridDistance(prevMaxAxis, prevMidAxis, prevMinAxis);
    const l = lCurr - lPrev; // If 2:1:2, this will cause the flip along with dxPrev and dyPrev.
    lPrev = lCurr;
    return l;
  }
}

function _alternatingGridDistance(maxAxis = 0, midAxis = 0, minAxis = 0) {
  // How many full spaces have been traversed?
  const spacesX = Math.floor(maxAxis);
  const spacesY = Math.floor(midAxis);
  const spacesZ = Math.floor(minAxis);

  // Shift in x,y since last move.
  const deltaX = maxAxis - spacesX;
  const deltaY = midAxis - spacesY;
  const deltaZ = minAxis - spacesZ;

  // Determine the movement assuming diagonals === 2, so
  const a = approxGridDistance(spacesX, spacesY, spacesZ);
  const A = Math.floor(a); // If no prior move, this is the total move.

  // Add in the previous move deltas. Essentially do an approximate move for the deltas.
  const B = Math.floor(a + 1);
  const C = Math.floor(a + 1.5);
  const D = Math.floor(a + 1.75);
  return A + ((B - A) * deltaX) + ((C - B) * deltaY) + ((D - C) * deltaZ);
  // Same as
  // (A * (1 - deltaX)) + (B * (deltaX - deltaY)) + (C * (deltaY - deltaZ)) + (D * deltaZ);
}




/**
 * Measure the 3d segment distance for a square grid, accounting for diagonal movement.
 * @param {Point|Point3d} a
 * @param {Point|Point3d} b
 * @returns {number} Distance accounting for grid size.
 */
function squareGridDistanceBetween(p0, p1, altGridDistFn) {
  const D = CONST.GRID_DIAGONALS;
  p0.z ??= 0;
  p1.z ??= 0;

  // Normalize so that dx === 1 when traversing 1 grid space.
  const dx = Math.abs(p0.x - p1.x) / canvas.grid.size;
  const dy = Math.abs(p0.y - p1.y) / canvas.grid.size;
  const dz = Math.abs(p0.z - p1.z) / canvas.grid.size;

  // Make dx the maximum, dy, the middle, and dz the minimum change across the axes.
  // If two-dimensional, dz will be zero. (Slightly faster than an array sort.)
  const minMax = Math.minMax(dx, dy, dz);
  const maxAxis = minMax.max;
  const minAxis = minMax.min;
  const midAxis = dx.between(dy, dz) ? dx
    : dy.between(dx, dz) ? dy : dz;

  // TODO: Make setting to use Euclidean distance.
  // exactDistanceFn = setting ? Math.hypot : exactGridDistance;
  let l;
  switch ( canvas.grid.diagonals ) {
    case D.EQUIDISTANT: l = maxAxis; break; // Max dx, dy, dz
    case D.EXACT: l = exactGridDistance(maxAxis, midAxis, minAxis); break;
    case D.APPROXIMATE: l = approxGridDistance(maxAxis, midAxis, minAxis); break;
    case D.ALTERNATING_1:
    case D.ALTERNATING_2: {
      altGridDistFn ??= alternatingGridDistance();
      l = altGridDistFn(maxAxis, midAxis, minAxis);
      break;
    }
    case D.RECTILINEAR:
    case D.ILLEGAL: l = maxAxis + midAxis + minAxis; break;
  }
  return l * canvas.grid.distance;
}

/**
 * Measure the 2d segment distance for a square grid, accounting for diagonal movement.
 * Original version from HexagonalGrid#_measure for debugging.
 * @param {Point} a
 * @param {Point} b
 * @returns {number} Distance before accounting for grid size.
 */
function hexGridDistanceBetweenOrig(p0, p1) {
  // Convert to (fractional) cube coordinates
  const toCube = coords => {
    if ( coords.x !== undefined ) return canvas.grid.pointToCube(coords);
    if ( coords.i !== undefined ) return canvas.grid.offsetToCube(coords);
    return coords;
  };

  const d0 = toCube(p0);
  const d1 = toCube(p1);
  const d = foundry.grid.HexagonalGrid.cubeDistance(d0, d1);
  return d * canvas.grid.distance;
}

/**
 * Measure the 3dd segment distance for a square grid, accounting for diagonal movement.
 * @param {Point} a
 * @param {Point} b
 * @returns {number} Distance before accounting for grid size.
 */
function hexGridDistance3dBetweenOrig(p0, p1, is3D = true) {
  // Convert to (fractional) cube coordinates
  const toCube = coords => {
    if ( coords.x !== undefined ) return canvas.grid.pointToCube(coords);
    if ( coords.i !== undefined ) return canvas.grid.offsetToCube(coords);
    return coords;
  };

  const d0 = toCube(p0);
  const d1 = toCube(p1);
  d0.k = (p0.z / canvas.grid.size) | 0;
  d1.k = (p1.z / canvas.grid.size) | 0;

  let a = foundry.grid.HexagonalGrid.cubeDistance(d0, d1);
  let b = 0;
  if ( is3D ) {
    b = Math.abs(d0.k - d1.k);
    if ( a < b ) [a, b] = [b, a];
  }
  let l;
  const D = CONST.GRID_DIAGONALS;
  const diagonals = game.settings.get("core", "gridDiagonals");
  let ld = diagonals === D.ALTERNATING_2 ? 1 : 0;
  switch ( diagonals ) {
    case D.EQUIDISTANT: l = a; break;
    case D.EXACT: l = a + ((Math.SQRT2 - 1) * b); break;
    case D.APPROXIMATE: l = a + (0.5 * b); break;
    case D.ILLEGAL: l = a + b; break;
    case D.ALTERNATING_1:
    case D.ALTERNATING_2:
      const ld0 = ld;
      ld += b;
      l = a + ((Math.abs(((ld - 1) / 2) - Math.floor(ld / 2)) + ((ld - 1) / 2))
        - (Math.abs(((ld0 - 1) / 2) - Math.floor(ld0 / 2)) + ((ld0 - 1) / 2)));
      break;
    case D.RECTILINEAR: l = a + b; break;
  }
  return l * canvas.grid.distance;
}



/**
 * Measure the 2d segment distance for a square grid, accounting for diagonal movement.
 * Original version from SquareGrid#_measure for debugging.
 * @param {Point} a
 * @param {Point} b
 * @returns {number} Distance in grid units
 */
function squareGridDistanceBetweenOrig(p0, p1, { da = 0, db = 0, l0 = 0 } = 0) {
  // From SquareGrid#_measure
  const dx = Math.abs(p0.x - p1.x) / canvas.grid.size;
  const dy = Math.abs(p0.y - p1.y) / canvas.grid.size;
  let l;
  const D = CONST.GRID_DIAGONALS;
  switch ( canvas.grid.diagonals ) {
    case D.EQUIDISTANT: l = Math.max(dx, dy); break;
    case D.EXACT: l = Math.max(dx, dy) + ((Math.SQRT2 - 1) * Math.min(dx, dy)); break;
    case D.APPROXIMATE: l = Math.max(dx, dy) + (0.5 * Math.min(dx, dy)); break;
    case D.ALTERNATING_1:
    case D.ALTERNATING_2:
      {
        const a = da += Math.max(dx, dy);
        const b = db += Math.min(dx, dy);
        const c = Math.floor(b / 2);
        const d = b - (2 * c);
        const e = Math.min(d, 1);
        const f = Math.max(d, 1) - 1;
        const l1 = a - b + (3 * c) + e + f + (canvas.grid.diagonals === D.ALTERNATING_1 ? f : e);
        l = l1 - l0;
        l0 = l1;
      }
      break;
    case D.RECTILINEAR:
    case D.ILLEGAL: l = dx + dy; break;
  }
  return l * canvas.grid.distance;
}

function squareGridDistance3dBetweenOrig(p0, p1, is3D = true) {
  const D = CONST.GRID_DIAGONALS;
  let l0 = canvas.grid.diagonals === D.ALTERNATING_2 ? 1.0 : 0.0;
  let dx0 = l0;
  let dy0 = l0;
  let dz0 = l0;

  let dx = Math.abs(p0.x - p1.x) / canvas.grid.size;
  let dy = Math.abs(p0.y - p1.y) / canvas.grid.size;
  if ( dx < dy ) [dx, dy] = [dy, dx];
  let dz = 0;
  if ( is3D ) {
    dz = Math.abs(p0.z - p1.z) / canvas.grid.size;
    if ( dy < dz ) [dy, dz] = [dz, dy];
    if ( dx < dy ) [dx, dy] = [dy, dx];
  }

  // From SquareGrid#_measure
  let l; // The distance of the segment
  switch ( canvas.grid.diagonals ) {
    case D.EQUIDISTANT: l = dx; break;
    case D.EXACT: l = dx + (((Math.SQRT2 - 1) * (dy - dz)) + ((Math.SQRT3 - 1) * dz)); break;
    case D.APPROXIMATE: l = dx + ((0.5 * (dy - dz)) + (0.75 * dz)); break;
    case D.RECTILINEAR: l = dx + (dy + dz); break;
    case D.ALTERNATING_1:
    case D.ALTERNATING_2:
      {
        dx0 += dx;
        dy0 += dy;
        dz0 += dz;
        const fx = Math.floor(dx0);
        const fy = Math.floor(dy0);
        const fz = Math.floor(dz0);
        const a = fx + (0.5 * fy) + (0.25 * fz);
        const a0 = Math.floor(a);
        const a1 = Math.floor(a + 1);
        const a2 = Math.floor(a + 1.5);
        const a3 = Math.floor(a + 1.75);
        const mx = dx0 - fx;
        const my = dy0 - fy;
        const mz = dz0 - fz;
        const l1 = (a0 * (1 - mx)) + (a1 * (mx - my)) + (a2 * (my - mz)) + (a3 * mz);
        l = l1 - l0;
        l0 = l1;
      }
      break;
    case D.ILLEGAL: l = dx + (dy + dz); break;
  }
  return l * canvas.grid.distance;
}


// ----- NOTE: 3d versions of Foundry typedefs ----- //

/**
 * @typedef {object} RegionMovementWaypoint
 * @property {number} x            The x-coordinates in pixels (integer).
 * @property {number} y            The y-coordinates in pixels (integer).
 * @property {number} elevation    The elevation in grid units.
 */

/**
 * Row, column, elevation coordinates of a grid space. Follows from GridOffset
 * The vertical assumes the grid cubes are stacked upon one another.
 * @typedef {object} GridOffset3d
 * @property {number} i     The row coordinate
 * @property {number} j     The column coordinate
 * @property {number} k     The elevation, where 0 is at the scene elevation, negative is below the scene.
 *   k * canvas.scene.dimensions.distance === elevation in grid units.
 */

/**
 * An offset of a grid space or a point with pixel coordinates.
 * @typedef {GridOffset3d|Point3d} GridCoordinates3d
 */

/**
 * A 3d point that can function as a Point3d|RegionMovementWaypoint.
 * Does not handle GridOffset3d so that it can be passed to 2d Foundry functions that
 * treat objects with {i,j} parameters differently.
 */
export class RegionMovementWaypoint3d extends Point3d {
  /** @type {number<grid units>} */
  get elevation() { return CONFIG.GeometryLib.utils.pixelsToGridUnits(this.z); }

  /** @type {number<grid units>} */
  set elevation(value) { this.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(value); }

  /**
   * Factory function to convert a generic point object to a RegionMovementWaypoint3d.
   * @param {Point|PIXI.Point|GridOffset|RegionMovementWaypoint|GridOffset3d|GridCoordinates3d} pt
   *   i, j, k assumed to refer to the center of the grid
   * @returns {GridCoordinates3d}
   */
  static fromPoint(pt) {
    // Priority: x,y,z | elevation | i, j, k
    let x;
    let y;
    if ( Object.hasOwn(pt, "x") ) {
      x = pt.x;
      y = pt.y;
    } else if ( Object.hasOwn(pt, "i") ) {
      const res = canvas.grid.getCenterPoint(pt);
      x = res.x;
      y = res.y;
    }

    // Process elevation.
    const newPt = new this(x, y);
    if ( Object.hasOwn(pt, "z") ) newPt.z = pt.z;
    else if ( Object.hasOwn(pt, "elevation") ) newPt.elevation = pt.elevation;
    else if ( Object.hasOwn(pt, "k") ) newPt.elevation = GridCoordinates3d.elevationForUnit(pt.k);
    return newPt;
  }
}

/**
 * A 3d point that can function as Point3d|GridOffset3d|RegionMovementWaypoint.
 * Links z to the elevation property.
 */
export class GridCoordinates3d extends RegionMovementWaypoint3d {
  /**
   * Factory function that converts a GridOffset to GridCoordinates.
   * @param {GridOffset} offset
   * @param {number} [elevation]      Override the elevation in offset, if any. In grid units
   * @returns {GridCoordinates3d}
   */
  static fromOffset(offset, elevation) {
    const pt = new this();
    pt.setOffset(offset);
    if ( typeof elevation !== "undefined" ) pt.elevation = elevation;
    return pt;
  }

  /**
   * Factory function to determine the grid square/hex center for the point.
   * @param {Point3d}
   * @returns {GridCoordinate3d}
   */
  static gridCenterForPoint(pt) {
    pt = new this(pt.x, pt.y, pt.z);
    return pt.centerToOffset();
  }

  /** @type {number} */
  get i() { return canvas.grid.getOffset({ x: this.x, y: this.y }).i }

  /** @type {number} */
  get j() { return canvas.grid.getOffset({ x: this.x, y: this.y }).j }

  /** @type {number} */
  get k() { return this.constructor.unitElevation(CONFIG.GeometryLib.utils.pixelsToGridUnits(this.z)); }

  /** @type {number} */
  set i(value) { this.y = canvas.grid.getCenterPoint({ i: value, j: this.j }).y; }

  /** @type {number} */
  set j(value) { this.x = canvas.grid.getCenterPoint({ i: this.i, j: value }).x; }

  /** @type {number} */
  set k(value) { this.elevation = this.constructor.elevationForUnit(value); }

  /**
   * Faster than getting i and j separately.
   * @type {object}
   */
  get offset() {
    const o = canvas.grid.getOffset({ x: this.x, y: this.y });
    o.k = this.k;
    return o;
  }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the top left for i,j,k
   * @returns {GridCoordinates3d} New object
   */
  get topLeft() {
    const tl = this.constructor.fromObject(canvas.grid.getTopLeftPoint({ x: this.x, y: this.y }));
    tl.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(this.constructor.elevationForUnit(this.k));
    return tl;
  }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the center for i,j,k
   * @returns {GridCoordinates3d} New object
   */
  get center() {
    const center = this.constructor.fromObject(canvas.grid.getCenterPoint({ x: this.x, y: this.y }));
    center.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(this.constructor.elevationForUnit(this.k));
    return center;
  }



  /**
   * Convert this point to a RegionMovementWaypoint.
   * @returns {RegionMovementWaypoint3d}
   */
  toWaypoint() { return RegionMovementWaypoint3d.fromObject(this); }

  /**
   * Change this point to a specific offset value.
   * Faster than setting each {i, j, k} separately.
   * @param {GridOffset} offset
   */
  setOffset(offset) {
    const { x, y } = canvas.grid.getCenterPoint(offset);
    this.x = x;
    this.y = y;
    this.elevation = this.constructor.elevationForUnit(offset.k || 0);
    return this;
  }

  /**
   * Change this point to a specific offset value in the 2d axes. Do not modify elevation.
   * Faster than setting each {i, j} separately.
   * @param {GridOffset} offset
   */
  setOffset2d(offset) {
    const { x, y } = canvas.grid.getCenterPoint(offset);
    this.x = x;
    this.y = y;
    return this;
  }

  /**
   * Center this point based on its current offset value.
   */
  centerToOffset() { return this.setOffset(this); }

  /**
   * Conversion to 2d.
   * @returns {GridCoordinates}
   */
  to2d() { return GridCoordinates.fromObject(this); }

  /**
   * @returns {this}
   */
  to3d() { return this; }

  /**
   * Determine the number of diagonals based on two offsets.
   * If hexagonal, only elevation diagonals count.
   * @param {GridOffset} aOffset
   * @param {GridOffset} bOffset
   * @returns {number}
   */
  static numDiagonal(aOffset, bOffset) {
    if ( canvas.grid.isHexagonal ) return Math.abs(aOffset.k - bOffset.k);
    let di = Math.abs(aOffset.i - bOffset.i);
    let dj = Math.abs(aOffset.j - bOffset.j);
    let dk = Math.abs(aOffset.k - bOffset.k);
    const midAxis = di.between(dj, dk) ? di
      : dj.between(di, dk) ? dj : dk;
    return midAxis;
  }

  /**
   * Calculate the unit elevation for a given set of coordinates.
   * @param {number} elevation    Elevation in grid units
   * @returns {number} Elevation in number of grid steps.
   */
  static unitElevation(elevation) { return Math.round(elevation / canvas.scene.dimensions.distance); }

  /**
   * Calculate the grid unit elevation from unit elevation.
   * Inverse of `unitElevation`.
   * @param {number} k            Unit elevation
   * @returns {number} Elevation in grid units
   */
  static elevationForUnit(k) { return k * canvas.scene.dimensions.distance; }

  /**
   * Measure the distance between two points accounting for the current grid rules.
   * For square, this accounts for the diagonal rules. For hex, measures in number of hexes.
   * @param {Point3d} a
   * @param {Point3d} b
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetween(a, b, altGridDistFn) {
    if ( canvas.grid.isGridless ) return this.distanceBetween(a, b);
    const distFn = canvas.grid.isHexagonal ? hexGridDistanceBetween : squareGridDistanceBetween;
    const dist = distFn(a, b, altGridDistFn);

    // Round to the nearest grid distance if close.
    const gridD = canvas.grid.distance;
    if ( (dist % gridD).almostEqual(0) ) return Math.round(dist / gridD) * gridD;
    return dist;
  }

  /**
   * Measure the distance between two offsets accounting for the current grid rules.
   * Uses `gridDistanceBetween`.
   * @param {GridOffset3d} aOffset
   * @param {GridOffset3d} bOffset
   * @returns {number} Distance, in grid units
   */
  static gridDistanceBetweenOffsets(aOffset, bOffset, altGridDistFn) {
    return this.gridDistanceBetween(this.fromOffset(aOffset), this.fromOffset(bOffset), altGridDistFn);
  }

  /**
   * Measure distance, offset, and cost for a given segment a|b.
   * Uses `gridDistanceBetween`.
   * @param {Point3d} a                   Start of the segment
   * @param {Point3d} b                   End of the segment
   * @param {number} [numPrevDiagonal=0]   Number of diagonals thus far
   * @param {function} [costFn]           Optional cost function; defaults to canvas.controls.ruler._getCostFunction
   * @returns {object}
   *   - @prop {number} distance          gridDistanceBetween for a|b
   *   - @prop {number} offsetDistance    gridDistanceBetweenOffsets for a|b
   *   - @prop {number} cost              Measured cost using the cost function
   *   - @prop {number} numDiagonal       Number of diagonals between the offsets if square or hex elevation
   */
  static gridMeasurementForSegment(a, b, numPrevDiagonal = 0, costFn) {
    costFn ??= canvas.controls.ruler._getCostFunction();
    const lPrevStart = canvas.grid.diagonals === CONST.GRID_DIAGONALS.ALTERNATING_2 ? 1 : 0;
    const lPrev = isOdd(numPrevDiagonal) ? lPrevStart : Number(!lPrevStart);
    const aOffset = this.fromObject(a);
    const bOffset = this.fromObject(b);
    const distance = this.gridDistanceBetween(a, b, this.alternatingGridDistanceFn({ lPrev }));
    const offsetDistance = this.gridDistanceBetweenOffsets(a, b, this.alternatingGridDistanceFn({ lPrev }));
    const cost = costFn ? costFn(a, b, offsetDistance) : offsetDistance;
    const numDiagonal = this.numDiagonal(aOffset, bOffset);
    return { distance, offsetDistance, cost, numDiagonal };
  }

  /**
   * Return a function that can repeatedly measure segments, tracking the alternating diagonals.
   */
  static alternatingGridDistanceFn = alternatingGridDistance;
}
