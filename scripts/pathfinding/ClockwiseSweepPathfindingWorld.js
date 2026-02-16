/* globals
canvas,
CONFIG,
CONST,
foundry,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { GraphPathfindingWorld, ObstacleSweep } from "./GriddedPathfindingWorld.js";
import { ElevatedPoint } from "../geometry/3d/ElevatedPoint.js";
import { Settings } from "../settings.js";
import { ObstacleOcclusionTest } from "../geometry/ObstacleOcclusionTest.js";
import { Draw } from "../geometry/Draw.js";

/* Clockwise sweep pathfinding

From start point, conduct cw sweep.
Identify edges that jump between walls.
Mark the middle point and the near point (to the sweep origin) of each such edge.
Conduct sweep from those points.
Stop when the point is within the end sweep.
*/


/**
 * Extend Clockwise Sweep to track when the sweep hits wall corners.
 */
class ClockwisePathfindingSweep extends ObstacleSweep {
  /**
   * Corners are when the sweep hits a non-limited wall
   * and must extend the sweep beyond that point.
   * In addition, corners where the walls simply continue are ignored
   * @type {Point[]}
   */
  cornersEncountered = new Set();

  /** @type {object} */
  sweepOpts = {};

  /** @inheritdoc */
  _compute() {
    this.cornersEncountered.clear();
    super._compute();
  }

  _switchEdge(result, activeEdges) {
    this.cornersEncountered.add(result.target.key);
    super._switchEdge(result, activeEdges);
  }
}

/**
 * Nodes for the ClockwiseSweep store the sweep polygon.
 */
export class ClockwiseSweepPathfindingNode extends ElevatedPoint {
  /** @param {ClockwiseSweepPolygon.config} */
  sweepOpts = {};

  static create(pt, sweepOpts = {}) {
    const node = this.fromObject(pt);
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
  }

  calculateGapPoints() {
    const SPACER = 5;

    this.#gapPoints.length = 0; // Just in case.
    this.#gapEdges.length = 0;
    const iter = this.sweep.iteratePoints({ close: true });
    let prev = iter.next().value;
    let curr = iter.next().value;
    let dir = PIXI.Point.tmp;
    for ( const next of iter ) {
      if ( typeof curr.key === "undefined" ) console.error("Gap curr key undefined", { curr });
      if ( this.sweep.cornersEncountered.has(curr.key) ) {
        let nearPoint = PIXI.Point.tmp;
        let farPoint = PIXI.Point.tmp;
        let midPoint = PIXI.Point.tmp;
        let b;

        // Identify the far gap edge point and the correct normal.
        if ( foundry.utils.orient2dFast(this.sweep.origin, curr, prev).almostEqual(0) ) {
          // Origin --> curr -> prev. CCW is normal direction.
          b = prev;
          prev.subtract(curr, dir).normalize(dir);
          dir.set(dir.y, -dir.x).multiplyScalar(SPACER, dir);
        } else {
          // Origin --> curr -> next
          b = next;
          next.subtract(curr, dir).normalize(dir);
          dir.set(-dir.y, dir.x).multiplyScalar(SPACER, dir);
        }

        // Near point: 1 in from curr.
        // Far point: 1 in from prev/next.
        // Mid point: midway between curr, prev/next.
        curr.towardsPointSquared(b, 1, nearPoint);
        // b.towardsPointSquared(curr, 1, farPoint);
        PIXI.Point.midPoint(curr, b, midPoint);
        nearPoint.add(dir, nearPoint);
        farPoint.add(dir, farPoint);
        midPoint.add(dir, midPoint);

        this.#gapPoints.push(nearPoint, midPoint, farPoint);

        // Keep b if testing gapEdges.
        this.#gapEdges.push({ a: curr, b });
        // b.release();
      }
      prev = curr;
      curr = next;
    }
    PIXI.Point.release(dir);

    // There should be no collisions between the origin and the gap points.
    if ( CONFIG[MODULE_ID].debug && this.#gapPoints.some(pt => {
      const ray = new foundry.canvas.geometry.Ray(this, pt);
      return this.sweep._testCollision(ray, "any");
    }) ) console.error("Gap points collide with wall.", this.#gapPoints, this);

    this.#computedNeighbors = true;
  }

  drawShape(opts = {}) {
    opts.fill ??= opts.color;
    opts.fillAlpha ??= 0.2;
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

  // TODO: Use mixers for cost and heuristic.

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

  // From ClockwiseSweepFilter.
  // TODO: Export from one place.
  _identifyBlockingTokenEdges(subjectToken) {
    // Add token edges. Must be temporary wall edges.
    const PATHFINDING = Settings.KEYS.PATHFINDING;
    const blocking = Settings.get(PATHFINDING.TOKENS_BLOCK);
    const blockingCfg = {
      dead: false,
      live: blocking !== PATHFINDING.TOKENS_BLOCK_CHOICES.NO,
      prone: false,
      enemies: blocking !== PATHFINDING.TOKENS_BLOCK_CHOICES.NO,
      allies: blocking === PATHFINDING.TOKENS_BLOCK_CHOICES.ALL,
    };
    const occlusionCfg = { blockingCfg, subjectToken };
    const Edge = foundry.canvas.geometry.edges.Edge;
    const edges = [];
    for ( const token of canvas.tokens.placeables ) {
      if ( !ObstacleOcclusionTest.includeToken(token, occlusionCfg) ) continue;
      for ( const edge of token.constrainedTokenBorder.iterateEdges({ closed: false }) ) {
        edges.push(new Edge(edge.A, edge.B, {
          object: { flags: {
            "wall-height": {
              top: token.topZ,
              bottom: token.bottomZ,
            }
          }},
          type: `${MODULE_ID}.ObstacleSweep`,
          id: token.id,
          move: CONST.WALL_SENSE_TYPES.NORMAL,
        }));
      }
    }
    return edges;
  }

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
    this._sweepOpts.addedEdges = this._identifyBlockingTokenEdges(token);
    this._sweepOpts.source = new foundry.canvas.sources.PointMovementSource({ object: token }); // See Token##getMovementSource
    this.existingNodes.clear(); // TODO: Could store nodes during the entire token drag, except for goal.
  }

  startPathfinding(start, goal) {
    this._sweepOpts.source.initialize(start); // See Token##getMovementSource
    super.startPathfinding(start, goal);
    this.existingNodes.set(PIXI.Point.key(start), start); // Nodes all take 2d keys for now.
  }

  /**
   * Track existing sweep polygons.
   * Don't draw a new gap point if another sweep already contains it.
   * @type {Map<node.key, node>}
   */
  existingNodes = new Map();

  /**
   * Determine adjacent offsets to a node.
   * @param {Node} node
   * @returns {Node[]}
   */
  adjacentOffsets(node) {
    const nodeKey = PIXI.Point.key(node);
    if ( typeof nodeKey === "undefined" ) console.error("Node key must be defined.");
    if ( !node.sweep.points.length ) return [];

    const neighbors = [];
    gapLoop: for ( const gapPoint of node.gapPoints ) {
      // If the node already exists, use it.
      const gapPointKey = PIXI.Point.key(gapPoint);
      if ( this.existingNodes.has(gapPointKey) ) {
        neighbors.push(this.existingNodes.get(gapPointKey));
        continue;
      }

      // Must use the gap point key, in case rounding to nearest integer modifies its location.
      const roundedGapPoint = PIXI.Point.invertKey(gapPointKey);

      // Must be within the parent node after rounding.
      if ( !node.sweep.contains(roundedGapPoint.x, roundedGapPoint.y) ) continue gapLoop;

      // Skip gap points contained in an existing node polygon other than the current node.
      for ( const [existingKey, existingNode] of this.existingNodes.entries() ) {
        if ( nodeKey === existingKey ) continue;
        if ( existingNode.sweep.contains(roundedGapPoint.x, roundedGapPoint.y) ) continue gapLoop;
      }
      neighbors.push(this.buildNode(roundedGapPoint)); // TODO: Or gapPoint?
    }
    return neighbors;
  }

  drawNode(node, opts = {}) {
    super.drawNode(node, opts);
    const color = randomColor();
    node.drawShape({ fill: color, });
    node.drawGapEdges({ color });
    node.drawGapPoints({ color });
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
export function worldBuilder({ cost, use3d, heuristic, pt3d, neighborFilter } = {}) {
  const pathCfg = CONFIG[MODULE_ID].simplePathfinding;
  use3d ??= pathCfg.use3d;
  pt3d ??= pathCfg.pt3d;
  cost ??= pathCfg.cost;
  heuristic ??= pathCfg.heuristic;
  neighborFilter ??= pathCfg.neighborFilter;

  // TODO: Modify for cost, heuristic, etc.
  return ClockwiseSweepPathfindingWorld;
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
