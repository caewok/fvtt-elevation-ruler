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
import { AbstractPathfinder } from "./AbstractPathfinder.js";
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../geometry/const.js";
import { Settings } from "../settings.js";
import { tokenTerrainValue, regionTerrainValue, TERRAIN_FEATURES } from "./terrain_utils.js";
import { VertexObject } from "../geometry/placeable_vertices/PlaceableVertices.js";
import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";
import { mix } from "../geometry/mixwith.js";
import { dropIntermediatePoints, straightenPath } from "./path_cleaning.js";
import { Triangle3d } from "../geometry/3d/Polygon3d.js";

// TODO: import { FastBitSet } from "../FastBitSet/FastBitSet.js";

/**
 * @typedef object Segment
 * @prop {PIXI.Point} a
 * @prop {PIXI.Point} b
 *
 * Or
 * @prop {PIXI.Point} A
 * @prop {PIXI.Point} B
 */

// NOTE: GPUTerrainMixin
/**
 * Mixin to calculate GPU terrain data.
 * - Segment arrays for blocking walls.
 * - Triangle vertices/indices for difficult terrain.
 * The underlying class must have a token property to use instantiated methods.
 */
const GPUTerrainMixin = superclass => class extends superclass {

  // ----- NOTE: Static methods ----- //

  /**
   * Convert a wall object or Edge to flat typed array.
   * @param {Wall[]} walls
   * @returns {Float32Array}
   */
  static convertWallsToFlatArray(walls) {
    walls ||= canvas.walls.placeables;
    const numSegments = walls.length;
    const numCoordinates = numSegments * 4; // A.x, A.y, B.x, B.y
    const segmentArr = new Float32Array(numCoordinates);
    let i = 0;
    for ( const wall of walls ) {
      // Lengthen walls by 1 pixel in each direction to avoid path skipping.
      /*
      const edge = wall.edge;
      const dist2 = (PIXI.Point.distanceBetween(edge.a, edge.b) + 1) ** 2;
      const b = edge.a.towardsPointSquared(edge.b, dist2);
      const a = edge.b.towardsPointSquared(edge.a, dist2);
      segmentArr.set([a.x, a.y, b.x, b.y], i);
      */
      segmentArr.set(wall.document.c, i);
      i += 4;
    }
    return segmentArr;
  }

  /**
   * Convert a segment object or Edge to flat typed array.
   * @param {Segment[]|Edge[]} segments
   * @returns {Float32Array}
   */
  static convertEdgesToFlatArray(edges) {
    edges ||= canvas.edges.values();
    const numSegments = edges.length;
    const numCoordinates = numSegments * 4; // A.x, A.y, B.x, B.y
    const segmentArr = new Float32Array(numCoordinates);
    let i = 0;
    for ( const edge of edges ) {
      const a = edge.a ?? edge.A;
      const b = edge.b ?? edge.B;
      segmentArr[i++] = a.x;
      segmentArr[i++] = a.y;
      segmentArr[i++] = b.x;
      segmentArr[i++] = b.y;
    }
    return segmentArr;
  }

  /**
   * Convert token edges to flat segment array.
   * Used to treat a token as having walls.
   * @param {Token[]} tokens
   * @returns {Float32Array}
   */
  static convertTokenEdgesToFlatArray(tokens) {
    const edges = tokens.flatMap(t => [...t.constrainedTokenBorder.iterateEdges( { close: true })]);
    return this.convertEdgesToFlatArray(edges);
  }

  /**
   * Convert token tops to vertices object.
   * @param {Token[]} tokens
   * @returns {VertexObject}
   */
  static convertTokenTopsToVertexObject(tokens) {
    tokens ||= canvas.tokens.placeables;
    const vos = tokens.map(token => this._convertPlaceableTopToVertexObject(token));
    const vo = vos.length === 1 ? vos[0] : vos[0].combine(...vos.slice(1));
    vo.condense(vo);
    vo.dropZ();
    return vo;
  }

  /**
   * Convert region tops to vertices object.
   * @param {Region[]} regions
   * @returns {VertexObject}
   */
  static convertRegionTopsToVertexObject(regions) {
    regions ||= canvas.regions.placeables;
    const vos = regions.map(region => this._convertPlaceableTopToVertexObject(region));
    const vo = vos.length === 1 ? vos[0] : vos[0].combine(...vos.slice(1));
    vo.condense(vo);
    vo.dropZ();
    return vo;
  }

  /**
   * Convert a placeable with a top geometry to vertices object.
   * @param {Token|Region|Wall|Tile} placeable
   * @returns {VertexObject}
   */
  static _convertPlaceableTopToVertexObject(placeable) {
    // First convert to Triangles3d.
    const top = placeable[GEOMETRY_LIB_ID][GEOMETRY_ID].faces.top;
    const tris = top.triangulate();

    // Then convert to vertices.
    const vo = new VertexObject();
    vo.hasUVs = false;
    vo.hasNormals = false;
    vo.vertices = Triangle3d.trianglesToVertices(tris);
    return vo;
  }

  static blockingWalls({ walls, senseType = "move", elevationZ = 0 } = {}) {
    walls ||= canvas.walls.placeables;
    const NORMAL = CONST.WALL_SENSE_TYPES.NORMAL;
    return walls
      .filter(wall => {
        if ( wall.document[senseType] !== NORMAL ) return false;
        if ( wall.isDoor ) return false; // Doors go in transient data.
        if ( elevationZ >= wall.topZ && elevationZ < wall.bottomZ ) return false; // If top equals token elevation, don't blokc.
        return true;
      });
  }

  static closedDoors({ walls, senseType = "move", elevationZ = 0 } = {}) {
    walls ||= canvas.walls.placeables;
    const NORMAL = CONST.WALL_SENSE_TYPES.NORMAL;
    return walls.filter(wall => {
      if ( wall.document[senseType] !== NORMAL ) return false;
      if ( !wall.isDoor || wall.isOpen ) return false; // Only want closed doors here.
      if ( elevationZ >= wall.topZ && elevationZ < wall.bottomZ ) return false; // If top equals token elevation, don't blokc.
      return true;
    });
  }

  static openedDoors({ walls, senseType = "move", elevationZ = 0 } = {}) {
    walls ||= canvas.walls.placeables;
    const NORMAL = CONST.WALL_SENSE_TYPES.NORMAL;
    return walls.filter(wall => {
      if ( wall.document[senseType] !== NORMAL ) return false;
      if ( !(wall.isDoor && wall.isOpen) ) return false; // Only want closed doors here.
      if ( elevationZ >= wall.topZ && elevationZ < wall.bottomZ ) return false; // If top equals token elevation, don't block.
      return true;
    });
  }

  // ----- NOTE: Properties ----- //

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  senseType = "move";

  // ----- NOTE: Methods ----- //

  /**
   * Move value for token.
   * If tokens block, mark as wall.
   * Otherwise, mark with difficulty value based on ally/enemy from perspective of subject token
   * @param {Token} token               Token to score
   * @param {Token} subjectToken        Token that is doing the move
   * @returns {number}
   */
  static tokenValue(token, subjectToken) {
    return tokenTerrainValue(token, subjectToken);
  }

  static regionValue(region, subjectToken) {
    return regionTerrainValue(region, subjectToken);
  }

  blockingTokens(tokens) {
    tokens ||= canvas.tokens.placeables;
    const subjectToken = this.token;
    return tokens.filter(token => {
      const value = this.constructor.tokenValue(token, subjectToken);
      return value === TERRAIN_FEATURES.IMPASSABLE;
    });
  }

  terrainRegions(regions) {
    regions ||= canvas.regions.placeables;
    // TODO: Handle more than 2x multipliers. Probably by adding more than once.
    const subjectToken = this.token;
    return regions.filter(region => {
      if ( !region.document.shapes.length ) return false;
      const value = this.constructor.regionValue(region, subjectToken);
      return value !== TERRAIN_FEATURES.NORMAL;
    });
  }

  terrainTokens(tokens) {
    tokens ||= canvas.tokens.placeables;
    // TODO: Handle more than 2x multipliers. Probably by adding more than once.
    const subjectToken = this.token;
    return tokens.filter(token => {
      const value = this.constructor.tokenValue(token, subjectToken);
      return !(value === TERRAIN_FEATURES.NORMAL || value === TERRAIN_FEATURES.IMPASSABLE);
    });
  }
};

export class WebGPUPathfinderWorker extends foundry.helpers.AsyncWorker {

  /**
   * @param {string} [name="WebGPUPathfinder"]
   * @param {object} [config]                        Worker initialization options
   * @param {boolean} [config.debug=false]           Should the worker run in debug mode?
   */
  constructor(name = `${MODULE_ID}.WebGPUPathfinder`, config = {}) {
    config.debug ??= CONFIG[MODULE_ID].debug;
    config.scripts ??= [`/modules/${MODULE_ID}/scripts/pathfinding/workers/webgpu.pathfinder.worker.js`];
    config.loadPrimitives ??= false;
    super(name, config);
  }

  /** @type {number} */
  #resolution = 1;

  get resolution() { return this.#resolution; }

  /** @type {PIXI.Point} */
  sceneDims = new PIXI.Point();

  /** @type {PIXI.Point} */
  gridDims = new PIXI.Point();

  /** @type {PIXI.Point} */
  sceneTranslation = new PIXI.Point();

  get area() { return this.gridDims.x * this.gridDims.y; }


  /**
   * Initialize the pathfinder.
   * @param {object} options
   * @param {number} options.sceneWidth
   * @param {number} options.sceneHeight
   * @param {number} [options.resolution=1]
   * @param {number} [options.translationX=0]
   * @param {number} [options.translationY=0]
   * @returns {boolean}
   */
  async initialize(resolution = 1) {
    this.#resolution = resolution;
    const sceneDims = this.sceneDims.set(canvas.scene.dimensions.sceneWidth, canvas.scene.dimensions.sceneHeight);
    this.gridDims.set(
      Math.ceil(sceneDims.x * resolution),
      Math.ceil(sceneDims.y * resolution),
    );
    const translationX = canvas.scene.dimensions.sceneX;
    const translationY = canvas.scene.dimensions.sceneY;
    this.sceneTranslation.set(translationX, translationY);
    const params = {
      resolution,
      sceneWidth: sceneDims.x,
      sceneHeight: sceneDims.y,
      translationX,
      translationY,
    };
    return this.executeFunction("initialize", [params]);
  }

  /**
   * Update a buffer with blocking segments
   * @param {Float32Array} segments       The 2d segment positions: [A.x, A.y, B.x, B.y]
   * @param {object} options
   * @param {"transient"|"static"|"subject"} [options.bufferType="transient"]   Which buffer to update
   * @param {boolean} [options.clear=true]                                      Clear buffer prior to updating?
   * @returns {boolean}
   */
  updateBufferBlockingSegments(segments, { bufferType = "transient", clear = true } = {}) {
    const params = {
      segments,
      bufferType,
      clear,
    };
    return this.executeFunction("updateBufferBlockingSegments", [params], [segments.buffer]);
  }

  /**
   * Update a buffer with terrain triangles.
   * The pixels under the triangles will be multiplied by 2 for the difficulty.
   * @param {VertexObject} triVO
   * @param {object} options
   * @param {"transient"|"static"|"subject"} [options.bufferType="transient"]   Which buffer to update
   * @param {boolean} [options.clear=true]                                      Clear buffer prior to updating?
   * @param {boolean} [options.debug=false]
   * @returns {boolean}
   */
  updateTerrainTriangles(triVO, { bufferType = "transient", clear = true } = {}) {
    const params = {
      vertices: triVO.vertices,
      indices: triVO.indices,
      bufferType,
      clear,
    };
    return this.executeFunction("updateBufferTerrainTriangles", [params], [triVO.vertices.buffer, triVO.indices.buffer]);
  }

  /**
   * Clear a buffer
   * @param {"transient"|"static"|"subject"} [options.bufferType="transient"]
   * @param {boolean} [options.debug=false]
   */
  clearBuffer(bufferType = "transient") {
    const params = { bufferType };
    return this.executeFunction("clearBuffer", [params]);
  }

  /**
   * Dimensions of the pixel buffer used, for debugging.
   * @returns {[result: object]}
   */
  pixelBufferDimensions() {
    return this.executeFunction("pixelBufferDimensions");
  }

  /**
   * Extract buffer data (for debugging)
   * @param {object} options
   * @param {"transient"|"static"|"subject"|"distance"} options.bufferName
   * @param {Float32Array} buffer
   * @returns {[result: object, transfer: object[]}
   */
  async extractBufferData({ bufferType = "transient" } = {}) {
    const params = { bufferType };
    const res = await this.executeFunction("extractBufferData", [params]);
    return res;
  }

  /**
   * Calculate the distance map given current buffers.
   * @param {object} options
   * @param {number} options.startX           Token x position
   * @param {number} options.startY           Token y position
   * @param {number} options.elevation        Token elevation
   * @param {boolean} [options.debug=false]
   * @returns {boolean}
   */
  async calculateDistanceMap(start) {
    const params = { startX: start.x, startY: start.y, elevation: start.elevation };
    return this.executeFunction("calculateDistanceMap", [params]);
  }

  /**
   * Find the path
   */
  async findPath(start, end, signal) {
    const params = {
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
      elevation: start.elevation,
      signal,
      diagonalCost: this.constructor.diagonalCost,
    };
    const res = await this.executeFunction("findPath", [params]);
    const nPts = Math.floor(res.path.length * 0.5); // Path is array of x,y coordinates.
    if ( !nPts ) return null;

    // Switch to 3d coordinates.
    const path = Array(nPts);
    for ( let i = 0, j = 0; j < nPts; ) {
      path[j++] = GridCoordinates3d.tmp.set(res.path[i++], res.path[i++], start.z);
    }

    return path;
  }

  async destroy() {
    return this.executeFunction("destroy");

  }

  async terminate() {
    return this.executeFunction("terminate");
  }

  async toggleDebug(debug) {
    const params = { debug };
    await this.executeFunction("toggleDebug", [params]);
  }

  static get diagonalCost() {
    const GD = CONST.GRID_DIAGONALS;
    switch ( canvas.grid.diagonals ) {
      case GD.EQUIDISTANT: return 1;
      case GD.EXACT: return Math.SQRT2;
      case GD.APPROXIMATE: return 1.5;
      case GD.RECTILINEAR: return 2;
      case GD.ALTERNATING_1: return -1;
      case GD.ALTERNATING_2: return -2;
      case GD.ILLEGAL: return Number.POSITIVE_INFINITY;
      default: return Math.SQRT2;
    }
  }
}

// NOTE: WebGPUPathfinder
export class WebGPUPathfinder extends mix(AbstractPathfinder).with(GPUTerrainMixin) {

  static _initialized = false;

  static get supportsWebGPU() { return Boolean(navigator.gpu); }

  static async initialize(resolution) {
    if ( this._initialized ) {
      if ( resolution === this.worker.resolution ) return;
      await this.destroy(); // Reset the worker to the new resolution.
    } else if ( !this.worker ) this.worker = new this.workerClass();
    resolution ??= this.recommendedResolution;
    await this.worker.initialize(resolution);
    this._initialized = true;
  }

  // ----- NOTE: Static worker creation ----- //

  static get workerClass() { return WebGPUPathfinderWorker; }

  /**
   * For a given number of canvas pixels to represent one local pixel, what resolution?
   * @param {number} pixelSize
   * @returns {number} The resolution to guarantee that pixel size or better.
   */
  static resolutionForPixelSize(pixelSize = 1) {
    const sceneRect = canvas.scene.dimensions.sceneRect;
    const localWidth = sceneRect.width / pixelSize;
    const localHeight = sceneRect.height / pixelSize;
    return Math.max(localWidth / sceneRect.width, localHeight / sceneRect.height);
  }

  /**
   * Recommend a resolution based on the wall subgrid snapping.
   * Should be double the number of snapping positions.
   * @returns {number}
   */
  static get recommendedResolution() {
    /* https://foundryvtt.com/article/walls/
    50px grids have 1/4 precision (5 snap points per grid unit).
    100px grids have 1/8 precision (9 snap points per grid unit)
    200px grids have 1/16 precision (17 snap points per grid unit)

    See canvas.walls.getSnappedPoint
    size = canvas.dimensions.size
    size >= 128 ? 8 : (size >= 64 ? 4 : 2)

    If canvas size is 100, resolution of 2 / 100 divides a grid square into two portions.
    Approximately:
    |ww••••ww|ww••••ww| <-- Forces path to be in middle of grid or get blocked.

    As wall positions increase, resolution must be incremented by 2. E.g., 4 /100:
    |w••ww••w|w••ww••w|

    */

    const size = canvas.dimensions.size;
    let numWallPositions = 4; // Small grid.
    if ( !canvas.grid.isGridless && Settings.get(Settings.KEYS.PATHFINDING.SNAP_TO_GRID ) ) numWallPositions = 1;
    else if ( size >= 128 ) numWallPositions = 8;
    else if ( size >= 64 ) numWallPositions = 4;
    return (numWallPositions * 2) / size;
  }

  /** @type {WebGPUPathfinderWorker|WebGPUPathfinderFakeWorker} */
  static worker;


  // ----- NOTE: Static scene data update ----- //

  // Track the current elevation. Null indicates the elevation has not been set or terrain must be updated.
  // Track the current token id. "" indicates the subject terrain must be modified.

  /** @type {number} */
  static currentElevationZ = null;

  /** @type {string} */
  static currentTokenId = "";

  /**
   * Static terrain represents all blocking walls in the scene and all closed doors.
   * Doors can also be marked opened/closed individually or groups.
   */
  static async updateStaticTerrain({ elevationZ = null, walls, clear = true } = {}) {
    elevationZ ??= this.currentElevationZ;
    if ( elevationZ == null ) return;

    this.currentElevationZ = elevationZ;
    const bufferType = "static";
    const blockingWalls = [...this.blockingWalls({ walls, elevationZ }), ...this.closedDoors({ walls, elevationZ })];
    if ( blockingWalls.length ) {
      const wallSegments = this.convertWallsToFlatArray(blockingWalls);
      await this.worker.updateBufferBlockingSegments(wallSegments, { bufferType, clear }); // Async.
    } else if ( clear ) await this.worker.clearBuffer(bufferType);

    // Check for open doors and modify accordingly if the terrain was not cleared.
    if ( !clear ) await this.openDoors({ walls, elevationZ });
  }

  /**
   * Open 1+ doors in the terrain at the current elevation.
   */
  static async openDoors({ walls } = {}) {
    if ( this.currentElevationZ == null ) return;
    const elevationZ = this.currentElevationZ;
    const bufferType = "static";
    const openDoors = this.openedDoors({ walls, elevationZ });
    if ( !openDoors.length ) return;
    const wallSegments = this.convertWallsToFlatArray(openDoors);
    return this.worker.updateBufferBlockingSegments(wallSegments, { bufferType, clear: false, openDoors: true }); // Async.
  }

  /**
   * Close 1+ doors in the terrain at the current elevation.
   */
  static async closeDoors({ walls } = {}) {
    if ( this.currentElevationZ == null ) return;
    const elevationZ = this.currentElevationZ;
    const bufferType = "static";
    const closedDoors = this.closedDoors({ walls, elevationZ });
    if ( !closedDoors.length ) return;
    const wallSegments = this.convertWallsToFlatArray(closedDoors);
    return this.worker.updateBufferBlockingSegments(wallSegments, { bufferType, clear: false }); // Async.
  }

  // ----- NOTE: Subject scene data update ----- //

  /**
   * Update data that does not constantly move (e.g. tokens) but requires a subject token.
   */
  async updateSubjectTerrain({ clear = true } = {}) {
    this.constructor.currentTokenId = this.token.id;
    const bufferType = "subject";
    const terrainRegions = this.terrainRegions();
    if ( !terrainRegions.length ) return clear ? this.constructor.worker.clearBuffer(bufferType) : null; // Async.
    const terrainRegionsVO = this.constructor.convertRegionTopsToVertexObject(terrainRegions);
    return this.constructor.worker.updateTerrainTriangles(terrainRegionsVO, { bufferType, clear }); // Async;
  }

  // ----- NOTE: Transient scene data update ----- //

  /**
   * Update data that constantly moves (e.g. tokens).
   */
  async updateTransientTerrain({ clear = true } = {}) {
    const bufferType = "transient";
    const blockingTokens = this.blockingTokens();
    if ( blockingTokens.length ) {
      const blockingSegments = this.constructor.convertTokenEdgesToFlatArray(blockingTokens);
      await this.constructor.worker.updateBufferBlockingSegments(blockingSegments, { bufferType, clear });
      clear = false;
    }

    const terrainTokens = this.terrainTokens();
    if ( terrainTokens.length ) {
      const terrainTokensVO = this.constructor.convertTokenTopsToVertexObject(terrainTokens);
      await this.constructor.worker.updateTerrainTriangles(terrainTokensVO, { bufferType, clear });
      clear = false;
    }

    if ( clear ) await this.constructor.worker.clearBuffer(bufferType);
  }

  // ----- NOTE: Start pathfinding ----- //

  async startPathfinding(start) {
    const worker = this.constructor.worker;

    if ( start.z !== this.constructor.currentElevationZ ) {
      await this.constructor.updateStaticTerrain({ elevationZ: start.z });
    }
    if ( this.token.id !== this.constructor.currentTokenId ) await this.updateSubjectTerrain();

    await this.updateTransientTerrain();
    await worker.calculateDistanceMap(start);
  }

  // ----- NOTE: Pathfind ----- //

  async _findPath(start, goal, _signal) {
    const path = await this.constructor.worker.findPath(start, goal);
    if ( !path || !path.length ) return null;

    // If the start or end is absent, add.
    // Can happen if the start or end is not on the WebGPU grid.
    let source;
    let opts;
    if ( !path[0].almostEqual(start) ) {
      source = new foundry.canvas.sources.PointMovementSource({ object: this.token });
      opts = { type: "move", mode: "any", source };
      if ( CONFIG.Canvas.polygonBackends.move.testCollision(start, path[0], opts) ) return null;
      path.unshift(start);
    }
    if ( !path.at(-1).almostEqual(goal) ) {
      source ||= new foundry.canvas.sources.PointMovementSource({ object: this.token });
      opts ||= { type: "move", mode: "any", source };
      if ( CONFIG.Canvas.polygonBackends.move.testCollision(path.at(-1), goal, opts) ) return null;
      path.push(goal);
    }
    return path;
  }

  // ----- NOTE: Path cleaning ----- //

  /**
   * Remove unnecessary path points and straighten the path.
   * @param {Node[]} path
   * @returns {Point[]}
   */
  cleanPath(path) {
    path = dropIntermediatePoints(path);
    return straightenPath(path, this.token);
  }


  /**
   * Snap the path to the grid.
   * @param {Node[]} path
   * @returns {Point[]}
   */
  async snapPathToGrid(path) {
    // Already done.
    return dropIntermediatePoints(path);
  }


  // ----- NOTE: End pathfinding ----- //

  static async destroy() {
    if ( !this.worker ) return;
    await this.worker.destroy();
    this.currentElevationZ = null;
    this.currentTokenId = "";
    this._initialized = false;
  }

  static async terminate() {
    await this.destroy();
    if ( this.worker ) await this.worker.terminate();
    this.worker = null;
  }

  static async toggleDebug(value) {
    if ( this.worker ) await this.worker.toggleDebug(value);
  }
}

/* Test GPUTerrainMap
Draw = CONFIG.GeometryLib.lib.Draw
api = game.modules.get("elevationruler").api
Terrain = api.pathfinding.Terrain
GPUTerrainMap = api.pathfinding.GPUTerrainMap
let randal = canvas.tokens.placeables.find(t => t.name === "Randal")


vo = GPUTerrainMap._convertTokenTopToVertexObject(canvas.tokens.placeables[1])
vo.debugDraw()

vo = GPUTerrainMap.convertTokenTopsToVertexObject(canvas.tokens.placeables)
vo.debugDraw()

vo = GPUTerrainMap.convertRegionTopsToVertexObject(canvas.regions.placeables)
vo.debugDraw()

await GPUTerrainMap.initializeDevice()
resolution = .25
width = Math.ceil(canvas.scene.dimensions.width * resolution)
height = Math.ceil(canvas.scene.dimensions.height * resolution);

mapper = new GPUTerrainMap(width, height, { resolution })
mapper.token = randal
await mapper.initialize();

blockingWalls = mapper.blockingWalls();
blockingWallsSegments = GPUTerrainMap.convertWallsToFlatArray(blockingWalls)
mapper.processBlockingSegments(blockingWallsSegments, { bufferType: "static", clear: true });


blockingTokens = mapper.blockingTokens();
blockingTokensSegments = blockingTokens.map(token => GPUTerrainMap.convertTokenEdgesToFlatArray(token))
mapper.processBlockingSegments(blockingTokensSegments, { bufferType: "subject", clear: true });

blockingDoors = mapper.blockingDoors();
blockingDoorsSegments = GPUTerrainMap.convertWallsToFlatArray(blockingDoors)
mapper.processBlockingSegments(blockingDoorsSegments, { bufferType: "transient", clear: true });

terrainRegions = mapper.terrainRegions()
terrainRegionsVO = GPUTerrainMap.convertRegionTopsToVertexObject(terrainRegions);
mapper.processTerrainTriangles(terrainRegionsVO, { bufferType: "subject", clear: true });

terrainTokens = mapper.terrainTokens();
terrainTokensVO = GPUTerrainMap.convertTokenTopsToVertexObject(terrainTokens);
mapper.processTerrainTriangles(terrainTokensVO, { bufferType: "transient", clear: true });

mapper.combineTerrainBuffers();

bufferData = await mapper.extractBufferData(bufferType = "static")
bufferData = await mapper.extractBufferData(bufferType = "subject")
bufferData = await mapper.extractBufferData(bufferType = "transient")
bufferData = await mapper.extractBufferData(bufferType = "combined")


new Set(bufferData)
histogram(bufferData)
terrain = new Terrain(bufferData, mapper.width, { scale: { x: 0, y: 0, resolution }})
terrain.draw({ skip: 20, local: false })

// Timing of adding buffers manually vs via GPU.
staticData = await mapper.extractBufferData(bufferType = "static")
subjectData = await mapper.extractBufferData(bufferType = "subject")
transientData = await mapper.extractBufferData(bufferType = "transient")
const n = transientData.length;
combinedData = new Float32Array(n)

console.time("CPU Combine data")
for ( let i = 0; i < n; i += 1 ) {
  combinedData[i] = Math.max(staticData[i] + subjectData[i] + transientData[i]);
}
console.timeEnd("CPU Combine data")

console.time("GPU Combine data")
mapper.combineTerrainBuffers();
bufferData = await mapper.extractBufferData(bufferType = "combined")
console.timeEnd("GPU Combine data")


console.time("GPUTerrainMap convert walls")
segmentArr = GPUTerrainMap.convertWallsToArray(canvas.walls.placeables)
console.timeEnd("GPUTerrainMap convert walls")
console.time("GPUTerrainMap process walls")
terrainMap = await mapper.processWalls(segmentArr)
console.timeEnd("GPUTerrainMap process walls")

terrain = new Terrain(terrainMap, width, { scale: { resolution, x: 0, y: 0 } })

m = new Map()
for ( let i = 0, iMax = terrain.pixels.length; i < iMax; i += 1 ) {
  const px = terrain.pixels[i];
  let num = m.get(px) || 0;
  num += 1;
  m.set(px, num);

  if ( px === 255 ) {
    const localPt = terrain._localAtIndex(i);
    console.log(`${i}: ${localPt.x},${localPt.y}`)
    Draw.point(localPt)
  }
}


*/


/* PixelCache testing
PixelCache = CONFIG.GeometryLib.lib.PixelCache
Draw = CONFIG.GeometryLib.lib.Draw

rect = new PIXI.Rectangle(50, 50, 50, 100)
pixels = PixelCache.pixelsUnderRectangle(rect)
pixels.forEach(px => Draw.point(px, { radius: 1 }))
Draw.shape(rect)

circle = new PIXI.Circle(50, 50, 50)
pixels = PixelCache.pixelsUnderCircle(circle)
pixels.forEach(px => Draw.point(px, { radius: 1 }))
Draw.shape(circle)

ellipse = new PIXI.Ellipse(50, 50, 50, 100)
pixels = PixelCache.pixelsUnderEllipse(ellipse)
pixels.forEach(px => Draw.point(px, { radius: 1 }))
Draw.shape(ellipse)

poly = new PIXI.Polygon(50, 50, 150, 45, 100, 120)
pixels = PixelCache.pixelsUnderPolygon(poly)
pixels.forEach(px => Draw.point(px, { radius: 1 }))
Draw.shape(poly)

segment = { a: new PIXI.Point(10, 20), b: new PIXI.Point(50,30) };
pixels = PixelCache.pixelsUnderSegment(segment.a, segment.b)
pixels.forEach(px => Draw.point(px, { radius: 1 }))
Draw.segment(segment)

*/

/* Testing
PixelCache = CONFIG.GeometryLib.lib.PixelCache
Draw = CONFIG.GeometryLib.lib.Draw
api = game.modules.get("elevationruler").api
terrain = new api.pathfinding.Terrain()

// Test basic drawing
rect = new PIXI.Rectangle(50, 50, 50, 100)
terrain.staticTerrain._setPixelsUnderLocalShape(rect, 255)
terrain.staticTerrain.draw({ maximumPixelValue: 255, skip: 0, local: true })
terrain.staticTerrain.drawFromCoords({ maximumPixelValue: 255, skip: 0, local: true })
Draw.shape(rect)


wall = canvas.walls.placeables[0];
terrain.markEdges([wall.edge])

terrain.markEdges();
terrain.markTokens();

terrain.staticTerrain.draw({ maximumPixelValue: 255, skip: 0 })
terrain.transientTerrain.draw({ maximumPixelValue: 255, skip: 0 })

terrain.staticTerrain.drawFromCoords({ maximumPixelValue: 255, skip: 0 })
terrain.transientTerrain.drawFromCoords({ maximumPixelValue: 255, skip: 0 })

terrain.staticTerrain.draw({ maximumPixelValue: 255, local: true, skip: 0 })
terrain.staticTerrain.drawFromCoords({ maximumPixelValue: 255, local: true, skip: 0 })

terrain.transientTerrain.draw({ maximumPixelValue: 255, local: true, skip: 0 })
terrain.transientTerrain.drawFromCoords({ maximumPixelValue: 255, local: true, skip: 0 })


colorFn = value => {
  switch ( value ) {
    case 1: return Draw.COLORS.green;
    case 2: return Draw.COLORS.yellow;
    case 4: return Draw.COLORS.orange;
    case 255: return Draw.COLORS.red;
    default: return Draw.COLORS.blue;
  }
}

heatMap = createHeatMap(2, 254);
colorFn = value => {
  switch ( value ) {
    case 1: return Draw.COLORS.white;
    case 255: return Draw.COLORS.red;
    default: return heatMap(value);
  }
}

alphaFn = value => value === 255 ? 1 : 1 ? 0.1 : 0.5
PixelCache = CONFIG.GeometryLib.lib.PixelCache
cache = PixelCache.fromPixelArray(bufferData.buffer, bufferData.width,
  { resolution: worker.resolution, translate: worker.sceneTranslation })


alphaFn = value => value === 255 ? 1 : 1 ? 0.1 : 0.5
pf.terrain.staticTerrain.draw({ maximumPixelValue: 255, local: true, skip: 5, colorFn, alphaFn })
pf.terrain.transientTerrain.draw({ maximumPixelValue: 255, local: true, skip: 5, colorFn, alphaFn })

pf.terrain.staticTerrain.draw({ maximumPixelValue: 255, local: false, skip: 5, colorFn, alphaFn })
pf.terrain.transientTerrain.draw({ maximumPixelValue: 255, local: false, skip: 5, colorFn, alphaFn })

*/

/*
function displayGridValues(distMap, nX, nY, tm) {
  arr = [];
  for ( let c = -2; c < 3; c += 1 ) {
    for ( let r = -2; r < 3; r += 1 ) {
      arr.push(distMap[tm.indexAtLocal(nX + r, nY + c)]);
      // arr.push({ x: nX + r, y: nY + c - 1})
    }
  }
  // return arr;
  console.log(`Value at ${nX},${nY}: ${distMap[tm.indexAtLocal(nX, nY)]}`)
  return print(arr, 5, 5);
}

function print(arr, nrow, ncol) {
  const startR = 0;
  const startC = 0;
  const endR = nrow;
  const endC = ncol;

  const getIndex = (row, col) => arr[(row * ncol) + col];

  // console.table prints arrays of arrays nicely.
  const out = new Array(endR - startR);
  for ( let r = startR; r < endR; r += 1 ) out[r] = new Array(endC - startC);
  for ( let r = startR; r < endR; r += 1 ) {
    const arrR = out[r];
    for ( let c = startC; c < endC; c += 1 ) arrR[c] = getIndex(r, c);
  }
  // return out;
  console.table(out);
}

displayGridValues(this.distanceMap, currDistMapPosition[0], currDistMapPosition[1], this.terrainMapper)

*/

/* Test pathfinding
PixelCache = CONFIG.GeometryLib.lib.PixelCache
Draw = CONFIG.GeometryLib.lib.Draw
GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
api = game.modules.get("elevationruler").api
WebGPUPathfinder = api.pathfinding.WebGPUPathfinder
await WebGPUPathfinder.initialize();

let randal = canvas.tokens.placeables.find(t => t.name === "Randal")
let zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")

start = GridCoordinates3d.fromObject(randal.center)
end = GridCoordinates3d.fromObject(zanna.center)

pf = new WebGPUPathfinder(randal, 1);
await pf.startPathfinding(start)
path = await pf.findPath(start, end)
WebGPUPathfinder.drawPath(path);


pf.updateTransientTerrain()
pf.updateCombinedTerrain()

bufferData = await pf.terrainMapper.extractBufferData(bufferType = "static")
bufferData = await pf.terrainMapper.extractBufferData(bufferType = "subject")
bufferData = await pf.terrainMapper.extractBufferData(bufferType = "transient")
bufferData = await pf.terrainMapper.extractBufferData(bufferType = "combined")

new Set(bufferData)
histogram(bufferData)

terrain = new Terrain(bufferData, pf.terrainMapper.width, {
  scale: { x: 0, y: 0, resolution: pf.terrainMapper.resolution }})
terrain.draw({ skip: 20, local: false })


pf.createBuffers()
// pf.createBindGroups()

await pf.calculateDistanceMap(start)

new Set(pf.staticTerrain.pixels)
new Set(pf.tokenTerrain.pixels)
new Set(pf.transientTerrain.pixels)
new Set(pf.combinedTerrain.pixels)
new Set(pf.distanceMap)

path = await pf.findPath(start, end)
path = await pf.findPath(start, end)

pf.terrain.staticTerrain.draw({ maximumPixelValue: 255, skip: 10 })
WebGPUPathfinder.drawPath(path);


pf.combinedTerrain.draw({ skip: 5, local: true })
pf.combinedTerrain.draw({ skip: 5, local: false })
pf.terrain.draw({ type: "transient", skip: 5, local: false })


pf.drawDistanceMap({ local: true, skip: 5 })
pf.drawDistanceMap({ local: false, skip: 5 })

pf.terrain.staticTerrain.draw({ maximumPixelValue: 255, skip: 2, local: true })

distMap = new PixelCache(pf.distanceMap, pf.terrainMapper.width)
distValues = sortedUnique(distMap.pixels);
console.log(`Max distance is ${distValues.at(-2)}`);

heatMap = createHeatMap(0, distValues.at(-2));
colorFn = value => value > distValues.at(-2) ? Draw.COLORS.red : heatMap(value);
alphaFn = value => value > distValues.at(-2) ? 1 : 0.5;
distMap.draw({ local: true, skip: 50, maximumPixelValue: distValues.at(-2), colorFn, alphaFn, gammaCorrect: false })


pf.terrain.staticTerrain.draw({ maximumPixelValue: 255, local: true, skip: 10 })
localStart = pf.terrain.staticTerrain._fromCanvasCoordinates(start.x, start.y);
localEnd = pf.terrain.staticTerrain._fromCanvasCoordinates(end.x, end.y);

Draw.point(localStart, { color: Draw.COLORS.red, radius: 2 })
Draw.point(localEnd, { color: Draw.COLORS.green, radius: 2 })

*/


/*
for ( let x = 0; x < 100; x += 1 ) {
  for ( let y = 0; y < 100; y += 1 ) {
    Draw.point({ x, y}, { color: Draw.COLORS.red, radius: 1 })
  }
}
*/


/* Worker testing
PixelCache = CONFIG.GeometryLib.lib.PixelCache
Draw = CONFIG.GeometryLib.lib.Draw
GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
api = game.modules.get("elevationruler").api
WebGPUPathfinder = api.pathfinding.WebGPUPathfinder
WebGPUPathfinderWorker = api.pathfinding.WebGPUPathfinderWorker
GPUTerrainMap = api.pathfinding.GPUTerrainMap;
await WebGPUPathfinder.initializeDevice();

let randal = canvas.tokens.placeables.find(t => t.name === "Randal")
let zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")

start = GridCoordinates3d.fromObject(randal.center)
end = GridCoordinates3d.fromObject(zanna.center)

pf = new WebGPUPathfinder(randal, 1);
pf.terrainMapper = GPUTerrainMap.create(pf.resolution, pf.constructor.device);
pf.terrainMapper.token = pf.token;


worker = new WebGPUPathfinderWorker(undefined, { debug: true })
await worker.initialize(.25);
await worker.pixelBufferDimensions()
await worker.clearBuffer()

walls = pf.terrainMapper.blockingWalls();
wallSegments = GPUTerrainMap.convertWallsToFlatArray(walls);
await worker.updateBufferBlockingSegments(wallSegments, { bufferType: "static", clear: true })

terrainRegions = pf.terrainMapper.terrainRegions();
terrainRegionsVO = GPUTerrainMap.convertRegionTopsToVertexObject(terrainRegions);
await worker.updateTerrainTriangles(terrainRegionsVO, { bufferType: "subject", clear: true })

blockingTokens = pf.terrainMapper.blockingTokens();
blockingDoors = pf.terrainMapper.blockingDoors();
blockingSegments = GPUTerrainMap.convertWallsToFlatArray([...blockingTokens, ...blockingDoors]);
if ( blockingSegments.length ) {
  await worker.updateBufferBlockingSegments(blockingSegments, { bufferType: "transient", clear: true })
}
else await worker.clearBuffer("transient")

terrainTokens = pf.terrainMapper.terrainTokens()
terrainTokensVO = GPUTerrainMap.convertTokenTopsToVertexObject(terrainTokens);
await worker.updateTerrainTriangles(terrainTokensVO, { bufferType: "transient", clear: false })

await worker.calculateDistanceMap(start)
path = await worker.findPath(start, end)

bufferData = await worker.extractBufferData({ bufferType: "static" })
bufferData = await worker.extractBufferData({ bufferType: "subject" })
bufferData = await worker.extractBufferData({ bufferType: "transient" })
bufferData = await worker.extractBufferData({ bufferType: "combined" })
bufferData = await worker.extractBufferData({ bufferType: "distance" })
new Set(bufferData)
new Set(bufferData.sort((a, b) => a - b))
histogram(bufferData)


await pf.initialize()
await pf.calculateDistanceMap(start)
path = await pf.findPath(start, end)
WebGPUPathfinder.drawPath(path);

*/

/* Worker and Fake worker testing

PixelCache = CONFIG.GeometryLib.lib.PixelCache
Draw = CONFIG.GeometryLib.lib.Draw
GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
api = game.modules.get("elevationruler").api
WebGPUPathfinder = api.pathfinding.WebGPUPathfinder
WebGPUPathfinderFakeWorker = api.pathfinding.WebGPUPathfinderFakeWorker

let randal = canvas.tokens.placeables.find(t => t.name === "Randal")
let zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")

start = GridCoordinates3d.fromObject(randal.center)
end = GridCoordinates3d.fromObject(zanna.center)

await WebGPUPathfinder.initialize(1);
await WebGPUPathfinderFakeWorker.initialize(1);

pf = new WebGPUPathfinder(randal);
pf = new WebGPUPathfinderFakeWorker(randal)
pf = randal.elevationruler.pathfinding

await pf.initialize(1);
await pf.constructor.updateStaticTerrain();
await pf.updateSubjectTerrain();
await pf.startPathfinding(start)
path = await pf.findPath(start, end);
pf.constructor.drawPath(path, { radius: 1 })


bufferData = await pf.constructor.worker.extractBufferData({ bufferType: "static" })
bufferData = await pf.constructor.worker.extractBufferData({ bufferType: "subject" })
bufferData = await pf.constructor.worker.extractBufferData({ bufferType: "transient" })
bufferData = await pf.constructor.worker.extractBufferData({ bufferType: "combined" })
bufferData = await pf.constructor.worker.extractBufferData({ bufferType: "distance" })
new Set(bufferData)
new Set(bufferData.sort((a, b) => a - b))


Terrain = api.pathfinding.Terrain
terrain = Terrain.fromPixelArray(bufferData, pf.constructor.worker.gridDims.x,
  { resolution: pf.constructor.worker.resolution })
terrain.translation = pf.constructor.worker.sceneTranslation
terrain.draw({ skip: 20, local: false })

bufferData[pf.constructor.worker.pf.terrainMapper.indexAtCanvas(1997, 2699)]


// Change the resolution of the worker
WebGPUPathfinderFakeWorker.worker.resolution
await WebGPUPathfinderFakeWorker.destroy()
await WebGPUPathfinderFakeWorker.initialize(2/100)

worker = WebGPUPathfinderFakeWorker.worker
await worker.destroy();
await worker.initialize(2/100)
WebGPUPathfinderFakeWorker.currentElevationZ = null
WebGPUPathfinderFakeWorker.currentTokenId = ""

await WebGPUPathfinderFakeWorker.updateStaticTerrain();


*/

/*
idleCallBackTest = function(idleDeadline) {
  console.debug(`${idleDeadline.timeRemaining()}, ${idleDeadline.timeout}`);
  requestIdleCallback(idleCallBackTest)
}

requestIdleCallback(idleCallBackTest)
*/
