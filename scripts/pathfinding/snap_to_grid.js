/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { GridCoordinates } from "../geometry/GridCoordinates.js";
import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";
import { GraphPathfindingWorld } from "./GraphPathfindingWorld.js";
import { Euclidean2dHeuristic } from "./cost_measurement.js";
import { Node, SceneGraphFilter, Neighbors2d } from "./GriddedCollisionPathfinding.js";
import { mix } from "../geometry/mixwith.js";
import { AStarGraph } from "./PathAlgorithms.js";


// Assortment of functions used to clean generated paths.
// Straighten, snap-to-grid, fog test.


/**
 * Use pathfinding to snap a linear path to the grid, accounting for obstacles.
 * - Heuristic: distance from the line.
 * - Cost: distance to the goal.
 * - Neighbors:
 *   - Gridded points if within 2 grid squares. (Prevents re-doing the entire path.)
 *   - The next segment point
 *   - The segment midpoint if valid and more than 2 grid squares away.
 */

class LinearPathfindingWorld extends mix(GraphPathfindingWorld)
  .with(Euclidean2dHeuristic, Node, SceneGraphFilter, Neighbors2d) {

  /** @type {number} */
  static get idleYield() { return 0; }

  /** @type {number} */
  MAX_LINEAR_DIST2 = (canvas.grid.size * 3) ** 2;

  /** @type {GridCoordinates3d[]} */
  linearPath;

  /** @type {GridCoordinates3d[]} */
  linearPoints = [];

  STRAIGHT_COST = (canvas.grid.size * 3) ** 2;

  constructor(linearPath) {
    super();
    this.linearPath = linearPath;

    // Instead of searching for the next path or the midpoints, do that here.
    const maxDist2 = this.MAX_LINEAR_DIST2;
    const linearPoints = this.linearPoints;
    let a = linearPath[0];
    linearPoints.push(a);
    for ( let i = 1, n = linearPath.length; i < n; i += 1 ) {
      const b = linearPath[i];

      // Split by node
      while ( PIXI.Point.distanceSquaredBetween(a, b) > maxDist2 ) {
        a = a.towardsPointSquared(b, this.MAX_LINEAR_DIST2); // Creates a new tmp a.
        linearPoints.push(a);
      }

      linearPoints.push(b);
      a = b;
    }
  }

  cost(start, dest) {
    // If on the linear path and gridded, cost should be 0.

    // If b is not gridded, make cost very high. 3x the grid distance.
    if ( !pointIsOn2dGrid(dest) ) return this.STRAIGHT_COST + PIXI.Point.distanceSquaredBetween(start, dest);

    // Otherwise, find the closest distance to the linear path.
    let minDist2 = Number.POSITIVE_INFINITY;
    const iter = this.linearPath[Symbol.iterator]();
    let a = iter.next().value;
    for ( const b of iter ) {
      minDist2 = Math.min(minDist2, distanceSquaredToSegment(a, b, dest));
      a = b;
    }
    return minDist2 + PIXI.Point.distanceSquaredBetween(start, dest);
  }

  adjacentOffsets(node) {
    const offsets = super.adjacentOffsets(node);

    // Neighbors include the closest 2 linear points (usually one behind and one in front).
    // This allows the path to punch through areas where gridded would be blocked.
    let closest = [];
    let minDist2 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    for ( const pt of this.linearPoints ) {
      const dist2 = PIXI.Point.distanceSquaredBetween(node, pt);
      if ( dist2.almostEqual(0) ) continue;
      if ( dist2 < minDist2[0] ) {
        minDist2[1] = minDist2[0];
        minDist2[0] = dist2;
        closest[1] = closest[0];
        closest[0] = pt;
      } else if ( dist2 < minDist2[1] ) {
        minDist2[1] = dist2;
        closest[1] = pt;
      }
    }
    closest = closest.filter(elem => Boolean(elem)); // In case closest[1] never gets defined.
    return [...offsets, ...closest];
  }
}

export async function snapPathToGrid(path, token, signal, debug = false) {
  if ( !path.length ) return;
  path = path.map(pt => GridCoordinates3d.fromObject(pt));
  if ( path.length === 1 ) {
    const offset = validOffsets(path[0], token).next().value;
    return offset ? [offset] : path;
  }
  const world = new LinearPathfindingWorld(path);
  world.initialize(token);
  const pf = new AStarGraph(world);
  if ( debug ) {
    pf.debug = true;
    pf.debugDelay = 100;
  }
  const gridPath = await pf.findPath(path[0], path.at(-1), signal);
  return debug ? { gridPath, pf } : gridPath;
}

/**
 * Is this point on a 2d grid?
 * @param {GridCoordinates3d} pt
 * @returns {boolean}
 */
function pointIsOn2dGrid(pt) {
  using tmp = pt.to2d();
  tmp.centerToGrid();
  return pt.almostEqualXY(tmp);
}

/**
 * Distance squared from point to a segment a|b.
 * If point is between a and b, this is the perpendicular distance squared.
 * Otherwise, it is the distance squared to the closer of a or b.
 * @param {Point} a
 * @param {Point} b
 * @param {Point} pt
 * @returns {number}
 */
function distanceSquaredToSegment(a, b, pt) {
  if ( a.almostEqual(b) ) return PIXI.Point.distanceSquaredBetween(a, pt); // Note: closestPoint throws error if a = b.
  const closestPt = foundry.utils.closestPointToSegment(pt, a, b);
  return PIXI.Point.distanceSquaredBetween(pt, closestPt);
}

/**
 * Iterate valid offsets to a point.
 * To be valid, the point|offset segment must not have a collision.
 * @param {GridCoordinates3d} a     Point to offset
 * @param {Token} token             Token to use for collision test.
 * @yields {GridCoordinates3d}
 */
function *validOffsets(a, token) {

  // First, try the basic offset.
  const aOffset = a.clone().centerToGrid();
  if ( a.almostEqual(aOffset) || pathIsValid([a, aOffset], token) ) yield aOffset;

  // Second, get offsets around this one, sorted by distance to a
  // Only permit neighbors that are less than a full diagonal away from a.
  const sortFn = (n1, n2) => PIXI.Point.distanceSquaredBetween(n1, a) - PIXI.Point.distanceSquaredBetween(n2, a);
  const maxDist2 = ((canvas.dimensions.size - 1) ** 2) * 2;  // (a - 1)^2 + (b - 1)^2
  const neighbors = gridNeighbors(aOffset).filter(n => PIXI.Point.distanceSquaredBetween(a, n) < maxDist2);
  neighbors.sort(sortFn);
  for ( const n of neighbors ) {
    if ( pathIsValid([a, n], token) ) yield n;
  }
}

/**
 * Get the valid (2d) neighbors to a grid point.
 * Uses canvas.grid so it respects diagonal rules.
 */
function gridNeighbors(pt) {
  using pt2d = GridCoordinates.fromObject(pt);
  const offsets = canvas.grid.getAdjacentOffsets(pt2d);
  return offsets.map(offset => {
    const offset3d = GridCoordinates3d.fromOffset(offset);
    offset3d.z = pt.z;
    return offset3d;
  });
}

/**
 * Check the path for collisions
 * @param {Point[]} path
 * @param {Token} token
 * @returns {boolean}
 */
function pathIsValid(path, token) {
  const sceneGraph = CONFIG[MODULE_ID].sceneGraph;
  for ( let i = 0, iMax = path.length - 1; i < iMax; i += 1 ) {
    if ( sceneGraph.pathBlocked(path[i], path[i + 1], token) ) return false;
  }
  return true;
}
