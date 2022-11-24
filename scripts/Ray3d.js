/* globals
Ray,
canvas
*/
"use strict";

import { Point3d } from "./Point3d.js";
import { projectElevatedPoint } from "./util.js";

// Add methods to Ray (2d)
export function registerRayMethods() {
  Object.defineProperty(Ray.prototype, "gameDistance", {
    value: gameDistance,
    writable: true,
    configurable: true
  });
}

/**
 * Measure ray distance using the game rules for diagonals.
 * @param {boolean} gridSpaces Base distance on the number of grid spaces moved?
 * @returns {number}
 */
function gameDistance(gridSpaces) {
  return canvas.grid.grid.measureDistances([{ ray: this }], { gridSpaces });
}

/**
 * Using Point3d, extend the Ray class to 3 dimensions.
 * Not all methods are extended to 3d, just desirable ones for Elevation Ruler.
 * @param {Point3d|Point} A
 * @param {Point3d|Point} B
 */
export class Ray3d extends Ray {
  constructor(A, B) {
    if ( !(A instanceof Point3d) ) A = new Point3d(A.x, A.y, A.z);
    if ( !(B instanceof Point3d) ) B = new Point3d(B.x, B.y, B.z);

    super(A, B);

    /**
     * The elevated distance of the ray, z1 - z0
     * @type {number}
     */
    this.dz = B.z - A.z;
  }

  /**
   * Convert a 2d ray to 3d, copying over values.
   * @param {Ray} ray2d
   * @param {object} [options]
   * @param {number} [Az]   Elevation of the A point
   * @param {number} [Bz]   Elevation of the B point
   * @returns {Ray3d}
   */
  static from2d(ray2d, { Az = 0, Bz = 0 } = {}) {
    const r = new this({ x: ray2d.A.x, y: ray2d.A.y, z: Az }, { x: ray2d.B.x, y: ray2d.B.y, z: Bz });
    r._angle = ray2d._angle;

    // TODO: Could copy over distance2 and add in the z distance2, but would need to cache this in Rays.
    return r;
  }

  /**
   * The distance (length) of the Ray in pixels.
   * Computed lazily and cached
   * @override
   * @type {number}
   */
  get distance() {
    return this._distance ?? (this._distance = Math.hypot(this.dx, this.dy, this.dz));
  }

  set distance(value) {
    this._distance = Number(value);
  }

  /**
   * Project the Ray by some proportion of its initial path.
   * @override
   * @param {number} t    Distance along the Ray
   * @returns {Point3d}   Coordinates of the projected distance
   */
  project(t) {
    const pt = super.project(t);
    return new Point3d(pt.x, pt.y, this.A.z + (t * this.dz));
  }

  /**
   * Project the Ray onto the 2d XY canvas surface.
   * Preserves distance but not location.
   * Done in a manner to allow diagonal distance to be measured.
   * @returns {Ray} The 2d ray.
   */
  projectOntoCanvas() {
    const [newA, newB] = projectElevatedPoint(this.A, this.B);
    return new Ray(newA, newB);
  }

  /**
   * Measure ray distance using the game rules for diagonals.
   * The trick here is to first project the ray to the 2d canvas in a manner that
   * preserves diagonal movement.
   * @param {boolean} gridSpaces Base distance on the number of grid spaces moved?
   * @returns {number}
   */
  gameDistance(gridSpaces) {
    const r = this.projectOntoCanvas();
    return r.gameDistance(gridSpaces);
  }
}
