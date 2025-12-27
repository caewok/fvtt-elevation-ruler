/* globals
game,
CONST,
canvas,
Ruler,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

/* Pathfinding class.

Abstract class used to build path between 2 points.
Each pathfinding algorithm implements this class.
Very basic.
- empty constructor
- async initialize
- token property to pathfind for specific token characteristics.

*/

export class AbstractPathfinder {
  /** @type {Token} token */
  token;

  /**
   * Initialize the pathfinder algorithm.
   */
  async initialize() { }

  /**
   * Update the scene-related objects for the pathfinder algorithm.
   */
  async updateScene() { }

  /**
   * Find the path between startPoint and endPoint using the chosen algorithm.
   * @param {Point} startPoint      Start point for the graph
   * @param {Point} endPoint        End point for the graph
   */
  async findPath(startPoint, endPoint) { return canvas.grid.directPath(startPoint, endPoint); }

  /**
   * Debug.
   * Draw the points of the path.
   * @param {Point[]} pathPoints
   * @param {object} [opts]
   */
  static drawPath(pathPoints, opts) {
    const nPts = pathPoints.length;
    let prior = pathPoints[0];
    Draw.point(prior);
    for ( let i = 1; i < nPts; i += 1 ) {
      const curr = pathPoints[i];
      Draw.segment({A: prior, B: curr}, opts);
      Draw.point(curr, opts);
      prior = curr;
    }
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {Point} startPoint      Start point for the graph
   * @param {Point} endPoint        End point for the graph
   * @param {object} [opts]
   */
  drawDebug(startPoint, endPoint, opts) { }
}

