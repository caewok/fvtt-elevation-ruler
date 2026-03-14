/* globals
canvas,
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { Draw } from "../geometry/Draw.js";


/**
 * Settings specific to the algorithm used with the graph to define nodes.
 * This is ostensibly stateless. Only saved values should be objects that can be
 * cached over multiple find paths for a single start point (e.g., single token drag).
 */
export class GraphPathfindingWorld {

  /** @type {object} */
  config = {};

  /**
   * @typedef {GridCoordinates|GridCoordinates3d} Node
   */

  /**
   * Cost to move from a -> b.
   * @type {function}
   * @param {Node} a
   * @param {Node} b
   */
  cost() { return 0; }

  /**
   * Estimated cost to move from a -> b.
   * @type {function}
   * @param {Node} a
   * @param {Node} b
   */
  heuristic() { return 0; }

  /**
   * From a location on the canvas, construct the corresponding node.
   * @param {Point|Point3d} pt
   * @returns {Node}
   */
  buildNode(pt) { return pt; }

  /**
   * Initialize this world for a given path construction.
   * @param {Token} token     Token doing the movement
   */
  token;

  initialize(token) { this.token = token; }

  /**
   * Filter the neighbors for this node, keeping only valid neighbors.
   * @param {Node[]} neighbors    Neighbors to the originating node
   * @param {Node} node           The originating node
   * @returns {Node[]}
   */
  filterNeighbors(neighbors, _node) { return neighbors; }

  /**
   * Determine adjacent offsets to a node.
   * @param {Node} node
   * @returns {Node[]}
   */
  adjacentOffsets(node) { return canvas.grid.getAdjacentOffsets(node); }

  /**
   * Get valid adjacent neighbors to a node.
   * @param {Node} node
   * @returns {Node[]}
   */
  getNeighbors(node) {
    const neighbors = this.adjacentOffsets(node);
    return this.filterNeighbors(neighbors, node);
  }

  /**
   * Check if a node is definitely unreachable. For example, within a blocking token.
   * @param {Node} node
   * @param {Node} start
   * @returns {boolean}
   */
  nodeIsUnreachable(node, start) {
    if ( !canvas.scene.dimensions.sceneRect.contains(node.x, node.y) ) return true;

    // Is the node in a different enclosed room than start?
    const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
    const nodeFace = sceneGraph.pointIsInFace(node);
    const startFace = sceneGraph.pointIsInFace(start);
    if ( !(nodeFace || startFace) || nodeFace === startFace ) return false;

    // Possible that we just got unlucky and there are multiple faces for this point.
    const nodeFaces = sceneGraph.enclosedFacesForPoint(node);
    const startFaces = sceneGraph.enclosedFacesForPoint(start);
    return !nodeFaces.intersects(startFaces);
  }

  startPathfinding(_start, _goal) { }

  /**
   * Did we reach the goal node?
   * @param {Node} curr
   * @param {Node} goal
   */
  reachedGoal(curr, goal) { return curr.key === goal.key; }

  /**
   * Maximum number of iterations given a start and end coordinate.
   * Used to stop if no path.
   * @param {Node} start
   * @param {Node} goal
   * @returns {number}
   */
  static maxIterations(start, _goal) {
    // Number of steps from start to the edge of the scene.
    // For a grid, 1 step is one grid square.
    const { sceneRect, size } = canvas.scene.dimensions;
    if ( canvas.grid.isGridless ) {
      const maxDist = Math.max(
        sceneRect.width - start.x,
        start.x - sceneRect.x,
        sceneRect.height - start.y,
        start.y - sceneRect.y,
      );
      return Math.ceil(maxDist / (this.resolution || 1)); // TODO: Resolution for gridless.

    } else {
      const maxDist = Math.max(
        sceneRect.width - start.x,
        start.x - sceneRect.x,
        sceneRect.height - start.y,
        start.y - sceneRect.y,
      );
      return Math.ceil(maxDist / size);
    }
  }

  /**
   * Given obstacles in the world, determine what the maximum and minimum z values should be
   * for obstacle avoidance in 3d.
   * @returns {object}
   * - @prop {number} min
   * - @prop {number} max
   */
  static zMaxMin() {
    const token0 = canvas.tokens.placeables[0];
    let min = token0.bottomZ;
    let max = token0.topZ;

    canvas.walls.placeables.forEach(wall => {
      ({ min, max } = Math.minMax(min, max, isFinite(wall.bottomZ)
        ? wall.bottomZ : min, isFinite(wall.topZ) ? wall.topZ : max));
    });
    canvas.tiles.placeables.forEach(tile => {
      ({ min, max } = Math.minMax(min, max, tile.elevationZ));
    });
    canvas.regions.placeables.forEach(region => {
      ({ min, max } = Math.minMax(min, max, isFinite(region.bottomZ)
        ? region.bottomZ : min, isFinite(region.topZ) ? region.topZ : max));
    });
    canvas.tokens.placeables.forEach(token => {
      ({ min, max } = Math.minMax(min, max, token.topZ, token.bottomZ));
    });
    return { min, max };
  }

  drawNode(node, opts = {}) { Draw.point(node, opts); }
}
