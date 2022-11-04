/* globals
PIXI
*/
"use strict";

import { EPSILON } from "./const.js";

// Add methods to PIXI.Point
export function registerPIXIPointMethods() {
  Object.defineProperty(PIXI.Point.prototype, "add", {
    value: add2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "subtract", {
    value: subtract2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "multiply", {
    value: multiply2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "multiplyScalar", {
    value: multiplyScalar2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "dot", {
    value: dot2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "magnitude", {
    value: magnitude2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "magnitudeSquared", {
    value: magnitudeSquared2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "almostEqual", {
    value: almostEqual2d,
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "normalize", {
    value: normalize,
    writable: true,
    configurable: true
  });

  // For parallel with Point3d
  Object.defineProperty(PIXI.Point.prototype, "to2d", {
    value: function() { return this; },
    writable: true,
    configurable: true
  });

  Object.defineProperty(PIXI.Point.prototype, "to3d", {
    value: to3d,
    writable: true,
    configurable: true
  });
}

/**
 * Convert 2d point to 3d
 * @param [object] [options]    Choices that affect the axes used.
 * @param [string] [options.x]  What 2d axis to use for the 3d x axis
 * @param [string] [options.y]  What 2d axis to use for the 3d y axis
 * @param [string] [options.z]  What 2d axis to use for the 3d z axis
 * @returns {Point3d}
 */
function to3d({ x = "x", y = "y", z} = {}) {
  const x3d = x ? this[x] : 0;
  const y3d = y ? this[y] : 0;
  const z3d = z ? this[z] : 0;
  return new Point3d(x3d, y3d, z3d);
}

/**
 * Add a point to this one.
 * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
 * @param {PIXI.Point} other    The point to add to `this`.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function add2d(other, outPoint = new PIXI.Point()) {
  outPoint.x = this.x + other.x;
  outPoint.y = this.y + other.y;

  return outPoint;
}

/**
 * Subtract a point from this one.
 * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
 * @param {PIXI.Point} other    The point to subtract from `this`.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function subtract2d(other, outPoint = new PIXI.Point()) {
  outPoint.x = this.x - other.x;
  outPoint.y = this.y - other.y;

  return outPoint;
}

/**
 * Multiply `this` point by another.
 * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
 * @param {PIXI.Point} other    The point to subtract from `this`.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function multiply2d(other, outPoint = new PIXI.Point()) {
  outPoint.x = this.x * other.x;
  outPoint.y = this.y * other.y;

  return outPoint;
}

/**
 * Multiply `this` point by a scalar
 * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
 * @param {PIXI.Point} other    The point to subtract from `this`.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function multiplyScalar2d(scalar, outPoint = new PIXI.Point()) {
  outPoint.x = this.x * scalar;
  outPoint.y = this.y * scalar;

  return outPoint;
}

/**
 * Dot product of this point with another.
 * (Sum of the products of the components)
 * @param {PIXI.Point} other
 * @return {number}
 */
function dot2d(other) {
  return (this.x * other.x) + (this.y * other.y);
}

/**
 * Magnitude (length, or sometimes distance) of this point.
 * Square root of the sum of squares of each component.
 * @returns {number}
 */
function magnitude2d() {
  // Same as Math.sqrt(this.x * this.x + this.y * this.y)
  return Math.hypot(this.x, this.y);
}

/**
 * Magnitude squared.
 * Avoids square root calculations.
 * @returns {number}
 */
function magnitudeSquared2d() {
  return Math.pow(this.x, 2) + Math.pow(this.y, 2);
}

/**
 * Test if `this` is nearly equal to another point.
 * @param {PIXI.Point} other
 * @param {number} epsilon
 * @returns {boolean}
 */
function almostEqual2d(other, epsilon = EPSILON) {
  return this.x.almostEqual(other.x, epsilon) && this.y.almostEqual(other.y, epsilon);
}

/**
 * Normalize the point.
 * @param {PIXI.Point} [outPoint]    A point-like object in which to store the value.
 *   (Will create new point if none provided.)
 * @returns {PIXI.Point}
 */
function normalize(outPoint = new PIXI.Point()) {
  this.multiplyScalar(1 / this.magnitude(), outPoint);
  return outPoint;
}

/**
 * 3-D version of PIXI.Point
 * See https://pixijs.download/dev/docs/packages_math_src_Point.ts.html
 */
export class Point3d extends PIXI.Point {
  /**
   * @param {number} [x=0] - position of the point on the x axis
   * @param {number} [y=0] - position of the point on the y axis
   * @param {number} [z=0] - position of the point on the z axis
   */
  constructor(x = 0, y = 0, z = 0) {
    super(x, y);
    this.z = z;
  }

  /**
   * Drop the z dimension; return a new PIXI.Point
   * @param [object] [options]    Options that affect which axes are used
   * @param [string] [options.x]  Which 3d axis to use for the x axis
   * @param [string] [options.y]  Which 3d axis to use for the y axis
   * @returns {PIXI.Point}
   */
  to2d({x = "x", y = "y"} = {}) {
    return new PIXI.Point(this[x], this[y]);
  }

  /**
   * For parallel with PIXI.Point
   */
  to3d() {
    return this;
  }

  /**
   * Creates a clone of this point
   * @returns A clone of this point
   */
  clone() {
    return new this.constructor(this.x, this.y, this.z);
  }

  /**
   * Copies `x` and `y` and `z` from the given point into this point
   * @param {Point} p - The point to copy from
   * @returns {Point3d} The point instance itself
   */
  copyFrom(p) {
    this.set(p.x, p.y, p.z);
    return this;
  }

  /**
   * Copies this point's x and y and z into the given point (`p`).
   * @param p - The point to copy to. Can be any of type that is or extends `IPointData`
   * @returns {Point} The point (`p`) with values updated
   */
  copyTo(p) {
    p.set(this.x, this.y, this.z);
    return p;
  }

  /**
   * Accepts another point (`p`) and returns `true` if the given point is equal to this point
   * @param p - The point to check
   * @returns {boolean} Returns `true` if both `x` and `y` are equal
   */
  equals(p) {
    const z = p.z ?? 0;
    return (p.x === this.x) && (p.y === this.y) && (z === this.z);
  }

  /*
   * Sets the point to a new `x` and `y` position.
   * If `y` is omitted, both `x` and `y` will be set to `x`.
   * If `z` is omitted, it will be set to 0
   * @param {number} [x=0] - position of the point on the `x` axis
   * @param {number} [y=x] - position of the point on the `y` axis
   * @returns {Point3d} The point instance itself
   */
  set(x = 0, y = x, z = 0) {
    super.set(x, y);
    this.z = z;
    return this;
  }

  /**
   * Add a point to this one.
   * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
   * @param {PIXI.Point} other    The point to add to `this`.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  add(other, outPoint = new Point3d()) {
    super.add(other, outPoint);
    outPoint.z = this.z + (other.z ?? 0);

    return outPoint;
  }

  /**
   * Subtract a point from this one.
   * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
   * @param {Point3d|PIXI.Point} other    The point to subtract from `this`.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  subtract(other, outPoint = new Point3d()) {
    super.subtract(other, outPoint);
    outPoint.z = this.z - (other.z ?? 0);

    return outPoint;
  }

  /**
   * Multiply `this` point by another.
   * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
   * @param {Point3d|PIXI.Point} other    The point to subtract from `this`.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  multiply(other, outPoint = new Point3d()) {
    super.multiply(other, outPoint);
    outPoint.z = this.z * (other.z ?? 0);

    return outPoint;
  }

  /**
   * Multiply `this` point by a scalar
   * Based on https://api.pixijs.io/@pixi/math-extras/src/pointExtras.ts.html
   * @param {Point3d|PIXI.Point} other    The point to subtract from `this`.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  multiplyScalar(scalar, outPoint = new Point3d()) {
    super.multiplyScalar(scalar, outPoint);
    outPoint.z = this.z * scalar;

    return outPoint;
  }

  /**
   * Dot product of this point with another.
   * (Sum of the products of the components)
   * @param {Point3d} other
   * @return {number}
   */
  dot(other) {
    return super.dot(other) + (this.z * (other.z ?? 0));
  }

  /**
   * Magnitude (length, or sometimes distance) of this point.
   * Square root of the sum of squares of each component.
   * @returns {number}
   */
  magnitude() {
    // Same as Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
    return Math.hypot(this.x, this.y, this.z);
  }

  /**
   * Magnitude squared.
   * Avoids square root calculations.
   * @returns {number}
   */
  magnitudeSquared() {
    return super.magnitudeSquared() + Math.pow(this.z, 2);
  }

  /**
   * Test if `this` is nearly equal to another point.
   * @param {PIXI.Point} other
   * @param {number} epsilon
   * @returns {boolean}
   */
  almostEqual(other, epsilon = EPSILON) {
    return super.almostEqual(other, epsilon) && this.z.almostEqual(other.z ?? 0, epsilon);
  }

  /**
   * Cross product between this point, considered here as a vector, and another vector.
   * @param {Point3d} other
   * @param {Point3d} [outPoint]  A point-like object in which to store the value.
   * @returns {Point3d}
   */
  cross(other, outPoint = new Point3d()) {
    outPoint.x = (this.y * other.z) - (this.z * other.y);
    outPoint.y = (this.z * other.x) - (this.x * other.z);
    outPoint.z = (this.x * other.y) - (this.y * other.x);

    return outPoint;
  }

  /**
   * Normalize the point.
   * @param {Point3d} [outPoint]    A point-like object in which to store the value.
   *   (Will create new point if none provided.)
   * @returns {Point3d}
   */
  normalize(outPoint = new Point3d()) {
    return super.normalize(outPoint);
  }
}
