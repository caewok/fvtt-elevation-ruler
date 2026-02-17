/* globals
canvas,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Draw } from "../geometry/Draw.js";
import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";

import { log } from "../util.js";

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

  /** @type {Map<string, AbortController>} */
  activeJobs = new Map();

  constructor(token) { this.token = token; }

  cachedPaths = new Map();

  /**
   * Start pathfinding. From this point, assume the scene and starting point will not change.
   * @param {GridCoordinates3d} start
   */
  startPathfinding(_start) {
    this.cachedPaths.clear();
  }

  /**
   * Stop pathfinding.
   */
  endPathfinding() {
    this.activeJobs.values().forEach(job => job.abort());
    this.activeJobs.clear();
  }

  cancelJob(jobId) {
    if ( this.activeJobs.has(jobId) ) {
      this.activeJobs.get(jobId).abort();
      this.activeJobs.delete(jobId);
    }
  }

  /**
   * Get a job id and associated job runner to find a path.
   * Used so the job can be canceled.
   */
  startJob() {
    const jobId = foundry.utils.randomID();
    const controller = new AbortController();
    this.activeJobs.set(jobId, controller);
    const findPath = async (startPoint, endPoint) => {
      try {
        const result = await this.findPath(startPoint, endPoint, controller.signal);
        return controller.signal.aborted ? null : result;
      } catch(err) {
        if ( err.name === "AbortError" ) return null;
        throw err;
      } finally {
        this.activeJobs.delete(jobId);
      }
    };
    return { jobId, findPath };
  }

  /**
   * Find the path between startPoint and endPoint using the chosen algorithm.
   * @param {Point} start      Start point for the graph
   * @param {Point} goal        End point for the graph
   */
  async findPath(start, goal, signal = {}) {
    start = GridCoordinates3d.fromObject(start).roundDecimals();
    goal = GridCoordinates3d.fromObject(goal).roundDecimals();

    if ( this.cachedPaths.has(goal.key) ) return this.cachedPaths.get(goal.key);
    if ( !(start || goal) || start.almostEqual(goal) ) return null;

    const id = foundry.utils.randomID();
    const prefix = `${this.constructor.name} ${id}`;
    if ( signal.aborted ) return null;
    console.time(`${prefix}|findPath`);
    if ( PIXI.Point.distanceBetween(start, goal) > (6 * canvas.grid.size) ) log(`${prefix}|${start} --> ${goal}:`); // For debugging.
    let path = await this._findPath(start, goal, signal);
    console.timeEnd(`${prefix}|findPath`);

    if ( !path ) {
      log(` ${prefix}|${start} --> ${goal}: null`);
      return null;
    }

    // Debugging: Check that path is valid.
    if ( !this.validatePath(path, start, goal, prefix) ) return null;
    this.cachedPaths.set(goal.key, path);
    return path;
  }

  /**
   * Debugging: check that path is valid.
   * @param {Node[]}
   * @returns {boolean}
   */
  validatePath(path, start, goal, prefix = "Pathfinder") {
    const pathStr = [];
    path.forEach(pt => pathStr.push(`\t${pt}`));
    log(`${prefix}|${start} --> ${goal}:\n${pathStr.join("\n")}`);
    if ( !path[0].almostEqual(start) ) {
      console.error(`${prefix}|${start} --> ${goal} start incorrect:\n${pathStr.join("\n")}`);
      return false;
    }
    if ( !path.at(-1).almostEqual(goal) ) {
      console.error(`${prefix}|${start} --> ${goal} end incorrect:\n${pathStr.join("\n")}`);
      return false;
    }

    const ClockwiseSweepPolygon = foundry.canvas.geometry.ClockwiseSweepPolygon;
    for ( let i = 0, iMax = path.length - 1; i < iMax; i += 1 ) {
      if ( ClockwiseSweepPolygon.testCollision(path[i], path[i + 1], { mode: "any", type: "move" }) ) {
        console.error(`${prefix}|${start} --> ${goal} path has collision at ${i}:\n${pathStr.join("\n")}`);
        return false;
      }
    }
    return true;
  }

  async _findPath(_start, _goal, _signal) { console.error("Child class must define _findPath."); }

  destroy() {
    this.activeJobs.values().forEach(job => job.abort());
    this.activeJobs.clear();
  }

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
  drawDebug(_startPoint, _endPoint, _opts) { }
}
