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

  /**
   * Get the closest node to end coordinates.
   * Necessary so the end goal can be matched.
   */
  closestNode(position) { return position.center; }
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

  stop = false;

  /**
   * Find the path between startPoint and endPoint using the chosen algorithm.
   * @param {Point} start       Start point for the graph
   * @param {Point} goal        End point for the graph
   */
  async findPath(start, goal) {
    // Frontier tracks next neighbors to be visited.
    this._initializePathfindingRun(start);
    goal = this.world.closestNode(goal);

    while ( this._frontier.length > 0 && !this.stop ) {
      const current = this._frontier.dequeue();
      // console.debug(`${this.constructor.name}|Processing frontier ${current.x},${current.y}`)
      if ( current.almostEqual(goal) ) return this.constructor.reconstructPath(this._cameFrom, goal);
      await this._processFrontierNeighbors(current, goal);
    }
    return null;
  }

  /**
   * Initialize the pathfinding run.
   */
  _initializePathfindingRun(start) {
    this.stop = false;
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
   * Asynchronously process all the neighbors for the current node of the frontier.
   * Async so it can be stopped.
   * @param {Point} current
   */
  async _processFrontierNeighbors(current, goal) {
    for ( let next of this.world.getNeighbors(current) ) this._processFrontierNeighbor(current, next, goal);
  }

  /**
   * Apply a given algorithm to process neighbors along the frontier.
   */
  _processFrontierNeighbor(current, next) {
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
  _processFrontierNeighbor(current, next) {
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
  _processFrontierNeighbor(current, next, goal) {
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
  _processFrontierNeighbor(current, next, goal) {
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
// end.y += 25

pf = new BFSPathfinder()
pf = new UniformCostPathfinder()
pf = new GreedyBestFirstPathfinder()
pf = new AStarPathfinder()


path = await pf.findPath(start, end)
pf.drawDebug()
BFSPathfinder.drawPath(path)

end = GridCoordinates.fromObject(zanna.center)
end.y += 25
path = pf.findPath(start, end)
setTimeout(() => {
  console.log("--- Cancel button clicked! ---");
  pf.stop = true
}, 1);


path = pf.findPath(start, end)
pf.stop = true;


// Test

class TestClass {
  isRunning = false;

  progress = 0;

  async longRunningProcess() {
    this.isRunning = true;
    this.progress = 0;

    console.log("Starting loop...");

    while (this.isRunning) {
      // 1. Perform an async task
      console.log(`Processing step ${this.progress}...`);
      // await new Promise(resolve => setTimeout(resolve, 1000));
      await this.subprocess();

      // 2. IMMEDIATE CHECK
      // If the flag was flipped during the 'await' above, exit now.
      if (!this.isRunning) {
        break;
      }

      // 3. Update internal logic
      this.progress++;

      if (this.progress >= 10) {
        console.log("Task finished naturally.");
        break;
      }
    }

    console.log("Loop has exited. Cleaning up resources...");
    this.isRunning = false;
  }

//   async subprocess() {
//     console.log("...running subprocess");
//     await new Promise(resolve => setTimeout(resolve, 1000));
//     console.log("...finished subprocess");
//   }

  async subprocess() {
    return new Promise(resolve => {
      pf.findPath
    })

    const path = await pf.findPath(start, end)
  }
}

// Start the process
test = new TestClass()

test.longRunningProcess();

// Simulate a user clicking "Cancel" after 3.5 seconds
setTimeout(() => {
  console.log("--- Cancel button clicked! ---");
  test.isRunning = false;
}, 3500);




let isCancelled = false;

// A generic async function that might be doing
// file I/O, heavy calculation, or database work
async function processChunk(id) {
  // Simulating any async work
  let a = 1;
  for ( let i = 0; i < 1000000; i += 1 ) a *= i;
//   return new Promise(resolve => {
//     console.log(`Working on ID: ${id}`);
//     resolve(`Result ${id}`);
//   });
}

async function runHeavyTask() {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  for (const item of items) {
    // 1. Check BEFORE starting the next task
    if (isCancelled) {
      console.log("Cancelled before.")
      break;
    }

    // 2. The generic async call
    const result = await processChunk(item);

    // 3. Check AFTER the task finishes
    if (isCancelled) {
      console.log("Stopping after task finished.");
      return;
    }

    console.log("Processed:", result);
  }

}

// Start the loop
runHeavyTask();

// Later, an external event cancels it
isCancelled = true;





*/
