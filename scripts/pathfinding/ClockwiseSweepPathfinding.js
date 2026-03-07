/* globals
canvas,
CONFIG,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { ElevatedPoint } from "../geometry/3d/ElevatedPoint.js";
import { Draw } from "../geometry/Draw.js";
import { GraphingPathfinder, GraphPathfindingWorld } from "./GraphPathfinding.js";
import { ClockwiseCornerGapSweep, offsetGapCorners, offsetVCorners, offsetEdgeCorners } from "./ClockwiseSweep.js";
import { mix } from "../geometry/mixwith.js";
import {
  Manhattan2dCost,
  Manhattan3dCost,

  Euclidean2dCost,
  Euclidean3dCost,

  FoundryMeasureCost,
  TokenTerrainCost,

  Manhattan2dHeuristic,
  Manhattan3dHeuristic,

  Euclidean2dHeuristic,
  Euclidean3dHeuristic,

  FoundryMeasureHeuristic,
  TokenTerrainHeuristic,
} from "./cost_measurement.js";

/* Clockwise sweep pathfinding

From start point, conduct cw sweep.
Identify edges that jump between walls.
Mark the middle point and the near point (to the sweep origin) of each such edge.
Conduct sweep from those points.
Stop when the point is within the end sweep.
*/

export class ClockwiseSweepPathfinder extends GraphingPathfinder {

  static get worldClass() { return worldBuilderClockwise(); }

  /**
   * Clean the path, which may include straightening it, snapping it to a grid, or removing unnecessary points.
   * @param {Node[]} path
   * @returns {Point[]}
   */
  cleanPath(path) {
    // Already straightened and has limited points, so simply return.
    return path;
  }

  /**
   * Snap the path to the grid.
   * @param {Node[]} path
   * @returns {Point[]}
   */
  /*
  snapPathToGrid(path) {
    // TODO: Could use specialized version that limits collision tests between a and b
    //       to edges encountered in a's sweep.

    // TODO: Could run collision pathfinding within a's sweep to find best grid path to b.

    // path = snapPathToGrid(path, this.token);
    // return dropIntermediatePoints(path);
    return super.snapPathToGrid(path);
  }
  */
}

/**
 * Nodes for the ClockwiseSweep store the sweep polygon.
 */
export class ClockwiseSweepPathfindingNode extends ElevatedPoint {
  /** @param {ClockwiseSweepPolygon.config} */
  sweepOpts = {};

  static create(pt, sweepOpts = {}) {
    const node = this.fromObject(pt);
    node.roundDecimals();
    node.sweepOpts = sweepOpts; // Here we want to link the same sweep opts object.
    return node;
  }

  /** @type {PointSourcePolygon} */
  #sweep = new ClockwiseCornerGapSweep();

  /** @type {ClockwiseSweepPathfindingNode[]} */
  #gapPointKeys = new Set();

  #computedSweep = false;

  #computedNeighbors = false;

  get sweep() {
    if ( !this.#computedSweep ) this.computeSweep();
    return this.#sweep;
  }

  get gapPointKeys() {
    if ( !this.#computedNeighbors ) this.calculateGapPoints();
    return this.#gapPointKeys;
  }

  computeSweep() {
    this.#sweep.initialize(this, this.sweepOpts);
    this.#sweep.compute();
    this.#computedSweep = true;

    // const color = randomColor();
    // this.drawShape({ fill: color, });
  }

  /** @type {number<pixels>} */
  static CORNER_OFFSET = 2;

  calculateGapPoints() {
    let gapFn;
    switch ( CONFIG[MODULE_ID].clockwiseSweepCornerGapType ) {
      case "gap": gapFn = offsetGapCorners; break;
      case "v": gapFn = offsetVCorners; break;
      case "edge": gapFn = offsetEdgeCorners; break;
      default: gapFn = offsetVCorners;
    }
    this.#gapPointKeys = gapFn(this.sweep, this.constructor.CORNER_OFFSET);
    if ( this.#gapPointKeys.some(key => this.#gapPointInvalid(key)) ) {
      console.warn("Gap point is invalid", this.#gapPointKeys);
    }

    this.#computedNeighbors = true;

    /*
    const color = randomColor();
    this.drawGapPoints({ color });
    */
  }

  #gapPointInvalid(key) {
    using gapPoint = PIXI.Point.invertKey(key);
    if ( !this.sweep.contains(gapPoint.x, gapPoint.y) ) {
      console.warn(`Sweep does not contain gap point${gapPoint}`);
      return true;
    }

    // Gap point cannot lie on a sweep edge. (Could check all edges but would require access to main clockwise pathfinding data.)
    const onEdge = this.sweep.edges.some(edge => {
      if ( !foundry.utils.orient2dFast(edge.a, edge.b, gapPoint).almostEqual(0) ) return false;

      // Within segment bounds.
      const xMinMax = Math.minMax(edge.a.x, edge.b.x);
      const yMinMax = Math.minMax(edge.a.y, edge.b.y);
      if ( gapPoint.x >= xMinMax.min && gapPoint.x <= xMinMax.max
           && gapPoint.y >= yMinMax.min && gapPoint.y <= yMinMax.max ) {
        console.warn(`Gap point ${gapPoint} is on an edge.`);
        return true;
      }
      return false;
    });
    if ( onEdge ) return true;

    // No collision between the origin and the gap points.
    const ray = new foundry.canvas.geometry.Ray(this, gapPoint);
    if ( this.sweep._testCollision(ray, "any") ) {
      console.warn(`Origin ${this} --> ${gapPoint} has collision.`);
      return true;
    }
    return false;
  }

  drawShape(opts = {}) {
    opts.fill ??= opts.color;
    opts.fill ??= Draw.COLORS.blue;
    opts.fillAlpha ??= 0.2;
    opts.width ??= 0;
    Draw.shape(this.sweep, opts);
  }

  drawGapPoints(opts = {}) {
    opts.alpha ??= 0.5;
    this.gapPointKeys.forEach(key => Draw.point(PIXI.Point.invert(key), opts));
  }
}

export class ClockwiseSweepPathfindingWorld extends GraphPathfindingWorld {

  /**
   * Cost to move from a -> b.
   * @type {function}
   * @param {Node} a
   * @param {Node} b
   */
  cost(a, b) { return PIXI.Point.distanceBetween(a, b); }

  /**
   * Estimated cost to move from a -> b.
   * @type {function}
   * @param {Node} a
   * @param {Node} b
   */
  heuristic(a, b) { return PIXI.Point.distanceBetween(a, b); }

  /**
   * From a location on the canvas, construct the corresponding node.
   * @param {Point|Point3d} pt
   * @returns {ClockwiseSweepPathfindingNode}
   */
  buildNode(pt) {
    const key = ClockwiseSweepPathfindingNode.key(pt);
    if ( this.existingNodes.has(ClockwiseSweepPathfindingNode.key(pt)) ) return this.existingNodes.get(key);
    return ClockwiseSweepPathfindingNode.create(pt, this._sweepOpts);
  }

  nodeIsUnreachable(node, fromPoint) {
    if ( !node.sweep.points.length ) return true;
    return !(node.gapPointKeys.size || node.sweep.contains(fromPoint.x, fromPoint.y));
  }

  /**
   * Did we reach the goal node?
   * Calculated from the current node perspective, in case one-way walls prevent moving from goal --> curr.
   * @param {Node} curr
   * @param {Node} goal
   */
  reachedGoal(curr, goalNode, _goal) { return curr.sweep.contains(goalNode.x, goalNode.y); }

  _sweepOpts = {
    type: "move",     /** @type {CONST.WALL_RESTRICTION_TYPES} */
    source: null,     /** @type {PointMovementSource} */
    addedEdges: [],   /** @type {Edge[]} */
  };

  /**
   * Initialize this world for a given path construction.
   * @param {Token} token     Token doing the movement
   */
  initialize(token) {
    super.initialize(token);
    this._sweepOpts.addedEdges = ClockwiseCornerGapSweep.identifyBlockingTokenEdges(token);
    this._sweepOpts.source = new foundry.canvas.sources.PointMovementSource({ object: token }); // See Token##getMovementSource
    this.existingNodes.clear();
  }

  startPathfinding(start) {
    this._sweepOpts.source.initialize(start); // See Token##getMovementSource
    super.startPathfinding(start);
    start = this.buildNode(start);
    this.existingNodes.set(start.key, start); // 3d key.
  }

  /**
   * Track existing sweep polygons.
   * Don't draw a new gap point if another sweep already contains it.
   * @type {Map<node.key, node>}
   */
  existingNodes = new Map();

  /**
   * Determine where we can move to from this node.
   * Any pixel within the node sweep is potentially available.
   * Trim to existing nodes within the sweep or gap points that are not covered elsewhere.
   * @param {Node} node
   * @returns {Node[]}  BigInt key for 3d point.
   */
  adjacentOffsets(node) {
    const nodeKey = node.key;
    if ( typeof nodeKey === "undefined" ) console.error("Node key must be defined.");
    if ( !(node instanceof ClockwiseSweepPathfindingNode) ) console.error("Node must be ClockwiseSweepPathfindingNode.");
    if ( !node.sweep.points.length ) return [];

    // All gap points to this node are neighbors.
    // Convert to 3d key.
    using pt = ElevatedPoint.tmp;
    pt.z = node.z;
    const neighbors = new Set(node.gapPointKeys.map(key => {
      PIXI.Point.invertKey(key, pt);
      return pt.key;
    }));
    for ( const [existingKey, existingNode] of this.existingNodes.entries() ) {
      if ( existingKey === nodeKey ) continue;

      // Any nodes within this node sweep are neighbors.
      if ( node.sweep.contains(existingNode.x, existingNode.y) ) neighbors.add(existingKey);
    }
    // gapPointSet.forEach(pt => Draw.point(pt, { color: Draw.COLORS.yellow, alpha: 0.2 }));

    // Convert to Node.
    return [...neighbors].map(key => {
      if ( this.existingNodes.has(key) ) return this.existingNodes.get(key);
      ElevatedPoint.invertKey(key, pt);
      return ClockwiseSweepPathfindingNode.create(pt, this._sweepOpts);
    });
  }

  /**
   * Filter the neighbors for this node, keeping only valid neighbors.
   * @param {Set<number>} neighbors    Neighbors to the originating node, by 3d key
   * @param {Node} node           The originating node
   * @returns {Node[]}
   */
  /*
  filterNeighbors(neighborKeys, node) {
    // TODO: Need to test containment within this node sweep? Move test from adjacentOffsets?
    // Other checks for the neighbors such as collision (which we would prefer to avoid)?
  }
  */

  drawNode(node, opts = {}) {
    super.drawNode(node, opts);
    // const color = randomColor();
    // node.drawShape({ fill: color, });
    // node.drawGapPoints({ color });
  }

  /**
   * Maximum number of iterations given a start and end coordinate.
   * Used to stop if no path.
   * @param {Node} start
   * @param {Node} goal
   * @returns {number}
   */
  static maxIterations(_start, _goal) {
    // Challenging to estimate. Maximum would be the total number of pixels.
    // The reality is much less, but highly dependent on number of walls.
    // 0 walls: one iteration.
    // 1 wall: one + 2 endpoints + 2 midpoints
    // 2 walls: As few as the 1 wall scenario, or as many as one + 4 endpoints + 4 midpoints + ???
    // Estimate 4 points per wall, no more than 1 point per grid space.
    const { sceneHeight, sceneWidth, size } = canvas.scene.dimensions;
    const invSize = 1 / size;
    const maxGridSteps = sceneHeight * sceneWidth * (invSize ** 2);
    const nWalls = canvas.walls.placeables.length;
    const gapPointsEstimate = Math.min(maxGridSteps, (nWalls * 4) + 2);

    // But multiple iterations may be required to revisit certain points.
    return gapPointsEstimate * 10;
  }

}

function randomColor() {
  const colors = Object.values(Draw.COLORS);
  return colors[Math.floor(Math.random() * colors.length)];
}

// ---- NOTE: World builder ----- //

// TODO: Eventually tie this to Settings or CONFIG and rebuild the class only when settings/CONFIG change.

/**
 * For the current configuration settings, build a pathfinding world class for the path
 * algorithm to use.
 * @returns {AbstractGridPathfindingWorld}
 */
// Simple cache of the collision world classes, to facilitate instanceof for the world class.
const worldClassCache = new Map();

export function worldBuilderClockwise({ cost, use3d, heuristic } = {}) {
  const pathCfg = CONFIG[MODULE_ID].graphPathfinding;
  use3d ??= pathCfg.use3d;
  cost ??= pathCfg.cost;
  heuristic ??= pathCfg.heuristic;

  const key = [cost, use3d, heuristic].join(".");
  if ( worldClassCache.has(key) ) return worldClassCache.get(key);

  let costCl;
  let heuristicCl;
  switch ( cost ) {
    case "manhattan": costCl = use3d ? Manhattan3dCost : Manhattan2dCost; break;
    case "euclidean": costCl = use3d ? Euclidean3dCost : Euclidean2dCost; break;
    case "foundry": costCl = FoundryMeasureCost; break;
    case "terrain": costCl = TokenTerrainCost; break;
  }
  switch ( heuristic ) {
    case "manhattan": heuristicCl = use3d ? Manhattan3dHeuristic : Manhattan2dHeuristic; break;
    case "euclidean": heuristicCl = use3d ? Euclidean3dHeuristic : Euclidean2dHeuristic; break;
    case "foundry": heuristicCl = FoundryMeasureHeuristic; break;
    case "terrain": heuristicCl = TokenTerrainHeuristic; break;
  }

  const classes = [costCl, heuristicCl];
  const out = mix(ClockwiseSweepPathfindingWorld).with(...classes);
  worldClassCache.set(key, out);
  return out;
}

/** Testing
  Draw.point(sweep.origin, { color: Draw.COLORS.blue })
  Draw.shape(sweep)
  sweep.cornersEncountered.forEach(key => Draw.point(PIXI.Point.invertKey(key)))

  gapEdges.forEach(edge => Draw.segment(edge, { color: Draw.COLORS.yellow }))
  gapPoints.forEach(pt => Draw.point(pt, { color: Draw.COLORS.blue, radius: 2 }))

  Draw = CONFIG.GeometryLib.lib.Draw;
  GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
  api = game.modules.get("elevationruler").api
  let { ClockwiseSweepPathfindingNode,
        ClockwiseSweepPathfindingWorld } = api.pathfinding;

  let randal = canvas.tokens.placeables.find(t => t.name === "Randal")
  let zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")

  start = GridCoordinates3d.fromObject(randal.center)
  end = GridCoordinates3d.fromObject(zanna.center)

  node = ClockwiseSweepPathfindingNode.fromObject(start);
  node.computeSweep()
  node.calculateGapPoints()
  node.drawShape({ fillAlpha: 0.2, fill: Draw.COLORS.blue })
  node.drawGapEdges({ color: Draw.COLORS.blue })
  node.drawGapPoints({ color: Draw.COLORS.blue })

|1750,2750 --> 1150,2450

AbstractPathfinder.js:111 Pathfinder s5xBDtwYrZk09IvV|{x: 1650, y: 2750, z: 0} --> {x: 1950, y: 2650, z: 0} path has collision at 1:
	{x: 1650, y: 2750, z: 0}
	{x: 2001.1313708498985, y: 2700.8485281374237, z: 0}
	{x: 1950, y: 2650, z: 0}

*/
