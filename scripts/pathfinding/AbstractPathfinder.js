/* globals
canvas,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Draw } from "../geometry/Draw.js";
import { Settings } from "../settings.js";
import { pathIsValid } from "./path_cleaning.js";
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

  /** @type {Map<key, ElevatedPoint[]>} */
  cachedPaths = new Map();

  /**
   * Start pathfinding. From this point, assume the scene and starting point will not change.
   * @param {Point3d} start
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
    this.fogOfWar = null;
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
   * @param {Point3d} start         Start point for the graph
   * @param {Point3d} goal          End point for the graph
   * @param {AbortSignal} signal    Signal to end pathfinding early
   * @returns {Point3d[]}
   */
  async findPath(start, goal, signal = {}) {
    start = start.clone().roundDecimals();
    goal = goal.clone().roundDecimals();

    // Check the cache.
    if ( this.cachedPaths.has(goal.key) ) return this.cachedPaths.get(goal.key);
    if ( !(start || goal) || start.almostEqual(goal) ) return null;

    // Check if the destination is not viewable by the user.
    if ( Settings.get(Settings.KEYS.PATHFINDING.LIMIT_TOKEN_LOS)
      && !canvas.fog.isPointExplored(goal) ) return null;

    const id = foundry.utils.randomID();
    const prefix = `${this.constructor.name} ${id}`;
    if ( signal.aborted ) return null;
    // console.time(`${prefix}|findPath`);
    // if ( PIXI.Point.distanceBetween(start, goal) > (6 * canvas.grid.size) ) log(`${prefix}|${start} --> ${goal}:`); // For debugging.
    let path = await this._findPath(start, goal, signal);
    // console.timeEnd(`${prefix}|findPath`);

    if ( !path ) {
      // log(` ${prefix}|${start} --> ${goal}: null`);
      return null;
    }

    // Debugging: Check that path is valid.
    if ( !this.validatePath(path, start, goal, prefix) ) return null;
    log("Cleaning path...");
    path = Settings.get(Settings.KEYS.PATHFINDING.SNAP_TO_GRID) ? (await this.snapPathToGrid(path)) : this.cleanPath(path);
    if ( !this.validatePath(path, start, goal, `${prefix}|Cleaned`) ) return null;

    this.cachedPaths.set(goal.key, path);
    return path;
  }

  /**
   * Debugging: check that path is valid.
   * @param {Node[]}
   * @returns {boolean}
   */
  validatePath(path, start, goal, prefix = "Pathfinder") {
    log(`${prefix}|${start} --> ${goal}:\n${this.pathString(path)}`);
    if ( !path[0].almostEqual(start) ) {
      console.error(`${prefix}|${start} --> ${goal} start incorrect:\n${this.pathString(path.slice(0, 2))}`);
      return false;
    }
    if ( !path.at(-1).almostEqual(goal) ) {
      console.error(`${prefix}|${start} --> ${goal} end incorrect:\n${this.pathString([path.at(-2), path.at(-1)])}`);
      return false;
    }

    const ClockwiseSweepPolygon = foundry.canvas.geometry.ClockwiseSweepPolygon;
    for ( let i = 0, iMax = path.length - 1; i < iMax; i += 1 ) {
      if ( ClockwiseSweepPolygon.testCollision(path[i], path[i + 1], { mode: "any", type: "move" }) ) {
        console.warn(`${prefix}|${start} --> ${goal} path has collision at ${i}:\n${this.pathString(path.slice(i, i + 2))}`);
        return false;
      }
    }
    if ( !pathIsValid(path, this.token) ) {
      console.warn(`${prefix}|${start} --> ${goal} path is not valid.`);
      return false;
    }

    return true;
  }

  pathString(path) {
    const pathStr = [];
    path.forEach(pt => pathStr.push(`\t${pt}`));
    return pathStr.join("\n");
  }

  async _findPath(_start, _goal, _signal) { console.error("Child class must define _findPath."); }

  /**
   * Remove unnecessary path points and straighten the path.
   * @param {Node[]} path
   * @returns {Point[]}
   */
  cleanPath(path) { return path; }

  /**
   * Snap the path to the grid.
   * @param {Node[]} path
   * @returns {Point[]}
   */
  async snapPathToGrid(path) { return path; }

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
  static drawPath(pathPoints, opts = {}) {
    opts.radius ??= 2;
    const nPts = pathPoints.length;
    let prior = pathPoints[0];
    Draw.point(prior, opts);
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
