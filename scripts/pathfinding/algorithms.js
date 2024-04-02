/* globals
canvas,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Draw } from "../geometry/Draw.js";
import { PriorityQueueArray } from "./PriorityQueueArray.js";

// See https://www.redblobgames.com/pathfinding/a-star/introduction.html


/**
 * Pathfinding objects used here must have the following properties:
 * - {object} key   Unique object, string, or number that can be used in a Set or as a Map key.
 * - {number} cost  For algorithms that measure value, the cost of this move.
 * Objects can have any other properties needed.
 */
export class BreadthFirstPathSearch {
  /** @type {PathNode[]} */
  frontier = [];

  /** @type {Map<PathNode.key, PathNode>} */
  cameFrom = new Map(); // Path a -> b stored as cameFrom[b] = a

  /** @type {boolean} */
  debug = false;

  /** @type {PathNode} */
  _start;

  /** @type {PathNode} */
  _goal;

  /**
   * Run the breadth first search on the graph.
   * Each object must have a unique key property used for comparison.
   * @param {PathNode} start    Path node representing start
   * @param {PathNode} goal     Path node representing end
   * @returns {Map<PathNode>} Path as the cameFrom map. Note that rerunning will change this return.
   */
  run(start, goal) {
    this.clear();
    this.start = start;
    this.goal = goal;
    this._run();

    // Mark the start and goal for the resulting path.
    const cameFrom = this.cameFrom;
    cameFrom.goal = goal;
    cameFrom.start = start;
    return cameFrom;
  }

  /**
   * Helper that can be extended by subclasses to run the pathfinding.
   */
  _run() {
    const frontier = this.frontier;
    frontier.unshift(this.start);
    while ( frontier.length ) { if ( this._step() ) break; }
  }

  /**
   * Evaluate destinations from the current location along the path.
   * @returns {boolean} If true, goal is reached.
   */
  _step() {
    const { frontier } = this;
    const current = frontier.pop();
    if ( this.debug ) current.entryTriangle.drawEdges();
    if ( this.debug ) Draw.point(current.entryPoint, { color: Draw.COLORS.lightgreen });
    if ( this.goalReached(current) ) return true;
    this._evaluateNeighbors(current);
    return false;
  }

  /**
   * Get each neighbor destionation and evaluate.
   * @param {PathNode} current
   */
  _evaluateNeighbors(current) {
    for ( const next of this.getNeighbors(current, this.goal) ) this._evaluateNeighbor(current, next);
  }

  /**
   * Evaluate a neighboring destination.
   * @param {PathNode} current
   * @param {PathNode} next
   */
  _evaluateNeighbor(current, next) {
    const { cameFrom, frontier } = this;
    if ( !cameFrom.has(next.key) ) {
      if ( this.debug ) Draw.point(next.entryPoint, { color: Draw.COLORS.lightyellow });
      frontier.unshift(next);
      cameFrom.set(next.key, current);
    }
  }

  /**
   * Goal testing method that can be overriden to handle different goals.
   * @param {PathNode} goal       Goal node
   * @param {PathNode} current    Current node
   * @returns {boolean} True if goal has been reached and pathfinding should stop.
   */
  goalReached(current) { return this.goal.key === current.key; }

  /**
   * Neighbor method that can be overriden to handle different objects.
   * @param {PathNode} pathNode   Object representing a graph node
   * @param {PathNode} goal       Goal node
   * @returns {Array[PathNode]} Array of neighboring nodes to the provided node.
   */
  getNeighbors(pathNode, _goal) { return pathNode.neighbors; }

  /**
   * Clear the path properties.
   */
  clear() {
    this.start = undefined;
    this.goal = undefined;
    this.frontier.length = 0;
    this.cameFrom.clear();
  }

  /**
   * Debugging. Get a nested array of all paths for this algorithm's cameFrom map.
   * @returns {PIXI.Point[][]}
   */
  getAllPathPoints() {
    const pathMap = this.cameFrom;
    const paths = [];
    for ( let [key, curr] of pathMap.entries() ) {
      const path = [PIXI.Point.invertKey(key)];
      paths.push(path);
      while ( pathMap.has(curr.key) ) {
        path.push(PIXI.Point.invertKey(curr.key));
        curr = pathMap.get(curr.key);
      }
      path.push(PIXI.Point.invertKey(curr.key));
      path.reverse();
    }
    return paths;
  }

  /**
   * Draw a single path.
   * @param {PIXI.Point[]} path   Array of points to draw
   * @param {object} [opts]       Options to pass to Draw.point and Draw.segment
   */
  drawPath(path, opts = {}) {
    let A = path[0];
    Draw.point(A, opts);
    for ( let i = 1; i < path.length; i += 1 ) {
      const B = path[i];
      Draw.point(B, opts);
      Draw.segment({ A, B }, opts);
      A = B;
    }
  }
}

/**
 * Dijkstra's Algorithm, or uniform cost path search.
 */
export class UniformCostPathSearch extends BreadthFirstPathSearch {
  /** @type {PriorityQueueArray<PathNode>} */
  frontier = new PriorityQueueArray("low");

  /** @type {Map<PathNode.key, number>} */
  costSoFar = new Map();

  clear() {
    this.start = undefined;
    this.goal = undefined;
    this.frontier.clear();
    this.costSoFar.clear();
    this.cameFrom.clear();
  }

  /**
   * Helper that can be extended by subclasses to run the pathfinding.
   */
  _run() {
    const { costSoFar, frontier } = this;
    frontier.enqueue(this.start, 0);
    costSoFar.set(this.start.key, 0);
    while ( frontier.length ) { if ( this._step() ) break; }
  }

  /**
   * Evaluate destinations from the current location along the path.
   * @returns {boolean} If true, goal is reached.
   */
  _step() {
    const { frontier } = this;
    const current = frontier.dequeue();
    if ( this.debug ) current.entryTriangle.drawEdges();
    if ( this.debug ) Draw.point(current.entryPoint, { color: Draw.COLORS.lightgreen });
    if ( this.goalReached(current) ) return true;
    this._evaluateNeighbors(current);
    return false;
  }

  /**
   * Evaluate a neighboring destination.
   * @param {PathNode} current
   * @param {PathNode} next
   */
  _evaluateNeighbor(current, next) {
    const MAX_COST = canvas.dimensions.maxR;
    const { costSoFar, frontier } = this;
    const newCost = (costSoFar.get(current.key) ?? MAX_COST) + next.cost;
    if ( costSoFar.has(next.key) && newCost >= costSoFar.get(next.key) ) return;

    if ( this.debug ) Draw.point(next.entryPoint, { color: Draw.COLORS.orange });
    costSoFar.set(next.key, newCost);
    frontier.enqueue(next, newCost); // Priority is newCost
    this.cameFrom.set(next.key, current);
  }
}

/**
 * Greedy search
 */
export class GreedyPathSearch extends BreadthFirstPathSearch {
  /** @type {PriorityQueueArray<PathNode>} */
  frontier = new PriorityQueueArray("low");

  clear() {
    this.start = undefined;
    this.goal = undefined;
    this.frontier.clear();
    this.cameFrom.clear();
  }

  /**
   * Heuristic that takes a goal node and a current node and returns a priority.
   * Lower numbers are preferable.
   * @param {PathNode} goal
   * @param {PathNode} current
   */
  heuristic = (goal, current) => PIXI.Point.distanceBetween(goal.entryPoint, current.entryPoint);

  /**
   * Helper that can be extended by subclasses to run the pathfinding.
   * @param {PathNode} start    Path node representing start
   * @param {PathNode} goal     Path node representing end
   */
  _run() {
    const frontier = this.frontier;
    frontier.enqueue(this.start, 0);
    while ( frontier.length ) { if ( this._step() ) break; }
  }

  /**
   * Evaluate a neighboring destination.
   * @param {PathNode} current
   * @param {PathNode} next
   */
  _evaluateNeighbor(current, next) {
    const cameFrom = this.cameFrom;
    if ( cameFrom.has(next.key) ) return;

    const MAX_COST = canvas.dimensions.maxR;
    if ( this.debug ) Draw.point(next.entryPoint, { color: Draw.COLORS.orange });
    const priority = this.heuristic(this.goal, next) ?? MAX_COST;
    this.frontier.enqueue(next, priority);
    cameFrom.set(next.key, current);

  }
}

export class AStarPathSearch extends UniformCostPathSearch {
  /**
   * Heuristic that takes a goal node and a current node and returns a priority.
   * Lower numbers are preferable.
   * @param {PathNode} goal
   * @param {PathNode} current
   */
  heuristic = (goal, current) => PIXI.Point.distanceBetween(goal.entryPoint, current.entryPoint);

  /**
   * Evaluate a neighboring destination.
   * @param {PathNode} current
   * @param {PathNode} next
   */
  _evaluateNeighbor(current, next) {
    const MAX_COST = canvas.dimensions.maxR;
    const { costSoFar, frontier } = this;
    const newCost = (costSoFar.get(current.key) ?? MAX_COST) + next.cost;
    if ( costSoFar.has(next.key) && newCost >= costSoFar.get(next.key) ) return;

    if ( this.debug ) Draw.point(next.entryPoint, { color: Draw.COLORS.orange });
    costSoFar.set(next.key, newCost);
    const priority = newCost + this.heuristic(this.goal, next);
    frontier.enqueue(next, priority);
    this.cameFrom.set(next.key, current);
  }
}
