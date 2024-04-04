/* globals
canvas,
CanvasQuadtree,
CONFIG,
foundry,
game,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { BorderTriangle, BorderEdge } from "./BorderTriangle.js";
import { boundsForPoint, segmentBounds, log } from "../util.js";
import { Draw } from "../geometry/Draw.js";
import { BreadthFirstPathSearch, UniformCostPathSearch, GreedyPathSearch, AStarPathSearch } from "./algorithms.js";
import { SCENE_GRAPH } from "./WallTracer.js";
import { cdt2dConstrainedGraph, cdt2dToBorderTriangles } from "../delaunator/cdt2d_access_functions.js";
import { Settings } from "../settings.js";
import { PhysicalDistanceGridless } from "../PhysicalDistance.js";
import { MODULE_ID } from "../const.js";
import { MovePenalty } from "../MovePenalty.js";

/* Testing

Draw = CONFIG.GeometryLib.Draw;
api = game.modules.get("elevationruler").api
Pathfinder = api.pathfinding.Pathfinder
SCENE_GRAPH = api.pathfinding.SCENE_GRAPH
BorderEdge = api.pathfinding.BorderEdge
PriorityQueueArray = api.pathfinding.PriorityQueueArray;
PriorityQueue = api.pathfinding.PriorityQueue;

// Test queue (PQ takes only objects, not strings or numbers)
pq = new PriorityQueueArray("high")
pq.enqueue({"D": 4}, 4)
pq.enqueue({"A": 1}, 1);
pq.enqueue({"C": 3}, 3);
pq.enqueue({"B": 2}, 2);
pq.data

pq = new PriorityQueueArray("low")
pq.enqueue({"D": 4}, 4)
pq.enqueue({"A": 1}, 1);
pq.enqueue({"C": 3}, 3);
pq.enqueue({"B": 2}, 2);
pq.data

// Test pathfinding
Pathfinder.initialize()

Draw.clearDrawings()

BorderEdge.moveToken = _token;
Pathfinder.drawTriangles();


endPoint = _token.center


startPoint = _token.center;

pf = new Pathfinder(token);
pf = _token.elevationruler.pathfinder

path = pf.runPath(startPoint, endPoint, "breadth")
pathPoints = Pathfinder.getPathPoints(path);
paths = pf.algorithm.breadth.getAllPathPoints()
paths.forEach(path => pf.algorithm.breadth.drawPath(path, { color: Draw.COLORS.lightorange }))
pf.drawPath(pathPoints, { color: Draw.COLORS.orange })

path = pf.runPath(startPoint, endPoint, "uniform")
pathPoints = Pathfinder.getPathPoints(path);
paths = pf.algorithm.breadth.getAllPathPoints()
paths.forEach(path => pf.algorithm.uniform.drawPath(path, { color: Draw.COLORS.lightyellow }))
pf.drawPath(pathPoints, { color: Draw.COLORS.yellow })


path = pf.runPath(startPoint, endPoint, "greedy")
pathPoints = Pathfinder.getPathPoints(path);
paths = pf.algorithm.breadth.getAllPathPoints()
paths.forEach(path => pf.algorithm.greedy.drawPath(path, { color: Draw.COLORS.lightgreen }))
pf.drawPath(pathPoints, { color: Draw.COLORS.green })

pf.algorithm.greedy.debug = true


path = pf.runPath(startPoint, endPoint, "astar")
pathPoints = Pathfinder.getPathPoints(path);
paths = pf.algorithm.breadth.getAllPathPoints()
paths.forEach(path => pf.algorithm.astar.drawPath(path, { color: Draw.COLORS.gray }))
pf.drawPath(pathPoints, { color: Draw.COLORS.white })

cleanedPathPoints = pf.cleanPath(pathPoints);
pf.drawPath(cleanedPathPoints, { color: Draw.COLORS.green })

// Walk through an algorithm

let { start, end } = pf._initializeStartEndNodes(startPoint, endPoint)
Draw.point(startPoint, { color: Draw.COLORS.white })
Draw.point(endPoint, { color: Draw.COLORS.green })

alg = pf.algorithm.breadth


*/

/* For the triangles, need:
√ Contains test. Could use PIXI.Polygon, but a custom contains will be faster.
  --> Used to find where a start/end point is located.
  --> Needs to also handle when on a line. PIXI.Polygon contains returns true if on top or left but not right or bottom.
- Look up wall for each edge.
√ Link to adjacent triangle via half-edge
- Provide 2x corner + median pass-through points
*/

/**
 * @typedef {object} PathNode
 * @property {BorderTriangle} key     The destination triangle
 * @property {PIXI.Point} entryPoint  The point on the edge of or within the destination triangle
 *                                    where the path will enter the triangle
 * @property {number} cost            Cost of the path from the last entryPoint to this entryPoint.
 * @property {PathNode[]} neighbors   Neighbors of this path node
 */

export class Pathfinder {
  /** @type {CanvasQuadTree} */
  static quadtree = new CanvasQuadtree();

  /** @type {BorderTriangle[]} */
  static borderTriangles = [];

  /** @type {Set<BorderEdge>} */
  static triangleEdges = new Set();

  /** @type {object<boolean>} */
  static #dirty = true;

  static get dirty() { return this.#dirty; }

  static set dirty(value) { this.#dirty ||= value; }

  /**
   * Initialize properties used for pathfinding related to the scene walls.
   */
  static initialize() {
    const t0 = performance.now();
    this.clear();
    this._buildTriangles();
    this._linkObjectsToEdges();
    this.#dirty &&= false;
    const t1 = performance.now();
    log(`Initialized ${Pathfinder.triangleEdges.size} pathfinder edges in ${t1 - t0} ms.`);
  }

  static clear() {
    this.borderTriangles.length = 0;
    this.triangleEdges.clear();
    this.quadtree.clear();
    this.#dirty ||= true;
  }

  static _buildTriangles() {
    const { borderTriangles, quadtree, triangleEdges } = this;
    const triCoords = cdt2dConstrainedGraph(SCENE_GRAPH);
    cdt2dToBorderTriangles(triCoords, borderTriangles);
    BorderTriangle.linkTriangleEdges(borderTriangles);
    borderTriangles.forEach(tri => quadtree.insert({ r: tri.bounds, t: tri }));

    // Add the edges.
    triangleEdges.clear();
    borderTriangles.forEach(tri => {
      triangleEdges.add(tri.edges.AB);
      triangleEdges.add(tri.edges.BC);
      triangleEdges.add(tri.edges.CA);
    });
  }

  static _linkObjectsToEdges() {
    // Set the placeable objects, if any, for each triangle edge
    for ( const triEdge of this.triangleEdges.values() ) {
      const graphEdge = SCENE_GRAPH.getEdgeByKeys(triEdge.a.key, triEdge.b.key);
      graphEdge.forEach(edge => edge.objects.forEach(obj => triEdge.objects.add(obj)));
    }
  }

  /** @type {Token} token */
  token;

  /** @type {number} */
  startElevation = 0;

  /**
   * Optional token to associate with this path.
   * Used for path spacing near obstacles.
   * @param {Token} token
   */
  constructor(token) {
    this.token = token;
  }

  /** @type {number} */
  #spacer = 0;

  get spacer() {
    return this.#spacer
      || (Math.min(this.token.w, this.token.h, canvas.dimensions.size * 1.5) * 0.25)
      || (canvas.dimensions.size * 0.5);
  }

  /** @enum {BreadthFirstPathSearch} */
  static ALGORITHMS = {
    breadth: BreadthFirstPathSearch,
    uniform: UniformCostPathSearch,
    greedy: GreedyPathSearch,
    astar: AStarPathSearch
  };

  /** @enum {string} */
  static COST_METHOD = {
    breadth: "_identifyDestinations",
    uniform: "_identifyDestinationsWithCost",
    greedy: "_identifyDestinations",
    astar: "_identifyDestinationsWithCost"
  };

  /** @type {object{BreadthFirstPathSearch}} */
  algorithm = {};

  /** @type {function|undefined} */
  #fogIsExploredFn;

  /**
   * Find the path between startPoint and endPoint using the chosen algorithm.
   * @param {Point} startPoint      Start point for the graph
   * @param {Point} endPoint        End point for the graph
   * @returns {Map<PathNode.key, PathNode>}
   */
  runPath(startPoint, endPoint, type = "astar") {
    // Set token for token edge blocking.
    BorderEdge.moveToken = this.token;

    // Set fog exploration testing if that setting is enabled.
    if ( !game.user.isGM
      && Settings.get(Settings.KEYS.PATHFINDING.LIMIT_TOKEN_LOS) ) this.#fogIsExploredFn = fogIsExploredFn();

    // Initialize the algorithm if not already.
    if ( !this.algorithm[type] ) {
      const alg = this.algorithm[type] = new this.constructor.ALGORITHMS[type]();
      const costMethod = this.constructor.COST_METHOD[type];
      alg.getNeighbors = this[costMethod].bind(this);
      alg.heuristic = this._heuristic;
    }

    // Make sure pathfinder triangles are up-to-date.
    if ( this.constructor.dirty ) this.constructor.initialize();

    // Run the algorithm.
    this.startElevation = startPoint.z || 0;
    const { start, end } = this._initializeStartEndNodes(startPoint, endPoint);
    const out = this.algorithm[type].run(start, end);
    this.#fogIsExploredFn = undefined;
    return out;
  }


  /**
   * Heuristic that takes a goal node and a current node and returns a priority based on
   * the canvas distance between two points.
   * @param {PathNode} goal
   * @param {PathNode} current
   */
  _heuristic(goal, current) {
    const distance = PhysicalDistanceGridless.measure(goal.entryPoint, current.entryPoint);
    return CONFIG.GeometryLib.utils.gridUnitsToPixels(distance);
  }

  /**
   * Locate start and end triangles for the start and end points and
   * return the corresponding path nodes.
   * @param {Point} startPoint      Start point for the graph
   * @param {Point} endPoint        End point for the graph
   * @returns {object}
   *   - {PathNode} start
   *   - {PathNode} end
   */
  _initializeStartEndNodes(startPoint, endPoint) {
    // Locate start and end triangles.
    // TODO: Handle 3d
    startPoint = PIXI.Point.fromObject(startPoint);
    endPoint = PIXI.Point.fromObject(endPoint);
    const startTri = this.constructor.trianglesAtPoint(startPoint).first();
    const endTri = this.constructor.trianglesAtPoint(endPoint).first();

    // Build PathNode for start and end.
    const start = {
      key: `${startPoint.key}_${startTri.id}`,
      entryTriangle: startTri,
      entryPoint: PIXI.Point.fromObject(startPoint) };
    const end = {
      key: `${endPoint.key}_${endTri.id}`,
      entryTriangle: endTri,
      entryPoint: endPoint };
    return { start, end };
  }

  /**
   * Locate a triangle at a specific point.
   * Used to locate start and end nodes but also for debugging.
   * @param {PIXI.Point} pt
   * @returns {Set<BorderTriangle>} Typically, only one triangle in the set.
   *  Possibly more than one at a border point.
   */
  static trianglesAtPoint(pt) {
    const collisionTest = (o, _rect) => o.t.contains(pt);
    return this.quadtree.getObjects(boundsForPoint(pt), { collisionTest });
  }

  /**
   * Get destinations for a given path node
   * @param {PathNode} pathObject
   * @returns {PathNode[]} Array of destination nodes
   */
  _identifyDestinations(pathNode, goal) {
    // If the goal node is reached, return the goal
    if ( pathNode.entryTriangle === goal.entryTriangle ) {
      // Need a copy so we can modify priorTriangle for this node only.
      const newNode = {...goal};
      newNode.priorTriangle = pathNode.priorTriangle;
      return [newNode];
    }

    const destinations = pathNode.entryTriangle.getValidDestinations(
      pathNode.priorTriangle,
      this.startElevation,
      this.spacer);
    return this.#filterDestinationsbyExploration(destinations);
  }

  /**
   * Get destinations with cost calculated for a given path node.
   * @param {PathNode} pathObject
   * @returns {PathNode[]} Array of destination nodes
   */
  _identifyDestinationsWithCost(pathNode, goal) {
    // If the goal node is reached, return the goal with the cost.
    if ( pathNode.entryTriangle === goal.entryTriangle ) {
      // Need a copy so we can modify cost for this goal node only.
      const newNode = {...goal};
      newNode.cost = goal.entryTriangle._calculateMovementCost(pathNode.entryPoint, goal.entryPoint, this.token);
      newNode.priorTriangle = pathNode.priorTriangle;
      newNode.fromPoint = pathNode.entryPoint;
      return [newNode];
    }

    const destinations = pathNode.entryTriangle.getValidDestinationsWithCost(
      pathNode.priorTriangle, this.startElevation, this.spacer, pathNode.entryPoint, this.token);
    return this.#filterDestinationsbyExploration(destinations);
  }

  /**
   * If not GM and GM has set the limit on pathfinding to token LOS, then filter destinations accordingly.
   * @param {PathNode[]} destinations     Array of destination nodes
   * @returns {PathNode[]} Array of destination nodes, possibly filtered.
   */
  #filterDestinationsbyExploration(destinations) {
    const fn = this.#fogIsExploredFn;
    if ( !fn ) return destinations;

    // Each entrypoint must be an explored point.
    return destinations.filter(d => fn(d.entryPoint.x, d.entryPoint.y));
  }

  /**
   * Identify path points, in order from start to finish, for a cameFrom path map.
   * @returns {PIXI.Point[]}
   */
  static getPathPoints(pathMap) {
    let curr = pathMap.goal;
    const pts = [];
    while ( curr && pts.length < 1000 ) {
      pts.push(PIXI.Point.invertKey(curr.entryPoint.key));
      curr = pathMap.get(curr.key);
    }
    return pts.reverse();
  }

  /**
   * Identify triangles for a path in order.
   * @returns {BorderTriangle[]}
   */
  static getPathTriangles(pathMap) {
    let curr = pathMap.goal;
    const tri = [];
    while ( curr && tri.length < 1000 ) {
      tri.push(curr);
      curr = pathMap.get(curr.key);
    }
    return tri.reverse();
  }

  drawPath(pathPoints, opts) {
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
   * Debugging. Draw the triangle graph.
   */
  static drawTriangles() {
    if ( this.dirty ) this.initialize();
    this.borderTriangles.forEach(tri => tri.drawTriangle());
  }

  /**
   * Debugging. Draw the edges.
   */
  static drawEdges() {
    this.triangleEdges.forEach(edge => edge.draw());
  }

  /**
   * Debugging. Draw links between triangles.
   */
  static drawLinks(toMedian = false) {
    this.borderTriangles.forEach(tri => tri.drawLinks(toMedian));
  }

  /**
   * Clean an array of path points.
   * Straighten path by removing unnecessary points.
   * @param {PIXI.Point[]} pathPoints
   * @returns {PIXI.Point[]}
   */
  cleanPath(pathPoints) { return cleanGridPathRDP(pathPoints, this.token); }
}


/**
 * Reverse Ramer–Douglas–Peucker algorithm to straighten points.
 * Take start and end points. If no collisions, drop all points in between and end.
 * Find farthest point.
 *   a. start --> farthest. If no collisions, drop all points in between and break
 *   b. farthest --> end. If no collisions, drop all points in between and break
 * If (a), call again, finding farthest point between start --> old farthest.
 * If (b), call again, finding farthest point between old farthest --> end
 * If enabled, collisions include terrain collisions.
 * If start and end are the same or no points between, end.
 * @param {PIXI.Point[]} pathPoints
 * @param {Token} token               Move token, used when testing for some collisions
 * @returns {PIXI.Point[]}
 */
function cleanGridPathRDP(pathPoints, token, _depth = 0) {
  if ( pathPoints.length < 3 ) return pathPoints;

  if ( _depth > 1000 ) {
    console.warn("cleanGridPathRDP exceeded depth max", { pathPoints, token });
    return pathPoints;
  }

  // Test for collision between first and last points.
  const a = pathPoints.at(0);
  const b = pathPoints.at(-1);
  if ( !hasAnyCollisions(a, b, token) ) return [a, b];

  // Locate the index of the farthest point from segment a|b.
  let farthestIndex = 0;
  let maxDist2 = -1;
  const nInterior = pathPoints.length - 2;
  for ( let i = 1; i < nInterior; i += 1 ) {
    const dist2 = distanceSquaredToSegment(a, b, pathPoints[i]);
    if ( dist2 > maxDist2 ) {
      maxDist2 = dist2;
      farthestIndex = i;
    }
  }
  // Adjust index by one to account for interior.
  farthestIndex += 1;

  // Test the two halves: a|farthest, farthest|b. Remember to not duplicate farthest when combining.
  const firstHalf = cleanGridPathRDP(pathPoints.slice(0, farthestIndex + 1), token, _depth += 1);
  const secondHalf = cleanGridPathRDP(pathPoints.slice(farthestIndex), token, _depth += 1);
  return [...firstHalf, ...secondHalf.slice(1)];
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
  const closestPt = foundry.utils.closestPointToSegment(pt, a, b);
  return PIXI.Point.distanceSquaredBetween(pt, closestPt);
}

/**
 * Identify if there are potential collisions between two points.
 * @param {Point} a
 * @param {Point} b
 * @param {Token} token     Movement token, for some terrain collisions
 * @returns {boolean} True if collision is present between a|b.
 */
function hasAnyCollisions(a, b, token) {
  return hasCollision(a, b, token)
    || (CONFIG[MODULE_ID].pathfindingCheckTerrains && MovePenalty.anyTerrainPlaceablesAlongSegment(a, b, token));
}

/**
 * Instead of a typical `token.checkCollision` test, test for collisions against the edge graph.
 * With this approach, collisions with enemy tokens trigger pathfinding.
 * @param {PIXI.Point} a          Origin point for the move
 * @param {PIXI.Point} b          Destination point for the move
 * @param {Token} token           Token that is moving
 * @returns {boolean}
 */
export function hasCollision(a, b, token) {
  const lineSegmentIntersects = foundry.utils.lineSegmentIntersects;
  const tokenBlockType = Settings._tokenBlockType();
  // SCENE_GRAPH has way less edges than Pathfinder and has quadtree for the edges.
  // Edges are WallTracerEdge
  const edges = SCENE_GRAPH.edgesQuadtree.getObjects(segmentBounds(a, b));
  return edges.some(edge => lineSegmentIntersects(a, b, edge.A, edge.B)
    && edge.edgeBlocks(a, token, tokenBlockType, token.elevationZ));
}

/**
 * Function factory to provide a means to test if a given canvas location is explored or unexplored.
 * Dependent on the scene having a fog exploration for that user.
 * Because fog will change over time, this should be called each time a new path is requested.
 * @returns {function} Function that checks whether a canvas position is explored
 *   - @param {number} x
 *   - @param {number} y
 *   - @returns {boolean}  True if explored, false if unexplored. If no fog, always true.
 */
export function fogIsExploredFn() {
  const tex = canvas.fog.exploration?.getTexture();
  if ( !tex || !tex.valid ) return undefined;

  const { width, height } = canvas.effects.visibility.textureConfiguration;
  const cache = CONFIG.GeometryLib.PixelCache.fromTexture(tex, { width, height });
  return (x, y) => cache.pixelAtCanvas(x, y) > 128;
}
