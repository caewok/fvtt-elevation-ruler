/* globals
canvas,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Draw } from "../geometry/Draw.js";
import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";


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

  #start = new GridCoordinates3d();

  get start() { return this.#start; }

  set start(value) {
    if ( this.#start.equals(value) ) return;
    this.cachedPaths.clear();
    this.#start.copyFrom(value);
  }

  #initialized = false;

  /**
   * Initialize the pathfinder algorithm.
   */
  async initialize() {
    this.cachedPaths.clear();
    this.#initialized = true;
  }

  /**
   * Initialize pathfinding. From this point, assume the scene will not change but
   * starting point and elevation might.
   * @param {GridCoordinates3d} start     May be updated by findPath
   */
  startPathfinding(start) { }

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
    if ( !this.#initialized ) return null;
    this.start = start;
    if ( this.cachedPaths.has(goal.key) ) return this.cachedPaths.get(goal.key);
    if ( !(start || goal) || start.almostEqual(goal) ) return null;

    const id = foundry.utils.randomID();
    if ( signal.aborted ) return null;
    console.time(`${id}|findPath`);
    const path = await this._findPath(start, goal, signal);
    console.timeEnd(`${id}|findPath`);

    this.cachedPaths.set(goal.key, path);

    console.debug(`Pathfinder ${id}|${start.x},${start.y} --> ${goal.x},${goal.y}\n\tdistance: ${PIXI.Point.distanceBetween(start, goal).toPrecision(3)} pixels\n\tpath length: ${path?.length} pixels.`);

    return path;
  }

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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)); // eslint-disable-line no-promise-executor-return


export class TestPathfinder extends AbstractPathfinder {
  async findPath(startPoint, endPoint, signal = {}) {
    const id = foundry.utils.randomID();
    console.debug(`TestPathfinder ${id}|starting.`);
    let iter = 0;
    while ( iter < 100 ) {
      if ( signal.aborted ) {
        console.debug(`\tTestPathfinder ${id}|stopped at iteration ${iter}.`);
        return null;
      }
      await sleep(100);
      iter += 1;
      console.debug(`\tTestPathfinder ${id}|iteration ${iter}.`);
    }
    console.debug(`\tTestPathfinder ${id}|Reached iteration ${iter}.`);
    return canvas.grid.getDirectPath([startPoint, endPoint]);
  }
}
