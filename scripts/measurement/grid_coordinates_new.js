/* globals
canvas,
CONFIG,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Point3d } from "../geometry/3d/Point3d.js";


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
  /** @type {number} */
  get i() { return canvas.grid.getOffset({ x: this.x, y: this.y }).i }

  /** @type {number} */
  get j() { return canvas.grid.getOffset({ x: this.x, y: this.y }).j }

  /** @type {number} */
  set i(value) { this.x = canvas.grid.getTopLeftPoint({ i: value, j: this.j }).x; }

  /** @type {number} */
  set j(value) { this.y = canvas.grid.getTopLeftPoint({ i: this.i, j: value }).y; }

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
   * Coerce this point to match the offset value.
   */
  matchOffset() {
    const { i, j } = canvas.grid.getOffset({ x: this.x, y: this.y });
    this.i = i;
    this.j = j;
    return this;
  }

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

  /** @type {number} */
  get i() { return canvas.grid.getOffset({ x: this.x, y: this.y }).i }

  /** @type {number} */
  get j() { return canvas.grid.getOffset({ x: this.x, y: this.y }).j }

  /** @type {number} */
  get k() { return this.constructor.unitElevation(CONFIG.GeometryLib.utils.pixelsToGridUnits(this.z)); }

  /** @type {number} */
  set i(value) { this.x = canvas.grid.getTopLeftPoint({ i: value, j: this.j }).x; }

  /** @type {number} */
  set j(value) { this.y = canvas.grid.getTopLeftPoint({ i: this.i, j: value }).y; }

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
    tl.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(this.elevationForUnit(this.k));
    return tl;
  }

  /**
   * Convert this point to a new one based on its offset.
   * Sets x,y,z to equal the center for i,j,k
   * @returns {GridCoordinates3d} New object
   */
  get center() {
    const center = this.constructor.fromObject(canvas.grid.getCenterPoint({ x: this.x, y: this.y }));
    center.z = CONFIG.GeometryLib.utils.gridUnitsToPixels(this.elevationForUnit(this.k));
    return center;
  }

  /**
   * Convert this point to a RegionMovementWaypoint.
   * @returns {RegionMovementWaypoint3d}
   */
  toWaypoint() { return RegionMovementWaypoint3d.fromObject(this); }

  /**
   * Coerce this point to match the offset value.
   */
  matchOffset() {
    const { i, j } = canvas.grid.getOffset({ x: this.x, y: this.y });
    const k = this.constructor.unitElevation(this.elevation);
    this.i = i;
    this.j = j;
    this.k = k;
    return this;
  }

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
}
