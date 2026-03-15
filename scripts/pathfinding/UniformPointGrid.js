/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/**
 * Simple uniform grid. Divides world into fixed grid of cells.
 * Each cell contains a list of points.
 * When an AABB is queried, only check points for the overlapping cells.
 */
export class UniformPointGrid {
  /** @type {number} */
  width = canvas.scene.dimensions.width;

  /** @type {number} */
  height = canvas.scene.dimensions.height;

  cellExponent = nearestPowerOfTwo(canvas.scene.dimensions.size * 2); // Double a grid square.

  /* For cell size that is power of two,
   * replace Math.floor(x / cellSize) with x >> exp
   */
  cellSizeInv = 1 / Math.pow(2, this.cellExponent);

  /** @type {Map<number, PIXI.Point[]>} */
  grid = new Map();

  get cols() { return Math.ceil(this.width * this.cellSizeInv); }

  get rows() { return Math.ceil(this.height * this.cellSizeInv); }

  clear() { this.grid.clear(); }

  /**
   * Map {x, y} to single grid index.
   * @param {PIXI.Point} pt
   * @returns {number}
   */
  #getIndex(pt) {
    const exp = this.cellExponent;
    const col = pt.x >> exp;
    const row = pt.y >> exp;
    return col + (row * this.cols);
  }

  /**
   * Add a point to the grid. Points may be repeated.
   * @param {PIXI.Point} pt
   */
  insertPoint(pt) {
    const grid = this.grid;
    const idx = this.#getIndex(pt);
    const arr = grid.get(idx) ?? [];
    if ( !grid.has(idx) ) grid.set(idx, arr);
    arr.push(pt);
  }

  /**
   * Get points from the grid that are within a bounding box.
   * @param {AABB2d} aabb
   * @returns {PIXI.Point[]}
   */
  query(aabb) {
    const exp = this.cellExponent;
    const cols = this.cols;
    const colStart = Math.max(0, aabb.min.x >> exp);
    const colEnd = Math.min(cols, aabb.max.x >> exp);
    const rowStart = Math.max(0, aabb.min.y >> exp);
    const rowEnd = Math.min(this.rows, aabb.max.y >> exp);

    // Find overlapping grid squares and then confirm each point for the grid square.
    const results = [];
    for ( let r = rowStart; r < rowEnd; r += 1 ) {
      for ( let c = colStart; c < colEnd; c += 1 ) {
        const cell = this.grid.get(c + (r * cols)) || [];
        for ( const p of cell ) {
          if ( aabb.containsPoint(p) ) results.push(p);
        }
      }
    }
    return results;
  }
}

/**
 * Round positive number to nearest power of two.
 * @param {number} n
 * @returns {number} Exponent 2^x
 */
function nearestPowerOfTwo(n) {
  if ( n <= 0 ) return 1;
  return Math.round(Math.log2(n));
}

/**
 * Faster rounding using bit math with 32-bit integers.
 */
function nextPowerOfTwo(n) {
  n = (n + 0.5) | 0; // Equivalent to Math.round(n);
  n |= n >> 1;
  n |= n >> 2;
  n |= n >> 4;
  n |= n >> 8;
  n |= n >> 16;
  return n + 1;
}

function fastNearestPowerOfTwo(n) {
  const next = nextPowerOfTwo(n);
  const prev = next >> 1;
  return (next - n) < (n - prev) ? next : (prev || 1);
}
