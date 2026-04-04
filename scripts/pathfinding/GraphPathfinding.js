/* globals
CONFIG,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { AbstractPathfinder } from "./AbstractPathfinder.js";
import { Settings } from "../settings.js";
import { BFSGraph, UniformCostGraph, AStarGraph, TestGraph } from "./PathAlgorithms.js";

// Each pathfinding should create a new GraphPathfinder, so properties are not mixed up
// between async jobs.
export class GraphPathfinder extends AbstractPathfinder {
  /** @type {AbstractGraph} */
  lastGraph; // For debugging.

  #world;

  get world() {
    if ( !this.#world ) this.world = new this.constructor.worldClass();
    return this.#world;
  }

  set world(value) {
    this.#world = value;
    this.#world.initialize(this.token);
  }

  static get worldClass() { return Settings.pathfindingWorldClass; }

  #graphClass;

  get graphClass() {
    if ( this.#graphClass ) return this.#graphClass;

    // If none set, go with current CONFIG.
    switch ( CONFIG[MODULE_ID].graphPathfinding.algorithm ) {
      case "astar": return AStarGraph;
      case "breadth": return BFSGraph;
      case "uniform": return UniformCostGraph;
      case "greedy": return GreedyBestFirstGraph;
      case "test": return TestGraph;
      default: return AStarGraph;
    }
  }

  // Allow override of the graph class.
  set graphClass(value) { this.#graphClass = value; }


  /**
   * Start pathfinding.
   * From this point, assume the scene and starting point will not change.
   * @param {Point3d} start
   */
  startPathfinding(start) {
    // Reset the world if necessary.
    if ( !(this.world instanceof this.constructor.worldClass) ) this.#world = null;
    super.startPathfinding(start);

    // Set up world
    this.world.startPathfinding(start);
  }

  /**
   * Find the path between startPoint and endPoint using the chosen algorithm.
   * @param {Point3d} start      Start point for the graph
   * @param {Point3d} goal       End point for the graph
   * @param {AbortSignal} signal    Signal to end pathfinding early
   * @returns {Point3d[]}
   */
  async _findPath(start, goal, signal) {
    // graphClass is stateless, so can reuse the previous one unless the algorithm changed.
    const graphCl = this.graphClass;
    if ( !(this.lastGraph instanceof graphCl) ) this.lastGraph = new graphCl(this.world);
    const graph = this.lastGraph
    graph.debug = this.debug;
    graph.debugDelay = this.debugDelay;
    return graph.findPath(start, goal, signal);
  }

  destroy() {
    this.world = null;
    this.lastGraph = null;
    super.destroy();
  }
}

/* Testing
MODULE_ID = "elevationruler"
Draw = CONFIG.GeometryLib.lib.Draw;
GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
GridCoordinates = CONFIG.GeometryLib.lib.GridCoordinates
api = game.modules.get("elevationruler").api
let { ClockwiseSweepPathfinder, GriddedCollisionPathfinder, WebGPUPathfinder, worldBuilderGriddedCollision, ClockwiseSweepPathfindingNode } = api.pathfinding;
let { solveSegment,
      pathIsValid,
      optimizeGridPath,
      dropIntermediatePoints,
      snapPathToGrid,
      straightenPath,
      removeDuplicatePoints,
      snapPathToGrid2,
} = api.pathCleaning


benchTokenPath = api.pathfinding.benchTokenPath
testPathfinding = api.pathfinding.testPathfinding

await WebGPUPathfinder.initialize();


let randal = canvas.tokens.placeables.find(t => t.name === "Randal")
let zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")
let beiro = canvas.tokens.placeables.find(t => t.name === "Beiro")
let riswynn = canvas.tokens.placeables.find(t => t.name === "Riswynn")
let akra = canvas.tokens.placeables.find(t => t.name === "Akra")
let perrin = canvas.tokens.placeables.find(t => t.name === "Perrin")

// collision, webGPU, clockwiseSweep
CONFIG.elevationruler.clockwiseSweepPathfinding.cornerGapType = "v"  // |"v"|"edge"
algorithm = "collision" // "collision"|"clockwiseSweep"|"webGPU"
graphPathfinding = {
  cost: "terrain",      // "manhattan"|"euclidean"|"foundry"|"terrain"
  heuristic: "terrain", //"manhattan"|"euclidean"|"foundry"|"terrain"
  neighborFilter: "occlusion" // "clockwiseSweep"|"occlusion"|"sceneGraph"
}
await testPathfinding(randal, zanna, { algorithm, graphPathfinding })
await testPathfinding(beiro, riswynn, { algorithm, graphPathfinding })
await testPathfinding(akra, perrin, { algorithm, graphPathfinding })
await testPathfinding(beiro, randal, { algorithm, graphPathfinding })

// Test all
graphPathfinding = {
  cost: "terrain",      // "manhattan"|"euclidean"|"foundry"|"terrain"
  heuristic: "euclidean", //"manhattan"|"euclidean"|"foundry"|"terrain"
  neighborFilter: "occlusion" // "clockwiseSweep"|"occlusion"|"sceneGraph"
}


startToken = randal
endToken = zanna

startToken = beiro
endToken = riswynn

startToken = akra
endToken = perrin

startToken = beiro
endToken = randal


console.log("\n\n-----Collision: Occlusion -----")
algorithm = "collision"
graphPathfinding.neighborFilter = "occlusion"
await testPathfinding(startToken, endToken, { algorithm, graphPathfinding })

console.log("\n\n-----Collision: CWSweep -----")
algorithm = "collision"
graphPathfinding.neighborFilter = "clockwiseSweep"
await testPathfinding(startToken, endToken, { algorithm, graphPathfinding })

console.log("\n\n-----Collision: Scene Graph -----")
algorithm = "collision"
graphPathfinding.neighborFilter = "sceneGraph"
await testPathfinding(startToken, endToken, { algorithm, graphPathfinding })

console.log("\n\n-----Clockwise Sweep: 'V' -----")
algorithm = "clockwiseSweep"
CONFIG.elevationruler.clockwiseSweepPathfinding.cornerGapType = "v"
await testPathfinding(startToken, endToken, { algorithm, graphPathfinding })

console.log("\n\n-----Clockwise Sweep: 'Edge' -----")
algorithm = "clockwiseSweep"
CONFIG.elevationruler.clockwiseSweepPathfinding.cornerGapType = "edge"
await testPathfinding(startToken, endToken, { algorithm, graphPathfinding })

console.log("\n\n-----WebGPU -----")
algorithm = "webGPU"
await testPathfinding(startToken, endToken, { algorithm, graphPathfinding })








 **
 * Uses bresenham to draw pixels under each wall in the scene.
 * @param {Wall[]} [walls]      Walls to approximate
 * @returns {Set<key>} Unique pixels, coded by point key.
 *
function uniquePixelsForCanvasWalls(walls) {
  const blIterator = CONFIG.GeometryLib.lib.utils.bresenhamLineIterator;
  const coveredPixels = new Set();
  walls ??= canvas.walls.placeables;
  walls.forEach(wall => {
    const edge = wall.edge;
    for ( const pt of blIterator(edge.a, edge.b) ) {
      coveredPixels.add(pt.key);
      pt.release();
    }
  });
  return coveredPixels;
}
coveredPixels = uniquePixelsForCanvasWalls()
coveredPixels.forEach(key => Draw.point(PIXI.Point.invertKey(key), { radius: 1 }))

canvas.walls.placeables.forEach(wall => {
  const edge = wall.edge;
  const points = CONFIG.GeometryLib.lib.utils.bresenhamLine(edge.a.x, edge.a.y, edge.b.x, edge.b.y);
  const pt = PIXI.Point.tmp.set()
  for ( let i = 0; i < points.length; i += 2 ) {
    pt.set(points[i], points[i+1]);
    Draw.point(pt, { radius: 1 })
  }
  pt.release();
});

canvas.walls.placeables.forEach(wall => {
  const edge = wall.edge;
  const iter = CONFIG.GeometryLib.lib.utils.bresenhamLineIterator(edge.a, edge.b);
  for ( const pt of iter ) {
    Draw.point(pt, { radius: 1 });
    pt.release();
  }
});



percentArea = uniquePixelsForCanvasWalls().size / canvas.scene.dimensions.sceneRect.area

// Need to account for resolution. Because the walls are stuck at 1 pixel,
// they shrink by res, not res^2.
// Original coverage: length * 1 pixel / (W * H)
// New coverage: length * res * 1 / (W * res) * (H * res) = length / (W * H * res)
// Cnew ~= C orig / res

start = GridCoordinates3d.fromObject(randal.center)
end = GridCoordinates3d.fromObject(zanna.center)
pf = new ClockwiseSweepPathfinder(randal)

res = pf.constructor.worker.resolution
uniquePixelsForCanvasWalls().size * res

percentArea / res

console.log(`
\tScene width: \t${canvas.scene.dimensions.sceneWidth} \theight: \t${canvas.scene.dimensions.sceneHeight}
\tGrid width: \t${pf.constructor.worker.gridDims.x} \theight: \t${pf.constructor.worker.gridDims.y}
\tResolution: \t${pf.constructor.worker.resolution}
\tWall pixels: \t${uniquePixelsForCanvasWalls().size}
\tStart Coords:
\t\tRandal: \t${randal.center.x - canvas.scene.dimensions.sceneX},${randal.center.y - canvas.scene.dimensions.sceneX}
\t\Beiro: \t${beiro.center.x - canvas.scene.dimensions.sceneX},${beiro.center.y - canvas.scene.dimensions.sceneX}
\t\Akra: \t${akra.center.x - canvas.scene.dimensions.sceneX},${akra.center.y - canvas.scene.dimensions.sceneX}
`)




CONFIG.elevationruler.graphPathfinding.cost = "terrain"             // "manhattan"|"euclidean"|"foundry"|"terrain"
CONFIG.elevationruler.graphPathfinding.heuristic = "euclidean"        // "manhattan"|"euclidean"|"foundry"|"terrain"
CONFIG.elevationruler.graphPathfinding.neighborFilter = "occlusion" // "clockwiseSweep"|"occlusion"|"sceneGraph"




start = GridCoordinates3d.fromObject(randal.center)
end = GridCoordinates3d.fromObject(zanna.center)
pf = new GriddedCollisionPathfinder(randal)


start = GridCoordinates3d.fromObject(beiro.center)
end = GridCoordinates3d.fromObject(riswynn.center)
pf = new ClockwiseSweepPathfinder(beiro)

start = GridCoordinates3d.fromObject(akra.center)
end = GridCoordinates3d.fromObject(perrin.center)
pf = new ClockwiseSweepPathfinder(akra)

start = GridCoordinates3d.fromObject(beiro.center)
end = GridCoordinates3d.fromObject(randal.center)
pf = new WebGPUPathfinder(beiro)

midE = (pf.token.topE - pf.token.bottomE) * 0.5;
start.elevation += midE;
end.elevation += midE;

pf.debug = true
pf.debugDelay = 100;

await pf.startPathfinding(start);
path = await pf._findPath(start, end)
pf.constructor.drawPath(path)
pf.validatePath(path.map(pt => GridCoordinates3d.fromObject(pt)), start, end)


graph = new pf.graphClass(pf.world)
graph.debug = pf.debug
graph.debugDelay = pf.debugDelay
state = graph._startRun(start, end)
await graph.doRun(state)

iter = await graph._doRun(state)
await iter.next()


reachedGoal = graph._processNextFrontier(state)



res = await snapPathToGrid(path, pf.token)
pf.constructor.drawPath(res.gridPath)

path = path.map(pt => GridCoordinates3d.fromObject(pt));
res.pf.debug = true
res.pf.debugDelay = 100
await res.pf.findPath(path[0], path.at(-1))

terrainWaypoints = akra.createTerrainMovementPath([akra.center, perrin.center]);
akra.measureMovementPath(terrainWaypoints).cost;

pf.world.cost(akra.center, perrin.center)

canvas.grid.measurePath([akra.center, perrin.center])
canvas.grid.measurePath(terrainWaypoints)

// Clockwise sweep
CONFIG.elevationruler.clockwiseSweepPathfinding.cornerGapType = "v"
await pf.startPathfinding(start);
pf.world.cornerMap.keys().forEach(key => Draw.point(PIXI.Point.invertKey(key), { radius: 1 }))
pf.world.cornerMap.values().forEach(v => {
  v.offsetCornerKeys.forEach(key => Draw.point(PIXI.Point.invertKey(key), { color: Draw.COLORS.blue, radius: 1 }))
})
pf.world._terrainPointKeys.forEach(key => Draw.point(PIXI.Point.invertKey(key), { color: Draw.COLORS.green, radius: 1 }));

pf.world.existingNodes.values().forEach(node => Draw.point(node, { color: Draw.COLORS.green, radius: 2 }))



CONFIG.elevationruler.clockwiseSweepPathfinding.cornerGapType = "v" // gap|v|edge
node = pf.world.buildNode(start)
ClockwiseSweepPathfindingNode.CORNER_OFFSET = 20




node = pf.world.buildNode(start)
Draw.star(node)
Draw.shape(node.sweep, { fill: Draw.COLORS.blue, fillAlpha: 0.2 })
neighborKeys = node.getNeighbors()

neighborNodes = pf.world.adjacentOffsets(node)
for ( let i = 0; i < neighborNodes.length; i += 1 ) {
   const node = neighborNodes[i]
   Draw.point(node, { radius: 1 })
   // Draw.shape(node.sweep, { fill: Draw.COLORS.green, fillAlpha: 0.3 })

}


})

corners = offsetGapCorners(node.sweep, 20)
corners.forEach(key => Draw.point(PIXI.Point.invertKey(key)))

await benchTokenPath(randal, zanna.center, { N: 3 });
await benchTokenPath(beiro, riswynn.center, { N: 3 });
await benchTokenPath(akra, perrin.center, { N: 3 });

// Benchmark collision testing
QBenchmarkLoopFn = CONFIG.GeometryLib.lib.bench.QBenchmarkLoopFn
N = 1000

CONFIG.elevationruler.graphPathfinding.neighborFilter = "occlusion"
await pf.startPathfinding(start);
pf.world.testCollision(start, end, pf.token);
await QBenchmarkLoopFn(N, pf.world.testCollision.bind(pf.world), "occlusion", start, end, pf.token)

CONFIG.elevationruler.graphPathfinding.neighborFilter = "sceneGraph"
await pf.startPathfinding(start);
pf.world.testCollision(start, end, pf.token);
await QBenchmarkLoopFn(N, pf.world.testCollision.bind(pf.world), "sceneGraph", start, end, pf.token)

CONFIG.elevationruler.graphPathfinding.neighborFilter = "clockwiseSweep"
await pf.startPathfinding(start);
pf.world.testCollision(start, end, pf.token);
pf.world.testCollision2(start, end, pf.token);
await QBenchmarkLoopFn(N, pf.world.testCollision.bind(pf.world), "clockwiseSweep", start, end, pf.token)
await QBenchmarkLoopFn(N, pf.world.testCollision2.bind(pf.world), "foundry sweep", start, end, pf.token)



CONFIG.elevationruler.graphPathfinding.neighborFilter = "occlusion"
CONFIG.elevationruler.graphPathfinding.neighborFilter = "sceneGraph"
CONFIG.elevationruler.graphPathfinding.neighborFilter = "clockwiseSweep"

console.time("Pathfinding setup")
await pf.startPathfinding(start);
console.timeEnd("Pathfinding setup")
console.time("Pathfinding")
path = await pf._findPath(start, end) // Skip caching
console.timeEnd("Pathfinding")
pf.constructor.drawPath(path)
pf.validatePath(path, start, end)

// Straightened path for collision
gridPath = dropIntermediatePoints(path)
gridPath = straightenPath(gridPath, pf.token);
pf.validatePath(gridPath, start, end)
pf.constructor.drawPath(gridPath)

// Gridded path for collision
gridPath = dropIntermediatePoints(path)
pathIsValid(gridPath, pf.token)
pf.validatePath(gridPath, start, end)

// Straightened path for clockwise is just clockwise path.
// Gridded path for clockwise
gridPath = await snapPathToGrid(path, pf.token);
gridPath = optimizeGridPath(gridPath, pf.token) ;
pathIsValid(gridPath, pf.token)
pf.validatePath(gridPath, start, end)

// Straightened path for webgpu
gridPath = dropIntermediatePoints(path)
gridPath = straightenPath(gridPath, pf.token);
pathIsValid(gridPath, pf.token)
pf.validatePath(gridPath, start, end)

// Gridded path for webgpu
gridPath = dropIntermediatePoints(path)
pathIsValid(gridPath, pf.token)
pf.validatePath(gridPath, start, end)

// Gridded path for webgpu, change resolution
await WebGPUPathfinder.initialize(2 / canvas.dimensions.size);

// Confirm WebGPU distance map
PixelCache = CONFIG.GeometryLib.lib.PixelCache
await pf.startPathfinding(start);
path = await pf._findPath(start, end)
worker = pf.constructor.worker

bufferData = await worker.extractBufferData({ bufferType: "static" })
bufferData = await worker.extractBufferData({ bufferType: "subject" })
bufferData = await worker.extractBufferData({ bufferType: "transient" })
bufferData = await worker.extractBufferData({ bufferType: "combined" })
bufferData = await worker.extractBufferData({ bufferType: "distance" })

uniqueValues = CONFIG.GeometryLib.lib.utils.sortedUnique(bufferData.buffer).reverse()


heatMap = PixelCache.createHeatMap(2, 254);
colorFn = value => {
  switch ( value ) {
    case 1: return Draw.COLORS.white;
    case 255: return Draw.COLORS.red;
    default: return heatMap(value);
  }
}
alphaFn = value => value === 255 ? 1 : 1 ? 0.1 : 0.5

maxBufferValue = uniqueValues[1]; // Second-largest.
wallValue = uniqueValues[0]
heatMap = PixelCache.createHeatMap(2, maxBufferValue);
colorFn = value => {
  switch ( value ) {
    case 1: return Draw.COLORS.white;
    case wallValue: return Draw.COLORS.red;
    default: return heatMap(value);
  }
}
alphaFn = value => value === 255 ? 1 : 1 ? 1 : 1

cache = PixelCache.fromPixelArray(bufferData.buffer, bufferData.width, { resolution: worker.resolution })
cache.translation = worker.sceneTranslation
cache.draw({ maximumPixelValue: 255, local: false, skip: 0, radius: 5, colorFn, alphaFn })


gridPath = dropIntermediatePoints(path)
pathIsValid(gridPath, pf.token)
pf.validatePath(gridPath, start, end)

gridPath = await snapPathToGrid(path, pf.token)
pf.constructor.drawPath(gridPath, { color: Draw.COLORS.lightgreen, alpha: 0.5 })
pf.constructor.drawPath(gridPath, { color: Draw.COLORS.green })

gridPath.forEach(pt => Draw.point(pt, { radius: 1, color: Draw.COLORS.yellow }))

ObstacleSweep = api.pathfinding.ObstacleSweep
geom = ogre.GeometryLib.geometry
dir = end.subtract(start)
ix = start.projectToward(end, geom.rayIntersection(start, dir))
ixNode = pf.world.buildNode(ix)
Draw.star(ixNode)
neighbors = pf.world.getNeighbors(ixNode)

sweep = new ObstacleSweep();
addedEdges = ObstacleSweep.identifyBlockingTokenEdges(pf.token);
addedEdges.forEach(edge => Draw.segment(edge))


token = randal
a = GridCoordinates3d.fromObject(path[0]);
b = GridCoordinates3d.fromObject(path[1]);



gridPath = await snapPathToGrid(path, randal)
gridPath.forEach(pt => Draw.point(pt, { radius: 1, color: Draw.COLORS.yellow }))


gridPath0 = snapSegmentToGrid(path[0], path[1], randal)
gridPath1 = snapSegmentToGrid(path[1], path[2], randal)
gridPath2 = snapSegmentToGrid(path[2], path[3], randal)

gridPath0.forEach(pt => Draw.point(pt, { radius: 1, color: Draw.COLORS.yellow }))
gridPath1.forEach(pt => Draw.point(pt, { radius: 2, color: Draw.COLORS.orange }))
gridPath2.forEach(pt => Draw.point(pt, { radius: 3, color: Draw.COLORS.red }))


// Simple world to get a gridded pathfind.
pf = new GriddedCollisionPathfinder(randal)


let cost = "foundry"; // Would account for terrain.
let heuristic;
switch ( canvas.grid.diagonals ) {
  case CONST.GRID_DIAGONALS.ILLEGAL:
  case CONST.GRID_DIAGONALS.EQUIDISTANT: heuristic = "manhattan"; break;

  case CONST.GRID_DIAGONALS.EXACT: heuristic = "euclidean"; break;
  case CONST.GRID_DIAGONALS.APPROXIMATE: heuristic = "euclidean"; break;

  default: heuristic = "foundry"; break;
}

worldClass = worldBuilderGriddedCollision({ cost, heuristic, use3d: false, pt3d: true, neighborFilter: "sceneGraph" })
pf.world = new worldClass()


pf.startPathfinding(path[0])
gridPath0 = await pf._findPath(path[0], path[1])

pf.startPathfinding(path[1])
gridPath1 = await pf.findPath(path[1], path[2])

pf.startPathfinding(path[2])
gridPath2 = await pf.findPath(path[2], path[3])


nodes = [...pf.world.existingNodes.values()]
colors = Object.values(Draw.COLORS)
i = 0
Draw.point(nodes[i], { color: colors[i], radius: 3 })
nodes[i].drawShape({ fill: colors[i], width: 0 })
nodes[i].drawGapEdges({ color: colors[i] })
nodes[i].drawGapPoints({ color: colors[i], alpha: 0.5 })


nodes.forEach(node => Draw.point(node))

Pathfinder VKC3FgTw46ki8yHD|{x: 2650, y: 2550, z: 0} --> {x: 1950, y: 2650, z: 0} path has collision at 3:
	{x: 2650, y: 2550, z: 0}
	{x: 2177.885437667892, y: 3042.2040753400374, z: 0}
	{x: 2170.4, y: 3040.2, z: 0}
	{x: 2004.0249223594997, y: 2696.8695048315003, z: 0}
	{x: 1950, y: 2650, z: 0}


AbstractPathfinder.js:111 Pathfinder V4s4gx9T3tSXwgzv|{x: 2150, y: 3050, z: 0} --> {x: 1750, y: 2650, z: 0} path has collision at 4:
	{x: 2150, y: 3050, z: 0}
	{x: 2183, y: 2824, z: 0}
	{x: 1888, y: 2915, z: 0}
	{x: 1710, y: 2920, z: 0}
	{x: 1749, y: 2976, z: 0}
	{x: 1560, y: 2700, z: 0}
	{x: 1750, y: 2650, z: 0}

AbstractPathfinder.js:111 Pathfinder NKZT67jDDiyacusU|{x: 1750, y: 2550, z: 0} --> {x: 1850, y: 2550, z: 0} path has collision at 3:
	{x: 1750, y: 2550, z: 0}
	{x: 1590, y: 2498, z: 0}
	{x: 1600, y: 2290, z: 0}
	{x: 1810, y: 2300, z: 0}
	{x: 1850, y: 2550, z: 0}

AbstractPathfinder.js:137 ClockwiseSweepPathfinder UDY8OEpN0gXbyYqb|Cleaned|{x: 1750, y: 2750, z: 0} --> {x: 2650, y: 2550, z: 0} path has collision at 9:
	{x: 1750, y: 2750, z: 0}
	{x: 1950, y: 2750, z: 0}
	{x: 2050, y: 2750, z: 0}
	{x: 2050, y: 2550, z: 0}
	{x: 2050, y: 2350, z: 0}
	{x: 2250, y: 2350, z: 0}
	{x: 2250, y: 2350, z: 0}
	{x: 2350, y: 2450, z: 0}
	{x: 2450, y: 2450, z: 0}
	{x: 2550, y: 2550, z: 0}
	{x: 2650, y: 2550, z: 0}


pf.world = new (worldBuilder())()
pf.initialize()
path = await pf.findPath(start, end)
AStarPathfinder.drawPath(path)


// Test with terrain cost
pf.world = new (worldBuilder({ cost: "terrain" }))()
pf.initialize()
path = await pf.findPath(start, end)
AStarPathfinder.drawPath(path)

// Change to occlusion
pf.world = new (worldBuilder({ neighborFilter: "occlusion" }))()
pf.initialize()
path = await pf.findPath(start, end)
AStarPathfinder.drawPath(path)

// Occlusion + cost
pf.world = new (worldBuilder({ neighborFilter: "occlusion", cost: "terrain" }))()
pf.initialize()
path = await pf.findPath(start, end)
AStarPathfinder.drawPath(path)

// Test with token dragging
CONFIG.elevationruler.graphPathfinding.cost = "terrain"
CONFIG.elevationruler.graphPathfinding.neighborFilter = "occlusion"


geom = randal.GeometryLib.geometry
geom.rayIntersection(start, end.subtract(start))

waypoints = randal.createTerrainMovementPath([start, end])
randal.measureMovementPath(waypoints)
// end.y += 25


pathfindingCfg = CONFIG.elevationruler.graphPathfinding;

pf = new BFSPathfinder(randal)
pf = new UniformCostPathfinder(randal)
pf = new GreedyBestFirstPathfinder(randal)
pf = new AStarPathfinder(randal)

path = await pf.findPath(start, end)
pf.drawDebug()
AStarPathfinder.drawPath(path)

end = GridCoordinates.fromObject(zanna.center)
end.y += 25
path = pf.findPath(start, end)
setTimeout(() => {
  console.log("--- Cancel button clicked! ---");
  pf.stop = true
}, 1);


path = pf.findPath(start, end)
pf.stop = true;


// Test

class TestClass {
  isRunning = false;

  progress = 0;

  async longRunningProcess() {
    this.isRunning = true;
    this.progress = 0;

    console.log("Starting loop...");

    while (this.isRunning) {
      // 1. Perform an async task
      console.log(`Processing step ${this.progress}...`);
      // await new Promise(resolve => setTimeout(resolve, 1000));
      await this.subprocess();

      // 2. IMMEDIATE CHECK
      // If the flag was flipped during the 'await' above, exit now.
      if (!this.isRunning) {
        break;
      }

      // 3. Update internal logic
      this.progress++;

      if (this.progress >= 10) {
        console.log("Task finished naturally.");
        break;
      }
    }

    console.log("Loop has exited. Cleaning up resources...");
    this.isRunning = false;
  }

//   async subprocess() {
//     console.log("...running subprocess");
//     await new Promise(resolve => setTimeout(resolve, 1000));
//     console.log("...finished subprocess");
//   }

  async subprocess() {
    return new Promise(resolve => {
      pf.findPath
    })

    const path = await pf.findPath(start, end)
  }
}

// Start the process
test = new TestClass()

test.longRunningProcess();

// Simulate a user clicking "Cancel" after 3.5 seconds
setTimeout(() => {
  console.log("--- Cancel button clicked! ---");
  test.isRunning = false;
}, 3500);


let isCancelled = false;

// A generic async function that might be doing
// file I/O, heavy calculation, or database work
async function processChunk(id) {
  // Simulating any async work
  let a = 1;
  for ( let i = 0; i < 1000000; i += 1 ) a *= i;
//   return new Promise(resolve => {
//     console.log(`Working on ID: ${id}`);
//     resolve(`Result ${id}`);
//   });
}

async function runHeavyTask() {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  for (const item of items) {
    // 1. Check BEFORE starting the next task
    if (isCancelled) {
      console.log("Cancelled before.")
      break;
    }

    // 2. The generic async call
    const result = await processChunk(item);

    // 3. Check AFTER the task finishes
    if (isCancelled) {
      console.log("Stopping after task finished.");
      return;
    }

    console.log("Processed:", result);
  }

}

// Start the loop
runHeavyTask();

// Later, an external event cancels it
isCancelled = true;

*/
