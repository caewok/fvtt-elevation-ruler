/* globals
canvas,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AABB2d } from "../geometry/AABB.js";
import { Point3d } from "../geometry/3d/Point3d.js";
import { Draw } from "../geometry/Draw.js";
import { AbstractPathfinder } from "./AbstractPathfinder.js";
import { PriorityQueue } from "./PriorityQueue.js";

/* Basic pathfinding algorithms.

AbstractPathfindingWorld
- getNeighbors
- heuristic

canvas.grid.getAdjacentOffsets
canvas.grid.testAdjacency

AbstractSimplePathfinding

*/


export class SimplePathfindingWorld {
  static manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

  static manhattan3d(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z); }

  static euclidean(a, b) { return PIXI.Point.distanceBetween(a, b); }

  static euclidean3d(a, b) { return Point3d.distanceBetween(a, b); }

  static foundryMeasure(a, b) { return canvas.grid.measurePath([a, b]).cost; }

  /** @type {function} */
  cost = this.constructor.euclidean;

  /** @type {function} */
  heuristic = this.constructor.euclidean;

  /**
   * Get the neighbors
   * @param {GridCoordinates} node
   * @returns {GridCoordinates[]}
   */
  getNeighbors(node) {
    return canvas.grid.getAdjacentOffsets(node).map(offset => node.constructor.fromOffset(offset));
  }
}

export class FoundryPathfindingWorld extends SimplePathfindingWorld {
  /** @type {function} */
  heuristic = this.constructor.foundryMeasure;

  /** @type {function} */
  cost = this.constructor.foundryMeasure;

  /** @type {PointSourcePolygon} */
  #poly = new foundry.canvas.geometry.ClockwiseSweepPolygon();

  /**
   * Get the neighbors
   * @param {GridCoordinates} node
   * @returns {GridCoordinates[]}
   */
  getNeighbors(node) {
    const allNeighbors = super.getNeighbors(node);
    const aabb = AABB2d.fromPoints(allNeighbors);
    const poly = this.#poly;
    poly.initialize(node, { type: "move", boundaryShapes: [aabb.toPIXIRectangle()] });
    return allNeighbors.filter(n => {
      const ray = new foundry.canvas.geometry.Ray(node, n);
      return !this.#poly._testCollision(ray, "any", n);
    });
  }
}

/**
 * Basic frontier that simply uses an array.
 * Mimics PriorityQueue so that can be used as a frontier.
 */
class Frontier extends Array {
  // Priority is ignored in base version.
  enqueue(value, _priority) { return this.push(value); }

  dequeue() { return this.shift(); }

  clear() { this.length = 0; }
}

/**
 * BFS explores neighbors layer by layer.
 * It is optimal for unweighted graphs (where every step costs exactly 1).
 */
export class BFSPathfinder extends AbstractPathfinder {

  /** @type {AbstractPathfindingWorld} */
  world = new FoundryPathfindingWorld();

  _cameFrom = new Map();

  _frontier = new Frontier();

  /**
   * Find the path between startPoint and endPoint using the chosen algorithm.
   * @param {Point} start       Start point for the graph
   * @param {Point} goal        End point for the graph
   */
  async findPath(start, goal) {
    // Frontier tracks next neighbors to be visited.
    this._initializePathfindingRun(start);

    while ( this._frontier.length > 0 ) {
      const current = this._frontier.dequeue();
      if ( current.almostEqual(goal) ) return this.constructor.reconstructPath(this._cameFrom, goal);
      for ( let next of this.world.getNeighbors(current) ) this._processFrontierNeighbors(current, next, goal);
    }
    return null;
  }

  /**
   * Initialize the pathfinding run.
   */
  _initializePathfindingRun(start) {
    this._initializeFrontier(start);
    this._initializeCameFrom(start);
  }

  /**
   * Clear and initialize the frontier for pathfinding run.
   * Frontier tracks next neighbors to be visited.
   * @param {Point} start
   */
  _initializeFrontier(start) {
    this._frontier.clear();
    this._frontier.enqueue(start, 0); // Priority is ignored in base version.
  }

  /**
   * Clear and initialize the frontier for pathfinding run.
   * The cameFrom map tracks visited nodes.
   * @param {Point} start
   */
  _initializeCameFrom(start) {
    this._cameFrom.clear();
    this._cameFrom.set(start.key, null);
  }

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   */
  _processFrontierNeighbors(current, next) {
    if ( !this._cameFrom.has(next.key) ) {
      this._frontier.enqueue(next);
      this._cameFrom.set(next.key, current);
    }
  }

  /**
   * For a given goal, reconstruct the path to the beginning.
   * @param {Map<number, GridCoordinate|null>} cameFrom
   * @param {GridCoordinate} goal
   * @returns {GridCoordinate[]}
   */
  static reconstructPath(cameFrom, goal) {
    let current = goal;
    const path = [];
    while ( current !== null ) {
      path.push(current); // Push + reverse likely faster then unshift.
      current = cameFrom.get(current.key);
    }
    return path.reverse();
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {object} [opts]
   */
  drawDebug(start, goal, opts = {}) {
    const gridShape = new PIXI.Polygon(canvas.grid.getShape());
    opts.fill ??= Draw.COLORS.blue;
    opts.fillAlpha ??= 0.10;
    opts.alpha ??= 0;
    for ( const node of this._cameFrom.values() ) {
      if ( !node ) continue;
      Draw.shape(gridShape.translate(node.x, node.y), opts);
    }
  }
}

/**
 * UCS is essentially Dijkstra’s Algorithm.
 * It expands the node with the lowest cumulative cost g(n) from the start.
 */
export class UniformCostPathfinder extends BFSPathfinder {

  _costSoFar = new Map();

  _frontier = new PriorityQueue("low");

  /**
   * Initialize the pathfinding run.
   */
  _initializePathfindingRun(start) {
    super._initializePathfindingRun(start);
    this._initializeCostSoFar(start);
  }

  /**
   * Clear and initialize the cost map for pathfinding run.
   * The costSoFar map tracks costs to reach different nodes.
   * @param {Point} start
   */
  _initializeCostSoFar(start) {
    this._costSoFar.clear();
    this._costSoFar.set(start.key, 0);
  }

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   */
  _processFrontierNeighbors(current, next) {
    const costSoFar = this._costSoFar;
    const newCost = costSoFar.get(current.key) + this.world.cost(current, next);
    if ( !costSoFar.has(next.key) || newCost < costSoFar.get(next.key) ) {
      costSoFar.set(next.key, newCost);
      this._frontier.enqueue(next, newCost);
      this._cameFrom.set(next.key, current);
    }
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {object} [opts]
   */
  drawDebug(start, goal, opts = {}) {
    const gridShape = new PIXI.Polygon(canvas.grid.getShape());
    const costMinMax = Math.minMax(...this._costSoFar.values());
    opts.fill ??= Draw.COLORS.blue;
    opts.alpha ??= 0;
    opts.fillAlpha ??= 1;

    for ( const node of this._cameFrom.values() ) {
      if ( !node ) continue;
      const nodeCost = this._costSoFar.get(node.key);
      opts.fillAlpha = (nodeCost - costMinMax.min) / (costMinMax.max - costMinMax.min);
      Draw.shape(gridShape.translate(node.x, node.y), opts);
    }
  }
}

/**
 * This algorithm uses a heuristic $h(n)$ to estimate the distance to the goal.
 * It is fast but not guaranteed to find the shortest path because it ignores the cost already traveled.
 */
export class GreedyBestFirstPathfinder extends BFSPathfinder {

  _frontier = new PriorityQueue("low");

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   */
  _processFrontierNeighbors(current, next, goal) {
    if ( !this._cameFrom.has(next.key) ) {
      const priority = this.world.heuristic(next, goal);
      this._frontier.enqueue(next, priority);
      this._cameFrom.set(next.key, current);
    }
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {object} [opts]
   */
  drawDebug(start, goal, opts = {}) {
    const gridShape = new PIXI.Polygon(canvas.grid.getShape());
    opts.fill ??= Draw.COLORS.blue;
    opts.alpha ??= 0;
    opts.fillAlpha ??= 1;

    const nodesSeen = new Set();
    const costMax = this.world.heuristic(start, goal);
    for ( const node of this._cameFrom.values() ) {
      if ( !node || nodesSeen.has(node.key) ) continue;
      nodesSeen.add(node.key);
      const nodeCost = this.world.heuristic(node, goal);
      opts.fillAlpha = nodeCost / costMax;
      Draw.shape(gridShape.translate(node.x, node.y), opts);
    }
  }

}

/**
 * A* combines the strengths of UCS and Greedy search.
 * It uses f(n) = g(n) + h(n) to stay efficient while guaranteeing the shortest path
 * (provided the heuristic is admissible).
 */
export class AStarPathfinder extends UniformCostPathfinder {
  /**
   * Apply a given algorithm to process neighbors along the frontier.
   */
  _processFrontierNeighbors(current, next, goal) {
    const costSoFar = this._costSoFar;
    const newCost = costSoFar.get(current.key) + this.world.cost(current, next);
    if ( !costSoFar.has(next.key) || newCost < costSoFar.get(next.key) ) {
      costSoFar.set(next.key, newCost);

      // Priority = g(n) + h(n).
      const priority = newCost + this.world.heuristic(next, goal);
      this._frontier.enqueue(next, priority);
      this._cameFrom.set(next.key, current);
    }
  }

  /**
   * Specialized debug draw for the algorithm.
   * @param {object} [opts]
   */
  drawDebug(start, goal, opts = {}) {
    const gridShape = new PIXI.Polygon(canvas.grid.getShape());
    const costMinMax = Math.minMax(...this._costSoFar.values());
    opts.fill ??= Draw.COLORS.blue;
    opts.alpha ??= 0;
    opts.fillAlpha ??= 1;

    const nodesSeen = new Set();
    for ( const node of this._cameFrom.values() ) {
      if ( !node || nodesSeen.has(node) ) continue;
      nodesSeen.add(node);
      const nodeCost = this._costSoFar.get(node.key) + this.world.heuristic(node, goal);
      opts.fillAlpha = (nodeCost - costMinMax.min) / (costMinMax.max - costMinMax.min);
      Draw.shape(gridShape.translate(node.x, node.y), opts);
    }
  }
}

/* Testing
Draw = CONFIG.GeometryLib.Draw;
GridCoordinates = CONFIG.GeometryLib.GridCoordinates
api = game.modules.get("elevationruler").api
let { BFSPathfinder,
      UniformCostPathfinder,
      GreedyBestFirstPathfinder,
      AStarPathfinder } = api.pathfinding;

let randal = canvas.tokens.placeables.find(t => t.name === "Randal")
let zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")

start = GridCoordinates.fromObject(randal.center)
end = GridCoordinates.fromObject(zanna.center)

pf = new BFSPathfinder()
pf = new UniformCostPathfinder()
pf = new GreedyBestFirstPathfinder()
pf = new AStarPathfinder()


path = await pf.findPath(start, end)
pf.drawDebug()
BFSPathfinder.drawPath(path)



*/
