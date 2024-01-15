/* globals
canvas,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Draw } from "../geometry/Draw.js";
import { PriorityQueueArray } from "./PriorityQueueArray.js";
// import { PriorityQueue } from "./PriorityQueue.js";

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

  /**
   * Run the breadth first search on the graph.
   * Each object must have a unique key property used for comparison.
   * @param {PathNode} start    Path node representing start
   * @param {PathNode} goal     Path node representing end
   * @returns {Map<PathNode>} Path as the cameFrom map. Note that rerunning will change this return.
   */
  run(start, goal) {
    this.clear();
    const { cameFrom, frontier } = this;
    frontier.unshift(start);

    while ( frontier.length ) {
      const current = frontier.pop();
      if ( this.debug ) Draw.point(current.entryPoint, { color: Draw.COLORS.green });
      if ( this.goalReached(goal, current) ) break;

      // Get each neighbor destination in turn.
      for ( const next of this.getNeighbors(current, goal) ) {
        if ( !cameFrom.has(next.key) ) {
          if ( this.debug ) Draw.point(next.entryPoint, { color: Draw.COLORS.lightgreen });
          frontier.unshift(next);
          cameFrom.set(next.key, current);
        }
      }
    }

    cameFrom.goal = goal;
    cameFrom.start = start;
    return cameFrom;
  }

  /**
   * Goal testing method that can be overriden to handle different goals.
   * @param {PathNode} goal       Goal node
   * @param {PathNode} current    Current node
   * @returns {boolean} True if goal has been reached and pathfinding should stop.
   */
  goalReached(goal, current) { return goal.key === current.key; }

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
    this.frontier.length = 0;
    this.cameFrom.clear();
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
    this.frontier.clear();
    this.costSoFar.clear();
    this.cameFrom.clear();
  }

  /**
   * Run the cost search on the graph.
   * Each PathNode must have a unique key property used for comparison
   * and cost property used to value cost so far.
   * @param {PathNode} start    Path node representing start
   * @param {PathNode} goal     Path node representing end
   * @returns {Map<PathNode>} Path as the cameFrom map. Note that rerunning will change this return.
   */
  run(start, goal) {
    this.clear();
    const { cameFrom, costSoFar, frontier } = this;

    frontier.enqueue(start, 0);
    costSoFar.set(start.key, 0);
    const MAX_COST = canvas.dimensions.maxR;

    while ( frontier.length ) {
      const current = frontier.dequeue();
      if ( this.debug ) Draw.point(current.entryPoint, { color: Draw.COLORS.green });
      if ( this.goalReached(goal, current) ) break;

      // Get each neighbor destination in turn.
      for ( const next of this.getNeighbors(current, goal) ) {
        const newCost = (costSoFar.get(current.key) ?? MAX_COST) + next.cost;
        if ( !costSoFar.has(next.key) || newCost < costSoFar.get(next.key) ) {
          if ( this.debug ) Draw.point(next.entryPoint, { color: Draw.COLORS.lightgreen });
          costSoFar.set(next.key, newCost);
          frontier.enqueue(next, newCost); // Priority is newCost
          cameFrom.set(next.key, current);
        }
      }
    }

    cameFrom.goal = goal;
    cameFrom.start = start;
    return cameFrom;
  }
}

/**
 * Greedy search
 */
export class GreedyPathSearch extends BreadthFirstPathSearch {
  /** @type {PriorityQueueArray<PathNode>} */
  frontier = new PriorityQueueArray("low");

  clear() {
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
   * Run the cost search on the graph.
   * Each PathNode must have a unique key property used for comparison
   * and cost property used to value cost so far.
   * @param {PathNode} start    Path node representing start
   * @param {PathNode} goal     Path node representing end
   * @returns {Map<PathNode>} Path as the cameFrom map. Note that rerunning will change this return.
   */
  run(start, goal) {
    this.clear();
    const { cameFrom, frontier } = this;

    frontier.enqueue(start, 0);
    const MAX_COST = canvas.dimensions.maxR;

    while ( frontier.length ) {
      const current = frontier.dequeue();
      if ( this.debug ) Draw.point(current.entryPoint, { color: Draw.COLORS.green });
      if ( this.goalReached(goal, current) ) break;

      // Get each neighbor destination in turn.
      for ( const next of this.getNeighbors(current, goal) ) {
        if ( !cameFrom.has(next.key) ) {
          if ( this.debug ) Draw.point(next.entryPoint, { color: Draw.COLORS.lightgreen });
          const priority = this.heuristic(goal, next) ?? MAX_COST;
          frontier.enqueue(next, priority);
          cameFrom.set(next.key, current);
        }
      }
    }

    cameFrom.goal = goal;
    cameFrom.start = start;
    return cameFrom;
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
   * Run the cost search on the graph.
   * Each PathNode must have a unique key property used for comparison
   * and cost property used to value cost so far.
   * @param {PathNode} start    Path node representing start
   * @param {PathNode} goal     Path node representing end
   * @returns {Map<PathNode>} Path as the cameFrom map. Note that rerunning will change this return.
   */
  run(start, goal) {
    this.clear();
    const { cameFrom, costSoFar, frontier } = this;

    frontier.enqueue(start, 0);
    costSoFar.set(start.key, 0);
    const MAX_COST = canvas.dimensions.maxR;

    while ( frontier.length ) {
      const current = frontier.dequeue();
      if ( this.debug ) Draw.point(current.entryPoint, { color: Draw.COLORS.green });
      if ( this.goalReached(goal, current) ) break;

      // Get each neighbor destination in turn.
      for ( const next of this.getNeighbors(current, goal) ) {
        const newCost = (costSoFar.get(current.key) ?? MAX_COST) + next.cost;
        if ( !costSoFar.has(next.key) || newCost < costSoFar.get(next.key) ) {
          if ( this.debug ) Draw.point(next.entryPoint, { color: Draw.COLORS.lightgreen });
          costSoFar.set(next.key, newCost);
          const priority = newCost + this.heuristic(goal, next);
          frontier.enqueue(next, priority);
          cameFrom.set(next.key, current);
        }
      }
    }

    cameFrom.goal = goal;
    cameFrom.start = start;
    return cameFrom;
  }
}
