/* globals
canvas,
CanvasQuadtree,
ClockwiseSweepPolygon,
CONFIG,
CONST,
foundry,
game,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { BorderTriangle, BorderEdge } from "./BorderTriangle.js";
import { boundsForPoint, log } from "../util.js";
import { getCenterPoint } from "./grid_coordinates.js";
import { Draw } from "../geometry/Draw.js";
import { BreadthFirstPathSearch, UniformCostPathSearch, GreedyPathSearch, AStarPathSearch } from "./algorithms.js";
import { SCENE_GRAPH } from "./WallTracer.js";
import { cdt2dConstrainedGraph, cdt2dToBorderTriangles } from "../delaunator/cdt2d_access_functions.js";
import { Settings } from "../settings.js";

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
pf = token.elevationruler.pathfinder

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
  _spacer = 0;

  get spacer() {
    return this._spacer || (Math.min(this.token.w, this.token.h) * 0.5) || (canvas.dimensions.size * 0.5);
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
  // TODO: Handle 3d points?
  _heuristic(goal, current) {
    const pathRes = canvas.grid.measurePath([goal.entryPoint, current.entryPoint]);
    return CONFIG.GeometryLib.utils.gridUnitsToPixels(pathRes.distance);
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

    const destinations = pathNode.entryTriangle.getValidDestinations(pathNode.priorTriangle, this.startElevation, this.spacer);
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
      newNode.cost = goal.entryTriangle._calculateMovementCost(pathNode.entryPoint, goal.entryPoint);
      newNode.priorTriangle = pathNode.priorTriangle;
      newNode.fromPoint = pathNode.entryPoint;
      return [newNode];
    }

    const destinations = pathNode.entryTriangle.getValidDestinationsWithCost(
      pathNode.priorTriangle, this.startElevation, this.spacer, pathNode.entryPoint);
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
   * Straighten path and remove points that are very close to one another.
   * If gridded, attempt to center the points on the grid.
   * If not gridded, keep within the canvas grid size.
   * Do not move a point if the path collides with a wall.
   * Do not move a point if it would take it outside its grid square (to limit
   * possibility that it would move the path into a terrain).
   * @param {PIXI.Point[]} pathPoints
   * @returns {PIXI.Point[]}
   */
  static cleanPath(pathPoints) {
    if ( canvas.grid.type === CONST.GRID_TYPES.GRIDLESS ) return cleanNonGridPath(pathPoints);
    else return cleanGridPath(pathPoints);
  }
}

/**
 * For given point on a grid:
 * - if next point shares this grid square, delete if prev --> next has no collision.
 * - temporarily move to the grid center.
 * - if collision, move back and go to next point. Otherwise keep at center.
 * Don't move the start or end points.
 * @param {PIXI.Point[]} pathPoints
 * @returns {PIXI.Point[]}
 */
function cleanGridPath(pathPoints) {
  let nPoints = pathPoints.length;
  if ( nPoints < 3 ) return pathPoints;
  // Debug: pathPoints.forEach(pt => Draw.point(pt, { alpha: 0.5, color: Draw.COLORS.blue }))

  // const slowMethod = cleanGridPathSlow(pathPoints);

  const orient2d = foundry.utils.orient2dFast;
  const config = { mode: "any", type: "move" };
  let prev2;
  let prev = pathPoints[0];
  let curr = pathPoints[1];
  let newPath = [prev];
  for ( let i = 2; i < nPoints; i += 1 ) {
    const next = pathPoints[i];

    // Move points to the center of the grid square if no collision for previous or next.
    const currCenter = getGridCenterPoint(curr);
    if ( !(ClockwiseSweepPolygon.testCollision(prev, currCenter, config)
      || ClockwiseSweepPolygon.testCollision(currCenter, next, config)) ) curr = currCenter;

    // Remove duplicate points.
    if ( curr.almostEqual(prev) ) {
      curr = next;
      continue;
    }

    // Remove points in middle of straight line.
    if ( prev2 && orient2d(prev2, prev, curr).almostEqual(0) ) newPath.pop();

    newPath.push(curr);
    prev2 = prev;
    prev = curr;
    curr = next;
  }

  // Remove point in middle of straight line at the end of the path.
  const lastPoint = pathPoints.at(-1);
  if ( newPath.length > 1
    && orient2d(prev2, prev, lastPoint).almostEqual(0) ) newPath.pop();
  newPath.push(lastPoint);


  // Remove points in middle of straight line.
//   nPoints = newPath.length;
//   prev = newPath[0];
//   curr = newPath[1];
//   let filteredPath = [prev];
//   for ( let i = 2; i < nPoints; i += 1 ) {
//     const next = newPath[i];
//     if ( orient2d(prev, curr, next).almostEqual(0) ) {
//       curr = next;
//       continue;
//     }
//     filteredPath.push(curr);
//     prev = curr;
//     curr = next;
//   }
//   filteredPath.push(newPath.at(-1));

//   if ( slowMethod.length !== newPath.length ) console.debug("Slow Method returned different path", [...slowMethod], [...newPath]);
//   for ( let i = 0; i < slowMethod.length; i += 1 ) {
//     if ( !slowMethod[i].to2d().equals(newPath[i].to2d()) ) {
//       console.debug("Slow Method returned different path", [...slowMethod], [...newPath]);
//       break;
//     }
//   }


  return newPath;
}


/**
 * For given point on a grid:
 * - if next point shares this grid square, delete if prev --> next has no collision.
 * - temporarily move to the grid center.
 * - if collision, move back and go to next point. Otherwise keep at center.
 * Don't move the start or end points.
 * @param {PIXI.Point[]} pathPoints
 * @returns {PIXI.Point[]}
 */
function cleanGridPathSlow(pathPoints) {
  let nPoints = pathPoints.length;
  if ( nPoints < 3 ) return pathPoints;
  // Debug: pathPoints.forEach(pt => Draw.point(pt, { alpha: 0.5, color: Draw.COLORS.blue }))

  // Move points to the center of the grid square if no collision for previous or next.
  const config = { mode: "any", type: "move" };
  let prev = pathPoints[0];
  let curr = pathPoints[1];
  let centeredPath = [prev];
  for ( let i = 2; i < nPoints; i += 1 ) {
    const next = pathPoints[i];
    const currCenter = getGridCenterPoint(curr);
    if ( !(ClockwiseSweepPolygon.testCollision(prev, currCenter, config)
      || ClockwiseSweepPolygon.testCollision(currCenter, next, config)) ) curr = currCenter;
    centeredPath.push(curr);
    prev = curr;
    curr = next;
  }
  centeredPath.push(pathPoints.at(-1));
  // Debug: centeredPath.forEach(pt => Draw.point(pt, { alpha: 0.5, color: Draw.COLORS.green }))

  // Remove duplicate points.
  prev = centeredPath[0];
  let dedupedPath = [prev];
  for ( let i = 1; i < nPoints; i += 1 ) {
    const curr = centeredPath[i];
    if ( curr.almostEqual(prev) ) continue;
    dedupedPath.push(curr);
    prev = curr;
  }
  // Debug: dedupedPath.forEach(pt => Draw.point(pt, { color: Draw.COLORS.orange }))

  // Remove points in middle of straight line.
  const orient2d = foundry.utils.orient2dFast;
  nPoints = dedupedPath.length;
  prev = dedupedPath[0];
  curr = dedupedPath[1];
  let filteredPath = [prev];
  for ( let i = 2; i < nPoints; i += 1 ) {
    const next = dedupedPath[i];
    if ( orient2d(prev, curr, next).almostEqual(0) ) {
      curr = next;
      continue;
    }
    filteredPath.push(curr);
    prev = curr;
    curr = next;
  }
  filteredPath.push(dedupedPath.at(-1));
  // Debug: filteredPath.forEach(pt => Draw.point(pt))

  return filteredPath;
}

function getGridCenterPoint(pt) { return PIXI.Point.fromObject(getCenterPoint(pt)); }

/**
 * For given point not on a grid:
 * - Radial test: if next point is within canvas.dimensions.size * 0.5, delete if prev --> next has no collision.
 * - Also (not yet implemented): Try Ramer–Douglas–Peucker to straighten line by removing points if no collision.
 * Don't move the start or end points.
 * @param {PIXI.Point[]} pathPoints
 * @returns {PIXI.Point[]}
 */
function cleanNonGridPath(pathPoints) {
  const nPoints = pathPoints.length;
  if ( nPoints < 3 ) return pathPoints;

  const MAX_DIST2 = Math.pow(canvas.scene.dimensions.size * 0.5, 2);
  const config = { mode: "any", type: "move" };
  let prev = pathPoints[0];
  let curr = pathPoints[1];
  const newPath = [prev];
  for ( let i = 2; i < nPoints; i += 1 ) {
    const next = pathPoints[i];

    // If next is sufficiently close to current, see if we can remove current.
    if ( next
      && PIXI.Point.distanceSquaredBetween(curr, next) < MAX_DIST2
      && !ClockwiseSweepPolygon.testCollision(curr, next, config) ) {
      curr = next;
      continue;
    }

    newPath.push(curr);
    prev = curr;
    curr = next;
  }
  newPath.push(pathPoints.at(-1));
  return newPath;
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
  // log("Checking for new fog texture");
  const tex = canvas.fog.exploration?.getTexture();
  if ( !tex || !tex.valid ) return undefined;

  const { width, height } = canvas.effects.visibility.textureConfiguration;
  const cache = CONFIG.GeometryLib.PixelCache.fromTexture(tex, { width, height });
  return (x, y) => cache.pixelAtCanvas(x, y) > 128;
}
