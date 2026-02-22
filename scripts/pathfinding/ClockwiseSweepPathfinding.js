/* globals
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
import { ClockwisePathfindingSweep } from "./ClockwiseSweep.js";
import { mix, Mixin } from "../geometry/mixwith.js";
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
  #sweep = new ClockwisePathfindingSweep();

  /** @type {ClockwiseSweepPathfindingNode[]} */
  #gapPoints = [];

  #gapEdges = []; // For debugging

  #computedSweep = false;

  #computedNeighbors = false;

  get sweep() {
    if ( !this.#computedSweep ) this.computeSweep();
    return this.#sweep;
  }

  get gapPoints() {
    if ( !this.#computedNeighbors ) this.calculateGapPoints();
    return this.#gapPoints;
  }

  get gapEdges() {
    if ( !this.#computedNeighbors ) this.calculateGapPoints();
    return this.#gapEdges;
  }

  computeSweep() {
    this.#sweep.initialize(this, this.sweepOpts);
    this.#sweep.compute();
    this.#computedSweep = true;

    // const color = randomColor();
    // this.drawShape({ fill: color, });
  }

  static SPACERS = {
    WALL: 1,
    END2: 10**2,
  };

  calculateGapPoints() {
    const { WALL, END2 } = this.constructor.SPACERS;

    this.#gapPoints.length = 0; // Just in case.
    this.#gapEdges.length = 0;
    const iter = this.sweep.iteratePoints({ close: true });
    let prev = iter.next().value;
    let curr = iter.next().value;
    using dir = PIXI.Point.tmp;
    for ( const next of iter ) {
      if ( typeof curr.key === "undefined" ) console.error("Gap curr key undefined", { curr });
      if ( this.sweep.cornersEncountered.has(curr.key) ) {
        let nearPoint = PIXI.Point.tmp;
        let midPoint = PIXI.Point.tmp;
        // let farPoint = PIXI.Point.tmp;
        let b;

        // Identify the far gap edge point and the correct normal.
        if ( foundry.utils.orient2dFast(this.sweep.origin, curr, prev).almostEqual(0) ) {
          // Origin --> curr -> prev. CCW is normal direction.
          b = prev;
          prev.subtract(curr, dir).normalize(dir);
          dir.set(dir.y, -dir.x).multiplyScalar(WALL, dir);
        } else {
          // Origin --> curr -> next
          b = next;
          next.subtract(curr, dir).normalize(dir);
          dir.set(-dir.y, dir.x).multiplyScalar(WALL, dir);
        }

        // Near point: 1 in from curr.
        // Far point: 1 in from prev/next.
        // Mid point: midway between curr, prev/next.
        curr.towardsPointSquared(b, END2, nearPoint);
        nearPoint.add(dir, nearPoint);

        // b.towardsPointSquared(curr, END2, farPoint);
        // farPoint.add(dir, farPoint);

        PIXI.Point.midPoint(curr, b, midPoint);
        midPoint.add(dir, midPoint);

        // Test if the gap point is valid. Must not be on a wall and must be within the sweep after rounding.
        const potentialGapPoints = [nearPoint, midPoint /*, farPoint */].filter(gapPoint => {
          // For collisions, all points are rounded. Do same here.
          gapPoint.roundDecimals(); // Done in place.

          // Skip any gap points that are no longer within the sweep.
          if ( !this.sweep.contains(gapPoint.x, gapPoint.y) ) return false;

          // Skip any gap points that are on a wall.
          // Need only check walls considered within the sweep.
          const collinearEdges = [...this.sweep.edgesEncountered].filter(e => foundry.utils.orient2dFast(e.a, e.b, gapPoint).almostEqual(0));
          for ( const collinearEdge of collinearEdges ) {
            // Check if gap point lies within segment bounds.
            const xMinMax = Math.minMax(collinearEdge.a.x, collinearEdge.b.x);
            const yMinMax = Math.minMax(collinearEdge.a.y, collinearEdge.b.y);
            if ( gapPoint.x >= xMinMax.min && gapPoint.x <= xMinMax.max
              && gapPoint.y >= yMinMax.min && gapPoint.y <= yMinMax.max ) return false;
          }
          return true;
        });
        this.#gapPoints.push(...potentialGapPoints.map(pt => this.constructor.create(pt, this.sweepOpts)));
        this.#gapEdges.push({ a: curr, b });

      }
      prev = curr;
      curr = next;
    }

    // There should be no collisions between the origin and the gap points.
    if ( CONFIG[MODULE_ID].debug && this.#gapPoints.some(pt => {
      const ray = new foundry.canvas.geometry.Ray(this, pt);
      return this.sweep._testCollision(ray, "any");
    }) ) console.error("Gap points collide with wall.", this.#gapPoints, this);

    this.#computedNeighbors = true;

    /*
    const color = randomColor();
    this.drawGapEdges({ color });
    this.drawGapPoints({ color });
    */
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
    this.gapPoints.forEach(pt => Draw.point(pt, opts));
  }

  drawGapEdges(opts = {}) {
    opts.dashLength ??= 5;
    opts.gapLength ??= 3;
    opts.alpha ??= 0.7;
    this.gapEdges.forEach(edge => Draw.segment(edge, opts));
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
    return !(node.gapPoints.length || node.sweep.contains(fromPoint.x, fromPoint.y));
  }

  /**
   * Did we reach the goal node?
   * Calculated from the current node perspective, in case one-way walls prevent moving from goal --> curr.
   * @param {Node} curr
   * @param {Node} goal
   */
  reachedGoal(curr, goal) { return curr.sweep.contains(goal.x, goal.y); }

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
    this._sweepOpts.addedEdges = ClockwisePathfindingSweep.identifyBlockingTokenEdges(token);
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
   * @returns {Node[]}
   */
  adjacentOffsets(node) {
    const nodeKey = node.key;
    if ( typeof nodeKey === "undefined" ) console.error("Node key must be defined.");
    if ( !(node instanceof ClockwiseSweepPathfindingNode) ) console.error("Node must be ClockwiseSweepPathfindingNode.");
    if ( !node.sweep.points.length ) return [];

    const neighbors = [];
    const gapPointSet = new Set(node.gapPoints);

    for ( const [existingKey, existingNode] of this.existingNodes.entries() ) {
      if ( existingKey === nodeKey ) continue;

      // Any nodes within this node sweep are neighbors.
      if ( node.sweep.contains(existingNode.x, existingNode.y) ) neighbors.push(existingNode);

      // Check the existing node against the gap points.
      for ( const gapPoint of gapPointSet ) {
        if ( existingNode.sweep.contains(gapPoint.x, gapPoint.y) ) gapPointSet.delete(gapPoint);
      }
    }
    neighbors.push(...gapPointSet);

    // gapPointSet.forEach(pt => Draw.point(pt, { color: Draw.COLORS.yellow, alpha: 0.2 }));

    return neighbors;
  }

  drawNode(node, opts = {}) {
    super.drawNode(node, opts);
    // const color = randomColor();
    // node.drawShape({ fill: color, });
    // node.drawGapEdges({ color });
    // node.drawGapPoints({ color });
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
export function worldBuilderClockwise({ cost, use3d, heuristic } = {}) {
  const pathCfg = CONFIG[MODULE_ID].graphPathfinding;
  use3d ??= pathCfg.use3d;
  cost ??= pathCfg.cost;
  heuristic ??= pathCfg.heuristic;

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
  // return mix(AbstractGridPathfindingWorld).with(...classes, Mixin); // Mixin caches the classes.
  return mix(ClockwiseSweepPathfindingWorld).with(...classes);
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
