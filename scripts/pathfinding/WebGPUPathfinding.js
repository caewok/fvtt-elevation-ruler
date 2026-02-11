/* globals
canvas,
CONFIG,
CONST,
foundry,
game,
GPUBufferUsage,
GPUMapMode,
GPUTextureUsage,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { AbstractPathfinder } from "./AbstractPathfinder.js";
import { PixelCache } from "../geometry/PixelCache.js";
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../geometry/const.js";
import { Settings } from "../settings.js";
import { Draw } from "../geometry/Draw.js";
import { Polygons3d } from "../geometry/3d/Polygon3d.js";
import { combineTypedArrays } from "../geometry/util.js";
import { HorizontalQuadVertices, Polygon3dVertices } from "../geometry/placeable_geometry/BasicVertices.js";
import { VertexObject } from "../geometry/placeable_geometry/GeometryDesc.js";
import { GridCoordinates3d } from "../geometry/3d/GridCoordinates3d.js";
import { mix } from "../geometry/mixwith.js";

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
   * @param {Token} token
   * @returns {Float32Array}
   */
  static convertTokenEdgesToFlatArray(token) {
    const border = token.constrainedTokenBorder;
    return this.convertEdgesToFlatArray([...border.iterateEdges({ close: true })]);
  }

  /**
   * Convert token tops to vertices object.
   * @param {Token[]} tokens
   * @returns {VertexObject}
   */
  static convertTokenTopsToVertexObject(tokens) {
    tokens ||= canvas.tokens.placeables;
    const vos = tokens.map(token => this._convertTokenTopToVertexObject(token));
    const vo = vos.length === 1 ? vos[0] : vos[0].combine(...vos.slice(1));
    vo.condense(vo);
    vo.dropZ();
    return vo;
  }

  /**
   * Convert token top to vertices object.
   * @param {Token} token
   * @returns {VertexObject}
   */
  static _convertTokenTopToVertexObject(token) {
    const vo = new VertexObject();
    if ( token.isConstrainedTokenBorder ) {
      vo.vertices = Polygon3dVertices.polygonTopFace(token.constrainedTokenBorder, { topZ: token.bottomZ, stride: 3 });
      vo.hasNormals = false;
      vo.hasUVs = false;
      return vo;
    }

    vo.vertices = HorizontalQuadVertices.top;
    vo.hasNormals = true;
    vo.hasUVs = true;
    vo.dropNormalsAndUVs({ out: vo });

    const geom = token[GEOMETRY_LIB_ID][GEOMETRY_ID];
    geom.update();
    vo.transformToModel(geom.modelMatrix, vo);
    return vo;
  }

  /**
   * Convert region tops to vertices object.
   * @param {Region[]} regions
   * @returns {VertexObject}
   */
  static convertRegionTopsToVertexObject(regions) {
    regions ||= canvas.regions.placeables;
    const vos = regions.map(region => this._convertRegionTopToVertexObject(region));
    const vo = vos.length === 1 ? vos[0] : vos[0].combine(...vos.slice(1));
    vo.condense(vo);
    vo.dropZ();
    return vo;
  }

  /**
   * Convert region top to vertices object.
   * @param {Region} region
   * @returns {VertexObject}
   */
  static _convertRegionTopToVertexObject(region) {
    const geom = region[GEOMETRY_LIB_ID][GEOMETRY_ID];
    geom.update();

    // Need to earcut faces but also handle holes.
    const vertices = [];
    for ( const faces of geom.combinedFaces ) {
      if ( faces.top.matchesClass(Polygons3d) ) {
        const paths = faces.top.toClipperPaths();
        const top = Polygon3dVertices.polygonTopFace(paths, { topZ: 0, stride: 3 });
        vertices.push(top);
      } else {
        const tris = faces.top.triangulate();
        const outArr = new Float32Array(9 * tris.length);
        let outIdx = 0;
        for ( const tri of tris ) {
          tri.toVertices({ outArr, outIdx });
          outIdx += 9;
        }
        vertices.push(outArr);
      }
    }
    const vo = new VertexObject();
    vo.hasUVs = false;
    vo.hasNormals = false;
    if ( !vertices.length ) return vo;
    vo.vertices = vertices.length > 1 ? combineTypedArrays(vertices) : vertices[0];
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

  blockingTokens(tokens) {
    tokens ||= canvas.tokens.placeables;
    const subjectToken = this.token;
    return tokens.filter(token => {
      const value = Terrain.tokenValue(token, subjectToken);
      return value === Terrain.FEATURES.BLOCKING;
    });
  }

  terrainRegions(regions) {
    regions ||= canvas.regions.placeables;
    // TODO: Handle more than 2x multipliers. Probably by adding more than once.
    const subjectToken = this.token;
    return regions.filter(region => {
      if ( !region.document.shapes.length ) return false;
      const value = Terrain.regionValue(region, subjectToken);
      return value !== Terrain.FEATURES.NORMAL;
    });
  }

  terrainTokens(tokens) {
    tokens ||= canvas.tokens.placeables;
    // TODO: Handle more than 2x multipliers. Probably by adding more than once.
    const subjectToken = this.token;
    return tokens.filter(token => {
      const value = Terrain.tokenValue(token, subjectToken);
      return !(value === Terrain.FEATURES.NORMAL && value === Terrain.FEATURES.BLOCKING);
    });
  }

};


export class Terrain extends PixelCache {

  /** @type {enum<number>} */
  static FEATURES = {
    CLEAR: 0,       // Clear value
    NORMAL: 1,      // Basic move cost to move 1 grid space
    BLOCKING: 255,  // Considered infinite cost: 2^8 - 1.
  };

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  #senseType = "move";

  get senseType() { return this.#senseType; }

  /** @type {number} */
  #elevationZ;

  get elevationZ() { return this.#elevationZ; }

  set elevationZ(value) {
    if ( this.#elevationZ === value ) return;
    this.#elevationZ = value;
    this.clear();
  }

  /**
   * @param {object} [opts]
   * @param {number} [opts.resolution=1]
   * @param {CONST.WALL_RESTRICTION_TYPES} [opts.senseType="move"]
   * @param {number} [opts.elevationZ = 0]
   * @returns {PixelCache<Uint32Array}
   */
  constructor(localWidth, localHeight, { senseType = "move", elevationZ = 0, ...opts} = {}) {
    opts.pixelsOrClass ??= Uint32Array;
    super(localWidth, localHeight, opts);
    this.#senseType = senseType;
    this.#elevationZ = elevationZ;
  }

  static create(opts) {
    const out = this.fromCanvasRectangle(canvas.scene.dimensions.sceneRect, opts);
    out.clear(); // Duplicative if CLEAR is 0.
    return out;
  }

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
   * Recommend a resolution of 10% of the pixel size.
   * @returns {number}
   */
  static recommendedResolution() {
    return this.resolutionForPixelSize(canvas.scene.dimensions.size * 0.1);
  }

  clear() {
    this.pixels.fill(this.constructor.FEATURES.CLEAR);
  }

  /**
   * Mark the edges in the static data.
   * Does not mark transient data nor copy static to transient.
   * @param {Edge[]} [edges]        Edges to mark, if not the entire canvas
   */
  markEdges(edges) {
    edges ??= canvas.edges.getEdges(canvas.scene.dimensions.sceneRect, {
      includeOuterBounds: false,
      includeInnerBounds: false,
    });
    edges.forEach(edge =>
      this.setPixelsUnderCanvasSegment(edge.a, edge.b, this.constructor.FEATURES.BLOCKING));
  }

  /**
   * Mark the edges in the specified data.
   * Does not copy static to transient or clear before marking.
   * @param {Edge} edge        Edge to mark
   */
  markEdge(edge) {
    const value = this.constructor.FEATURES.BLOCKING;
    this.setPixelsUnderCanvasSegment(edge.a, edge.b, value);
  }

  /**
   * Mark the constrained token border in the transient data
   * Does not clear before marking.
   * @param {Token} token         Token from which to extract the constrained border
   * @param {FEATURES} value      Pixel value to use
   */
  markToken(token, value = this.constructor.FEATURES.BLOCKING ) {
    this.setPixelsUnderCanvasShape(token.constrainedTokenBorder, value);
  }

  /**
   * Mark the region in the transient data.
   * Does not clear before marking.
   * @param {Region} region     Region to mark; all shapes in region will be marked
   * @param {FEATURES} value      Pixel value to use
   */
  markRegion(region, value = this.constructor.FEATURES.BLOCKING ) {
    /* Tricky, because (1) need to deal with holes and (2) need to multiply by underlying.
    (a) Determine indices for every shape.
    (b) If holes are present, remove indices for holes.
    - See-saw approach: If more holes than non-holes contain index, remove. If equal, remove. If less, keep.
    */
    region[GEOMETRY_LIB_ID][GEOMETRY_ID].update(); // TODO: Handle elsewhere.
    let hasHoles = false;
    const indexMap = new WeakMap(); // <shape, Set<index keys>>
    let allIndices = new Set();
    for ( const shape of region.document.shapes ) {
      hasHoles ||= shape.hole;
      const localShape = this._shapeToLocalCoordinates(shape[GEOMETRY_LIB_ID][GEOMETRY_ID].shapePIXI);
      const keys = PixelCache.pixelsUnderShape(localShape).map(idx => idx.key);
      const s = new Set(keys);
      indexMap.set(shape, s);
      allIndices = allIndices.union(s);
    }

    if ( hasHoles ) {
      // Remove from the full set any index where holes >= non-holes.
      for ( const key of allIndices ) {
        let nonHoleCount = 0;
        let holeCount = 0;
        for ( const shape of region.document.shapes ) {
          if ( !indexMap.has(shape) ) continue;
          const s = indexMap.get(shape);
          if ( !s.has(key) ) continue;
          if ( shape.hole ) holeCount += 1;
          else nonHoleCount += 1;
        }
        if ( nonHoleCount < holeCount ) allIndices.delete(key);
      }
    }

    // Set each pixel under the region shapes, multiplying by the existing value.
    const idx = PIXI.Point.tmp;
    allIndices.values().forEach(key => {
      PIXI.Point.invertKey(key, idx);
      const i = this._indexAtLocal(idx.x, idx.y);
      const currValue = this.pixels[i];
      const newValue = Math.min(this.constructor.FEATURES.BLOCKING, currValue * value);
      this.pixels[i] = newValue;
    });
    idx.release();
  }

  /**
   * Update the wall data for the scene.
   * @param {CONST.WALL_RESTRICTION_TYPES} senseType      For testing walls
   */
  updateWalls() {
    // TODO: Handle other sense types with special walls.
    // For now, ignore walls that do not fully restrict.
    // For now, ignore token height.
    const senseType = this.senseType;
    const elevationZ = this.elevationZ;
    const NORMAL = CONST.WALL_SENSE_TYPES.NORMAL;
    canvas.walls.placeables
      .filter(wall => {
        if ( wall.document[senseType] !== NORMAL ) return false;
        if ( wall.isDoor ) return false; // Doors go in transient data.
        if ( elevationZ >= wall.topZ && elevationZ < wall.bottomZ ) return false; // If top equals token elevation, don't blokc.
        return true;
      })
      .forEach(wall => this.markEdge(wall.edge));
  }

  updateDoors() {
    // Mark closed doors.
    const senseType = this.senseType;
    const elevationZ = this.elevationZ;
    const NORMAL = CONST.WALL_SENSE_TYPES.NORMAL;
    canvas.walls.placeables
      .filter(wall => {
        if ( wall.document[senseType] !== NORMAL ) return false;
        if ( !wall.isDoor ) return false; // Doors go in transient data.
        if ( elevationZ >= wall.topZ && elevationZ < wall.bottomZ ) return false; // If top equals token elevation, don't blokc.
        return true;
      })
      .forEach(wall => this.markEdge(wall.edge));
  }

  updateTokens(subjectToken) {
    // Score each token.
    // Ignore normal movement.
    canvas.tokens.placeables.forEach(token => {
      const value = this.constructor.tokenValue(token, subjectToken);
      if ( value !== this.constructor.FEATURES.NORMAL ) this.markToken(token, value);
    });
  }

  updateRegions(subjectToken) {
    // Score regions with difficulty.
    // Regions have the potential to overlap, or overlap with tokens.
    canvas.regions.placeables.forEach(region => {
      const value = this.constructor.regionValue(region, subjectToken);
      if ( value !== this.constructor.FEATURES.NORMAL ) this.markRegion(region, value);
    });
  }

  /**
   * Move value for token.
   * If tokens block, mark as wall.
   * Otherwise, mark with difficulty value based on ally/enemy from perspective of subject token
   * @param {Token} token               Token to score
   * @param {Token} subjectToken        Token that is doing the move
   * @returns {number}
   */
  static tokenValue(token, subjectToken) {
    // If the token does not affect the subject, should return NORMAL (not 0, although that could work).
    if ( token === subjectToken ) return this.FEATURES.NORMAL;

    // TODO: Add setting to change this.
    if ( token.isProne ) return this.FEATURES.NORMAL;
    if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsDead(token) ) return this.FEATURES.NORMAL;

    const PATHFINDING = Settings.KEYS.PATHFINDING;
    const blocking = Settings.get(PATHFINDING.TOKENS_BLOCK);
    if ( blocking === PATHFINDING.TOKENS_BLOCK_CHOICES.ALL ) return this.FEATURES.BLOCKING;

    const isEnemy = CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsEnemy(subjectToken, token);
    if ( isEnemy && blocking === PATHFINDING.TOKENS_BLOCK_CHOICES.HOSTILE ) return this.FEATURES.BLOCKING;

    // No token blocking; check for token difficulties.
    const hostileDifficulty = Settings.get(PATHFINDING.TOKEN_DIFFICULTY.HOSTILE);
    if ( isEnemy ) return hostileDifficulty * this.FEATURES.NORMAL;

    const isAlly = CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsAlly(subjectToken, token);
    const allyDifficulty = Settings.get(PATHFINDING.TOKEN_DIFFICULTY.FRIENDLY);
    if ( isAlly ) return allyDifficulty * this.FEATURES.NORMAL;

    return this.FEATURES.NORMAL;
  }

  static regionValue(region, subjectToken) {
    let value = this.FEATURES.NORMAL;
    if ( game.system.id === "dnd5e" ) {
      // Treat multiple difficult behaviors as multiplicative.
      const DIFFICULTY_MULTIPLIER = 2;
      behaviorLoop:
      for ( const behavior of region.document.behaviors ) {
        if ( behavior.type !== "dnd5e.difficultTerrain" ) continue behaviorLoop;
        for ( const ignoredDisposition of behavior.system.ignoredDispositions ) {
          if ( ignoredDisposition === subjectToken.document.disposition ) continue behaviorLoop;
        }
        value *= DIFFICULTY_MULTIPLIER;
      }
    }
    return value;
  }

  draw(opts = {}) {
    const heatMap = createHeatMap(2, 254);
    const colorFn = value => {
      if ( value > 255 ) return Draw.COLORS.red;
      switch ( value ) {
        case 0: return Draw.COLORS.gray;
        case 1: return Draw.COLORS.gray;
        case 255: return Draw.COLORS.red;
        default: return heatMap(value);
      }
    };
    const alphaFn = value => value === 255 ? 1 : value === 1 ? 0.1 : 0.5;
    opts.colorFn ??= colorFn;
    opts.alphaFn ??= alphaFn;
    opts.maximumPixelValue ??= 255;
    opts.skip ??= 10;
    super.draw(opts);
  }
}

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
    params.debug = CONFIG[MODULE_ID].debug;
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
    params.debug = CONFIG[MODULE_ID].debug;
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
    params.debug = CONFIG[MODULE_ID].debug;
    return this.executeFunction("updateBufferTerrainTriangles", [params], [triVO.vertices.buffer, triVO.indices.buffer]);
  }

  /**
   * Clear a buffer
   * @param {"transient"|"static"|"subject"} [options.bufferType="transient"]
   * @param {boolean} [options.debug=false]
   */
  clearBuffer(bufferType = "transient") {
    const params = { bufferType };
    params.debug = CONFIG[MODULE_ID].debug;
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
  async extractBufferData({ bufferType = "transient", buffer } = {}) {
    buffer ??= new Uint32Array(this.area);
    const params = { buffer, bufferType };
    params.debug = CONFIG[MODULE_ID].debug;
    const res = await this.executeFunction("extractBufferData", [params], [buffer.buffer]);
    return res.buffer;
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
    params.debug = CONFIG[MODULE_ID].debug;
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
    };
    params.debug = CONFIG[MODULE_ID].debug;
    const res = await this.executeFunction("findPath", [params]);
    const nPts = res.path.length;
    if ( !nPts ) return null;

    // Switch to 3d coordinates.
    const path = Array(nPts * 0.5);
    for ( let i = 0, j = 0; i < nPts; i += 2, j += 1 ) {
      path[j] = GridCoordinates3d.tmp.set(res.path[i], res.path[i+1], start.z);
    }
    return path;
  }

  async destroy() {
    return this.executeFunction("destroy");

  }

  async terminate() {
    return this.executeFunction("terminate");
  }
}


export class WebGPUPathfinderFakeWorker {

  /**
   * @param {string} [name="WebGPUPathfinder"]
   * @param {object} [config]                        Worker initialization options
   * @param {boolean} [config.debug=false]           Should the worker run in debug mode?
   */
  constructor(_name = `${MODULE_ID}.WebGPUPathfinder`, _config = {}) {}

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

  /** @type {GPUPathfinder} */
  pf;

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
    params.debug = CONFIG[MODULE_ID].debug;

    // Real worker: return this.executeFunction("initialize", [params]);
    this.pf = new GPUPathfinder();
    await this.pf.initialize(params);
    if ( CONFIG[MODULE_ID].debug ) console.debug("WebGPUPathfinderWorker|Initialized.");
    return true;
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
    params.debug = CONFIG[MODULE_ID].debug;
    // Real worker: return this.executeFunction("updateBufferBlockingSegments", [params], [segments.buffer]);
    this.pf.terrainMapper.processBlockingSegments(segments, { bufferType, clear });
    if ( params.debug ) console.debug(`WebGPUPathfinderWorker|Updated blocking segments for ${params.bufferType} buffer.`);
    return true;
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
    params.debug = CONFIG[MODULE_ID].debug;
    /* Real worker: return this.executeFunction("updateBufferTerrainTriangles",
      [params], [triVO.vertices.buffer, triVO.indices.buffer]);
    */
    this.pf.terrainMapper.processTerrainTriangles(params.vertices, params.indices, { bufferType, clear });
    if ( params.debug ) console.debug(`WebGPUPathfinderWorker|Updated terrain for ${params.bufferType} buffer.`);
    return true;
  }

  /**
   * Clear a buffer
   * @param {"transient"|"static"|"subject"} [options.bufferType="transient"]
   * @param {boolean} [options.debug=false]
   */
  clearBuffer(bufferType = "transient") {
    const params = { bufferType };
    params.debug = CONFIG[MODULE_ID].debug;
    // Real worker: return this.executeFunction("clearBuffer", [params]);
    this.pf.terrainMapper.clearTerrainMap(bufferType);
    if ( params.debug ) console.debug(`WebGPUPathfinderWorker|Cleared ${params.bufferType} buffer.`);
    return true;
  }

  /**
   * Dimensions of the pixel buffer used, for debugging.
   * @returns {[result: object]}
   */
  pixelBufferDimensions() {
    // Real worker: return this.executeFunction("pixelBufferDimensions");
    const dims = this.pf.terrainMapper.gridDims;
    return { width: dims[0], height: dims[1] };
  }

  /**
   * Extract buffer data (for debugging)
   * @param {object} options
   * @param {"transient"|"static"|"subject"|"distance"} options.bufferName
   * @param {Float32Array} buffer
   * @returns {[result: object, transfer: object[]}
   */
  async extractBufferData({ bufferType = "transient", buffer } = {}) {
    buffer ??= new Uint32Array(this.area);
    const params = { buffer, bufferType };
    params.debug = CONFIG[MODULE_ID].debug;
    // Real worker: const res = await this.executeFunction("extractBufferData", [params], [buffer.buffer]);
    // return res.buffer;

    if ( bufferType === "distance" ) buffer.set(this.pf.distanceMap);
    else await this.pf.terrainMapper.extractBufferData(bufferType, buffer);
    return buffer;
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
    params.debug = CONFIG[MODULE_ID].debug;
    // Real worker: return this.executeFunction("calculateDistanceMap", [params]);
    const signal = {};
    await this.pf.calculateDistanceMap({ x: params.startX, y: params.startY }, signal, params.debug);
    if ( params.debug ) console.debug(`WebGPUPathfinderWorker|Distance map calculated for ${params.startX},${params.startY},${params.elevation}.`);
    return true;
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
    };
    params.debug = CONFIG[MODULE_ID].debug;
    // Real worker:
    // const res = await this.executeFunction("findPath", [params]);
    // const start = { x: startX, y: startY };
    // const goal = { x: endX, y: endY };
    const res = { path: (await this.pf.findPath(start, end, signal)) };

    const nPts = res.path.length;
    if ( !nPts ) return null;

    // Switch to 3d coordinates.
    const path = Array(nPts * 0.5);
    for ( let i = 0, j = 0; i < nPts; i += 2, j += 1 ) {
      path[j] = GridCoordinates3d.tmp.set(res.path[i], res.path[i+1], start.z);
    }
    if ( params.debug ) console.debug(`WebGPUPathfinderWorker|Path length ${path.length} found for ${params.startX},${params.startY},${params.elevation}.`);
    return path;
  }

  async destroy() {
    // Real worker:
    // await this.executeFunction("destroy");
    if ( this.pf ) this.pf.destroy();
    this.pf = null;
    return true;
  }

  async terminate() {
    // Real worker:
    // await this.executeFunction("terminate");
    await this.destroy();
    GPUPathfinder.destroy();
    return true;
  }
}

// !!! WebGPUPathfinder
export class WebGPUPathfinder extends mix(AbstractPathfinder).with(GPUTerrainMixin) {

  static _initialized = false;

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

  static get workerClass() { return WebGPUPathfinderFakeWorker; }

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
  static async openDoors({  walls }) {
    if ( this.currentElevationZ == null ) return;
    const bufferType = "static";
    const openDoors = this.openedDoors({ walls, elevationZ });
    if ( !openDoors.length ) return;
    const wallSegments = this.convertWallsToFlatArray(openDoors);
    return this.worker.updateBufferBlockingSegments(wallSegments, { bufferType, clear: false, openDoors: true }); // Async.
  }

  /**
   * Close 1+ doors in the terrain at the current elevation.
   */
  static async closeDoors({ walls }) {
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
      const blockingSegments = this.constructor.convertWallsToFlatArray(blockingTokens);
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

    if ( start.z !== this.constructor.currentElevationZ ) await this.constructor.updateStaticTerrain({ elevationZ: start.z });
    if ( this.token.id !== this.constructor.currentTokenId ) await this.updateSubjectTerrain();

    await this.updateTransientTerrain();
    await worker.calculateDistanceMap(start);
  }

  // ----- NOTE: Pathfind ----- //

  async findPath(start, goal, _signal) {
    return this.constructor.worker.findPath(start, goal);
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
}

// !!!WebGPUPathfinderWithWorker
export class WebGPUPathfinderWithWorker extends WebGPUPathfinder {

  static get workerClass() { return WebGPUPathfinderWorker; }

}

/**
 * Get a path
 */
// !!!GPUPathfinder
export class GPUPathfinder {
  static STATUS = {
    CALCULATING: -1,
    NOT_READY: 0,
    READY: 1,
  };

  /**
   * Map of static terrain buffers for different elevations.
   * @type {Map<string, Terrain>}
   */
  static staticTerrainMap = new Map();


  // ----- NOTE: Initialize ----- //

  async initialize({ resolution = 1, sceneWidth, sceneHeight, translationX = 0, translationY = 0, debug = CONFIG[MODULE_ID].debug } = {}) { /* eslint-disable-line max-len */
    this.destroy();
    await this.constructor.initializeDevice();
    if ( debug ) console.debug("WebGPUPathfinderWorker|Initialized device.");
    this.terrainMapper = new GPUTerrainMap(sceneWidth, sceneHeight, this.constructor.device, {
      resolution, translationX, translationY });
    if ( debug ) console.debug("WebGPUPathfinderWorker|Initializing terrain mapper...");
    await this.terrainMapper.initialize();
    if ( debug ) console.debug("WebGPUPathfinderWorker|Finished initializing terrain mapper.");
    this.distanceMap = new Uint32Array(this.terrainMapper.area);
    this.createPipeline();
    this.createBuffers();
    this.createBindGroups();
    if ( debug ) console.debug("WebGPUPathfinderWorker|Finished initialization.");
  }

  /** @type {GPUDevice} */
  static device = null;

  static async initializeDevice() {
    if ( this.device ) return;
    if ( !navigator.gpu ) throw new Error("WebGPU not supported");
    const adapter = await navigator.gpu.requestAdapter();
    this.device = await adapter.requestDevice();
  }

  // ----- NOTE: Distance map ----- //

  /** @type {STATUS} */
  #distanceMapStatus = this.constructor.STATUS.NOT_READY;

  get distanceMapStatus() { return this.#distanceMapStatus; }

  async calculateDistanceMap(start, _signal = {}, debug = CONFIG[MODULE_ID].debug) {
    this.#distanceMapStatus = this.constructor.STATUS.CALCULATING;
    this.buffers.read.unmap();

    if ( debug ) console.time("GPU Combine buffers");
    this.terrainMapper.combineTerrainBuffers();
    if ( debug ) console.timeEnd("GPU Combine buffers");

    if ( debug ) console.time("GPU Pathfinding Setup");
    this._wavefrontPropagation(start);
    if ( debug ) console.timeEnd("GPU Pathfinding Setup");

    if ( debug ) console.time("GPU Pathfinding Read Result");
    await this._readPropagationResult();
    if ( debug ) console.timeEnd("GPU Pathfinding Read Result");
    this.#distanceMapStatus = this.constructor.STATUS.READY;
  }

  _wavefrontPropagation(start) {
    // 1. Upload start index to the GPU
    const startIndex = this.terrainMapper.indexAtCanvas(start.x, start.y);
    const [width, height] = this.terrainMapper.gridDims;

    const workgroupX = Math.ceil(width / 8);
    const workgroupY = Math.ceil(height / 8);
    this.constructor.device.queue.writeBuffer(this.buffers.initUniform, 0, new Uint32Array([startIndex]));

    const commandEncoder = this.constructor.device.createCommandEncoder();

    // Initial Pass: Set buffers to Infinity and Start to 0.
    // TODO: Use distinct bind group here instead of A.
    const initPass = commandEncoder.beginComputePass();
    initPass.setPipeline(this.pipelines.init);
    initPass.setBindGroup(0, this.bindGroups.init);
    initPass.dispatchWorkgroups(workgroupX, workgroupY);
    initPass.end();

    // 3. Propagation Passes (Ping-Pong)
    // Iterate enough times to cover the map (Manhattan distance approx)
    // For a generic grid, Width + Height is a safe upper bound.
    // With diagonals, increase 150%.

    const iterations = Math.max(width, height) * 1.5;
    const propagationPass = commandEncoder.beginComputePass();
    propagationPass.setPipeline(this.pipelines.propagation);

    // NOTE: This assumes the propagation passes can act out-of-order.
    // If not, the compute pass must be called repeatedly within the loop.
    for ( let i = 0; i < iterations; i += 1 ) {
      // Swap bind groups every iteration
      const bindGroup = i % 2 === 0 ? this.bindGroups.A : this.bindGroups.B;
      propagationPass.setBindGroup(0, bindGroup);
      propagationPass.dispatchWorkgroups(workgroupX, workgroupY);
    }
    propagationPass.end();

    // Read Results
    // The final result is in Buffer A if iterations is even, Buffer B if odd.
    const finalBuffer = (iterations % 2 === 0) ? this.buffers.A : this.buffers.B;

    // Copy to read-back buffer
    commandEncoder.copyBufferToBuffer(finalBuffer, 0, this.buffers.read, 0, this.terrainMapper.area * 4);

    this.constructor.device.queue.submit([commandEncoder.finish()]);
  }

  /** @type {Uint32Array} */
  distanceMap;

  async _readPropagationResult() {
    await this.buffers.read.mapAsync(GPUMapMode.READ);
    this.distanceMap = new Uint32Array(this.buffers.read.getMappedRange());
    // Call this.buffers.read.unmap() elsewhere.
  }

  // ----- NOTE: Destroy ----- //

  destroy() {
    // Teardown the terrain mapper.
    if ( this.terrainMapper ) {
      this.terrainMapper.destroy();
      this.terrainMapper = null;
    }

    // Destroy internal pathfinding buffers.
    for ( const key in this.buffers ) {
      if ( this.buffers[key] ) {
        try { this.buffesr[key].unmap(); } catch(e) { /* Ignore if not mapped. */ } /* eslint-disable-line no-unused-vars */
        this.buffers[key].destroy();
        this.buffers[key] = null;
      }
    }

    // Clear the large distanceMap array from JS memory.
    this.distanceMap = null;
  }

  static destroy() {
    if ( this.device ) {
      this.device.destroy();
      this.device = null;
    }
  }

  // ----- NOTE: Find path ----- //

  async findPath(start, goal, _signal = {}) {
    if ( !this.distanceMapStatus === this.constructor.STATUS.NOT_READY ) {
      await this.calculateDistanceMap(start, _signal);
    }

    // TODO: Check start elevation and switch buffer data accordingly.

    return this.backtrackPath(goal, _signal);
  }

  backtrackPath({ x, y } = {}) {
    const local = this.terrainMapper.fromCanvasCoordinates(x, y);
    x = local.x;
    y = local.y;

    const distMap = this.distanceMap;
    let idx = this.terrainMapper.indexAtLocal(x, y);
    if ( distMap[idx] === 0xFFFFFFFF ) return new Uint16Array(); // No path found

    // Move from the end point along the lowest-cost neighbors back to start.
    const [width, height] = this.terrainMapper.gridDims;
    const area = this.terrainMapper.area;
    const path = [];
    const neighborOffsets = this.constructor.neighborOffsets;
    const currDistMapPosition = new Int16Array(2);
    currDistMapPosition[0] = x;
    currDistMapPosition[1] = y;
    path.push(x, y);
    let safety = 0; // Safety to break infinite loops in bad maps.
    while ( distMap[idx] !== 0 && safety < area ) {
      safety += 1;
      let bestX = null;
      let bestY = null;
      let lowestDist = distMap[idx]; // Starts with the current distance.
      for ( let i = 0; i < 16; i += 2 ) {
        // Check bounds.
        const nX = currDistMapPosition[0] + neighborOffsets[i];
        if ( nX < 0 || nX >= width ) continue;
        const nY = currDistMapPosition[1] + neighborOffsets[i + 1];
        if ( nY < 0 || nY >= height ) continue;

        // Get the cost for this neighbor.
        const nIdx = this.terrainMapper.indexAtLocal(nX, nY);
        const val = distMap[nIdx];

        // We just want to roll "downhill" to 0.
        // Any neighbor with a lower value is a valid step towards home.
        if ( val < lowestDist ) {
          lowestDist = val;
          bestX = nX;
          bestY = nY;
        }
      }
      if ( bestX === null ) break; // We got stuck. Shouldn't happen in valid wavefront.
      currDistMapPosition[0] = bestX;
      currDistMapPosition[1] = bestY;
      idx = this.terrainMapper.indexAtLocal(currDistMapPosition[0], currDistMapPosition[1]);
      path.push(bestX, bestY);
    }

    // Reverse the path, keeping x,y points in order.
    // Move to a Uint16Array to return.
    const out = new Uint16Array(path.length);
    for ( let i = path.length - 2, j = 0; i > -1; i -= 2 ) {
      const canvas = this.terrainMapper.toCanvasCoordinates(path[i], path[i + 1]);
      out[j++] = canvas.x;
      out[j++] = canvas.y;
    }
    return out;
  }

  /**
   * Helper for backtrackPath.
   * Stores the neighbor offsets.
   * @type {Int16Array[16]}
   */
  static neighborOffsets = new Int16Array(16);

  // ----- NOTE: WebGPU Setup ----- //

  /** @type {object<GPUPipeline>} */
  pipelines = {
    init: null,
    propagation: null,
  };

  pipeline = null;

  /** @type {GPUPipeline} */
  initPipeline = null;


  createPipeline() {
    const shaderModule = this.constructor.device.createShaderModule({
      code: this.constructor.shaderCode,
    });

    this.pipelines.init = this.constructor.device.createComputePipeline({
      layout: "auto",
      compute: { module: shaderModule, entryPoint: "init_dist" },
    });

    this.pipelines.propagation = this.constructor.device.createComputePipeline({
      layout: "auto",
      compute: { module: shaderModule, entryPoint: "main" },
    });
  }

  createMappedBuffer(data, usage) {
    const buffer = this.constructor.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  buffers = {
    terrain: null,
    uniform: null,
    initUniform: null,

    // For ping-pong.
    A: null,
    B: null,

    // Results.
    read: null,
  };

  bindGroups = {
    // For ping-pong.
    A: null,
    B: null,

    // For initializing the distance map buffers.
    init: null,
  };

  createBuffers() {
    this._createUniformBuffer();
    this._createDistanceBuffers();
    this._createReadBackBuffer();
    this.buffers.terrain = this.terrainMapper.buffers.combinedTerrain;
  }

  _createUniformBuffer() {
    const [width, height] = this.terrainMapper.gridDims;
    const uniformData = new Uint32Array([width, height]);
    this.buffers.uniform = this.createMappedBuffer(uniformData, GPUBufferUsage.UNIFORM);

    // Buffer for InitParams (startIndex)
    this.buffers.initUniform = this.constructor.device.createBuffer({
      size: Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  _createDistanceBuffers() {
    // Distance Buffers (Ping-Pong)
    // Initialize: Start Node = 0, Others = MAX_INT
    // Allocate memory here but no mapping; handled on the GPU.
    const size = this.terrainMapper.area * Uint32Array.BYTES_PER_ELEMENT;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.buffers.A = this.constructor.device.createBuffer({ size, usage });
    this.buffers.B = this.constructor.device.createBuffer({ size, usage });
  }

  _createReadBackBuffer() {
    this.buffers.read = this.constructor.device.createBuffer({
      size: this.terrainMapper.area * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
  }

  createBindGroups() {
    const buffers = this.buffers;

    // Group A: Reads A, Writes B
    this.bindGroups.A = this.createPropagationBindGroup(
      buffers.A,
      buffers.B,
      "propagationAB",
    );

    // Group B: Reads B, Writes A
    this.bindGroups.B = this.createPropagationBindGroup(
      buffers.B,
      buffers.A,
      "propagationBA",
    );

    this.bindGroups.init = this.constructor.device.createBindGroup({
      label: "init",
      layout: this.pipelines.init.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniform } },
        { binding: 2, resource: { buffer: this.buffers.A } },
        { binding: 3, resource: { buffer: this.buffers.B } },
        { binding: 4, resource: { buffer: this.buffers.initUniform } },
      ]
    });

  }

  createPropagationBindGroup(input, output, label = "propagation") {
    return this.constructor.device.createBindGroup({
      label,
      layout: this.pipelines.propagation.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniform } },
        { binding: 1, resource: { buffer: this.buffers.terrain } },
        { binding: 2, resource: { buffer: input } },
        { binding: 3, resource: { buffer: output } },
      ]
    });
  }

  static shaderCode = `
struct GridInfo { width: u32, height: u32 };
struct InitParams { startIndex: u32 };

const WALL = 255u;

@group(0) @binding(0) var<uniform> grid: GridInfo;

// terrainMap holds weights.
// e.g. 1 = Road, 5 = Grass, 255 = Wall
@group(0) @binding(1) var<storage, read> terrainMap: array<u32>;
@group(0) @binding(2) var<storage, read_write> inputDist: array<u32>;
@group(0) @binding(3) var<storage, read_write> outputDist: array<u32>;

// Params specifically for initialization
@group(0) @binding(4) var<uniform> initParams: InitParams;

/**
 * Get index for given local x, y location.
 */
fn get_idx(x: u32, y: u32) -> u32 { return y * grid.width + x; }

/**
 * Check if cell is a wall.
 * @returns True if wall, false if traversable.
 */
fn is_wall(x: u32, y: u32) -> bool { return terrainMap[get_idx(x, y)] >= WALL; }

@compute @workgroup_size(8, 8)
fn init_dist(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x;
  let y = id.y;

  // Boundary check for the 2d grid.
  if ( x >= grid.width || y >= grid.height ) { return; }
  let idx = get_idx(x, y);

  // Set each pixel of the distance map buffers to infinity except for the starting index.
  var val = 0xFFFFFFFFu;
  if ( idx == initParams.startIndex ) { val = 0u; }
  inputDist[idx] = val;
  outputDist[idx] = val;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let x = id.x;
    let y = id.y;

    // Boundary check for the 2d grid.
    if ( x >= grid.width || y >= grid.height ) { return; }
    let idx = get_idx(x, y);

    // Wall check.
    // Note 0xFFFFFFFFu represents infinity internally.
    let tileCost = terrainMap[idx];
    if ( tileCost >= WALL ) {
      outputDist[idx] = 0xFFFFFFFFu;
      return;
    }

    let current = inputDist[idx];
    var best = 0xFFFFFFFFu;

    // Base Movement Costs (Scaled up to keep integer precision)
    // We multiply the base movement (10/14) by the tile's weight.
    // Example: Road(1) -> Straight=10. Swamp(5) -> Straight=50.
    let COST_STRAIGHT = 10u * tileCost;
    let COST_DIAGONAL = 14u * tileCost;
    let MAX_VAL = 0xFFFFFFFFu;

    // ----- Check straight neighbors (cost 10) ----- //
    // Left
    if ( x > 0u ) {
        let v = inputDist[get_idx(x - 1u, y)];
        if (v != MAX_VAL) { best = min(best, v + COST_STRAIGHT); }
    }

    // Right
    if ( x < grid.width - 1u ) {
        let v = inputDist[get_idx(x + 1u, y)];
        if (v != MAX_VAL) { best = min(best, v + COST_STRAIGHT); }
    }

    // Up
    if ( y > 0u ) {
        let v = inputDist[get_idx(x, y - 1u)];
        if (v != MAX_VAL) { best = min(best, v + COST_STRAIGHT); }
    }

    // Down
    if ( y < grid.height - 1u ) {
        let v = inputDist[get_idx(x, y + 1u)];
        if (v != MAX_VAL) { best = min(best, v + COST_STRAIGHT); }
    }

    // --- Check Diagonal Neighbors (Cost 14) ---
    // A diagonal move is only valid if we are not cutting a corner.
    // E.g., to move (x - 1, y - 1), both (x - 1, y) and (x, y - 1) must not be walls.
    // Prevents clipping wall endpoints.

    // Top-Left
    if ( x > 0u && y > 0u && !is_wall(x - 1u, y) && !is_wall(x, y - 1u) ) {
        let v = inputDist[get_idx(x - 1u, y - 1u)];
        if (v != MAX_VAL) { best = min(best, v + COST_DIAGONAL); }
    }

    // Top-Right
    if ( x < grid.width - 1u && y > 0u && !is_wall(x + 1u, y) && !is_wall(x, y - 1u) ) {
        let v = inputDist[get_idx(x + 1u, y - 1u)];
        if (v != MAX_VAL) { best = min(best, v + COST_DIAGONAL); }
    }

    // Bottom-Left
    if ( x > 0u && y < grid.height - 1u && !is_wall(x - 1u, y) && !is_wall(x, y + 1u) ) {
        let v = inputDist[get_idx(x - 1u, y + 1u)];
        if (v != MAX_VAL) { best = min(best, v + COST_DIAGONAL); }
    }

    // Bottom-Right
    if ( x < grid.width - 1u && y < grid.height - 1u && !is_wall(x + 1u, y) && !is_wall(x, y + 1u) ) {
        let v = inputDist[get_idx(x + 1u, y + 1u)];
        if (v != MAX_VAL) { best = min(best, v + COST_DIAGONAL); }
    }

    // Update
    if ( best != MAX_VAL ) {
      outputDist[idx] = min(current, best);
    } else {
      outputDist[idx] = current;
    }
}
`;
}

(() => {
  let i = 0;
  for ( let x = -1; x < 2; x += 1 ) {
    for ( let y = -1; y < 2; y += 1 ) {
      if ( !(x || y) ) continue; // Skip 0,0.
      GPUPathfinder.neighborOffsets[i++] = x;
      GPUPathfinder.neighborOffsets[i++] = y;
    }
  }
})();


/**
 * Test using the GPU to write the terrain map.
 * Draw segments for the walls and flat triangles for everything else.
 */
export class GPUTerrainMap {

  /** @type {GPUDevice} */
  device;

  /**
   * @type {Float32Array[6]}
   * @prop {Point} sceneDims
   * @prop {Point} gridDims
   * @prop {Point} sceneTranslation
   */
  uniforms = new Float32Array(6);

  constructor(sceneWidth, sceneHeight, device, { translationX = 0, translationY = 0, resolution = 1 } = {}) {
    const gridWidth = Math.ceil(sceneWidth * resolution);
    const gridHeight = Math.ceil(sceneHeight * resolution);
    this.uniforms.set([sceneWidth, sceneHeight, gridWidth, gridHeight, translationX, translationY]);
    this.device = device;
    this.#resolution = resolution;
  }

  /** @type {Float32Array[2]} */
  get sceneDims() { return this.uniforms.slice(0, 2); }

  /** @type {Float32Array[2]} */
  get gridDims() { return this.uniforms.slice(2, 4); }

  /** @type {Float32Array[2]} */
  get sceneTranslation() { return this.uniforms.slice(4, 6); }

  #resolution = 1;

  get resolution() { return this.#resolution; }

  get area() {
    const [width, height] = this.gridDims;
    return width * height;
  }

  // ----- NOTE: Indexing ----- //

  indexAtLocal(x, y) {
    // Use floor to determine in which "pixel bucket" the coordinate lies.
    x = ~~x;
    y = ~~y;

    // Bounds check.
    if ( x < 0 || y < 0 ) return -1;
    const [width, height] = this.gridDims;
    if ( x >= width || y >= height ) return -1;

    // Return the index.
    return (y * width) + x;
  }

  indexAtCanvas(x, y) {
    const local = this.fromCanvasCoordinates(x, y);
    return this.indexAtLocal(local.x, local.y);
  }

  fromCanvasCoordinates(x, y) {
    const [trX, trY] = this.sceneTranslation;
    const res = this.resolution;
    x = (x - trX) * res;
    y = (y - trY) * res;
    return { x, y };
  }

  toCanvasCoordinates(x, y) {
    const [trX, trY] = this.sceneTranslation;
    const invRes = 1 / this.resolution;
    x = fastFixed((x * invRes) + trX);
    y = fastFixed((y * invRes) + trY);
    return { x, y };
  }

  // ----- NOTE: Buffers ----- //

  /* Buffers
  Static: Walls or other obstacles that do not move often and are not token-specific.
  Subject: Token-specific difficult terrain, like regions, that do not move often.
  Transient: Doors and token walls or token-based difficult terrain. Subject token specific or moves often.
  */

  /** @type {object<WebGPUBuffer>} */
  buffers = {
    uniform: null,
    staticTerrain: null,
    subjectTerrain: null,
    transientTerrain: null,
    combinedTerrain: null,
    staging: null,
  };

  /** @type {object<WebGPUPipeline} */
  pipelines = {
    segments: null,
    points: null,
    openSegments: null,
    openPoints: null,
    triangles: null,
    combine: null,
  };

  /** @type {object<WebGPUBindGroup} */
  bindGroups = {
    staticWalls: null,
    staticOpenDoors: null,
    staticWallsPoints: null,
    staticOpenDoorsPoints: null,
    staticTerrain: null,
    subjectWalls: null,
    subjectWallsPoints: null,
    subjectTerrain: null,
    transientWalls: null,
    transientWallsPoints: null,
    transientTerrain: null,
    combine: null,
  };

  /** @type {WebGPUTexture} */
  dummyTexture;

  async initialize() {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const device = this.device;
    this.createBuffers();
    this.createPipelines();
    this.createBindGroups();

    // Create dummy texture.
    // This defines the coordinate space for the rasterizer.
    const gridDims = this.gridDims;
    this.dummyTexture = device.createTexture({
      label: "dummy raster attachment",
      size: [gridDims[0], gridDims[1]],
      format, // Match the format used in the pipeline targets
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  createBuffers() {
    const { device, buffers } = this;

    // 0. Uniform buffer.
    const uniformData = this.uniforms;
    buffers.uniform = device.createBuffer({
      label: "uniform",
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffers.uniform, 0, uniformData);

    // 1. Storage buffer. (The terrain map on the GPU, scaled by resolution.)
    const gridDims = this.gridDims;
    const size = gridDims[0] * gridDims[1] * Uint32Array.BYTES_PER_ELEMENT;
    buffers.staticTerrain = device.createBuffer({
      label: "staticTerrain",
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    buffers.subjectTerrain = device.createBuffer({
      label: "subjectTerrain",
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    buffers.transientTerrain = device.createBuffer({
      label: "transientTerrain",
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    buffers.combinedTerrain = device.createBuffer({
      label: "combinedTerrain",
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    // 2. Staging buffer, scaled by resolution.
    buffers.staging = device.createBuffer({
      label: "staging",
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
  }

  createPipelines() {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const { device, pipelines } = this;
    const shaderModule = device.createShaderModule({
      code: this.constructor.shaderCode,
    });

    const vertex = {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [{
        arrayStride: Float32Array.BYTES_PER_ELEMENT * 2, // 2 floats (x, y) * 4 bytes
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }]
      }]
    };

    const fragmentWall = {
      module: shaderModule,
      entryPoint: "fs_wall",
      targets: [{
        format,
        writeMask: 0, // IMPORTANT: Do not write to the dummy texture.
      }]
    };

    const fragmentOpenDoor = {
      module: shaderModule,
      entryPoint: "fs_open_door",
      targets: [{
        format,
        writeMask: 0, // IMPORTANT: Do not write to the dummy texture.
      }]
    };

    const fragmentDifficultTerrain = {
      module: shaderModule,
      entryPoint: "fs_difficult_terrain",
      targets: [{
        format,
        writeMask: 0, // IMPORTANT: Do not write to the dummy texture.
      }]
    };

    pipelines.segments = device.createRenderPipeline({
      label: "segment",
      layout: "auto",
      vertex,
      fragment: fragmentWall,
      primitive: { topology: "line-list" },
    });

    // Draw the segment buffer twice; once as points and once as line list to ensure
    // wall endpoints are filled in.
    pipelines.points = device.createRenderPipeline({
      label: "points",
      layout: "auto",
      vertex,
      fragment: fragmentWall,
      primitive: { topology: "point-list" },
    });

    pipelines.openSegments = device.createRenderPipeline({
      label: "open segment",
      layout: "auto",
      vertex,
      fragment: fragmentOpenDoor,
      primitive: { topology: "line-list" },
    });

    pipelines.openPoints = device.createRenderPipeline({
      label: "open points",
      layout: "auto",
      vertex,
      fragment: fragmentWall,
      primitive: { topology: "point-list" },
    });

    pipelines.triangles = device.createRenderPipeline({
      label: "triangle",
      layout: "auto",
      vertex,
      fragment: fragmentDifficultTerrain,
      primitive: { topology: "triangle-list" },
    });

    pipelines.combine = device.createComputePipeline({
      label: "Combine Terrains",
      layout: "auto",
      compute: {
        module: shaderModule,
        entryPoint: "cs_combine",
      },
    });
  }

  createBindGroups() {
    const { device, buffers, pipelines, bindGroups } = this;

    bindGroups.staticWalls = device.createBindGroup({
      label: "staticWalls",
      layout: pipelines.segments.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.staticTerrain } },
      ]
    });

    bindGroups.staticOpenDoors = device.createBindGroup({
      label: "staticOpenDoors",
      layout: pipelines.openSegments.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.staticTerrain } },
      ]
    });

    bindGroups.staticWallsPoints = device.createBindGroup({
      label: "staticWallsPoints",
      layout: pipelines.points.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.staticTerrain } },
      ]
    });

    bindGroups.staticOpenDoorsPoints = device.createBindGroup({
      label: "staticOpenDoorsPoints",
      layout: pipelines.openPoints.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.staticTerrain } },
      ]
    });

    bindGroups.staticTerrain = device.createBindGroup({
      label: "staticTerrain",
      layout: pipelines.triangles.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.staticTerrain } },
      ]
    });

    bindGroups.subjectWalls = device.createBindGroup({
      label: "subjectWalls",
      layout: pipelines.segments.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.subjectTerrain } },
      ]
    });

    bindGroups.subjectWallsPoints = device.createBindGroup({
      label: "subjectWallsPoints",
      layout: pipelines.points.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.subjectTerrain } },
      ]
    });

    bindGroups.subjectTerrain = device.createBindGroup({
      label: "subjectTerrain",
      layout: pipelines.triangles.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.subjectTerrain } },
      ]
    });

    bindGroups.transientWalls = device.createBindGroup({
      label: "transientWalls",
      layout: pipelines.segments.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.transientTerrain } },
      ]
    });

    bindGroups.transientWallsPoints = device.createBindGroup({
      label: "transientWallsPoints",
      layout: pipelines.points.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.transientTerrain } },
      ]
    });

    bindGroups.transientTerrain = device.createBindGroup({
      label: "transientTerrain",
      layout: pipelines.triangles.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.transientTerrain } },
      ]
    });

    bindGroups.combine = device.createBindGroup({
      label: "Combine Terrains",
      layout: pipelines.combine.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 2, resource: { buffer: buffers.staticTerrain } },
        { binding: 3, resource: { buffer: buffers.subjectTerrain } },
        { binding: 4, resource: { buffer: buffers.transientTerrain } },
        { binding: 5, resource: { buffer: buffers.combinedTerrain } },
      ],
    });
  }

  /**
   * Resets all values in the terrain storage buffer to 0.
   * TODO: Is this needed or can we just trigger clearing on processing?
   * Probably need to clear if no obstacles/difficult terrain to process.
   */
  clearTerrainMap(bufferType = "transient") {
    const buffer = this.buffers[`${bufferType}Terrain`];

    // Faster than recreating the buffer.
    const device = this.device;
    const commandEncoder = device.createCommandEncoder({ label: "Clear Terrain Encoder" });

    // Zero out the entire storage buffer
    commandEncoder.clearBuffer(buffer);

    // TODO: Faster to do in a single queue
    device.queue.submit([commandEncoder.finish()]);
  }

  /** Helper to create vertex buffers */
  _createMappedBuffer(data, usage) {
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  /** Helper to create index buffers */
  _createIndexBuffer(data) {
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true,
    });
    // Indices must be Uint32 or Uint16
    new Uint16Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  /**
   * Process blocking segments on the GPU.
   * The chosen terrain buffer will have pixels under each segment set to block.
   * @param {Segment[]} segments
   * @param {object} opts
   * - @prop {"static"|"subject"|"transient"} bufferType
   * - @prop {boolean} clear                                If true, clears the buffer first
   */
  processBlockingSegments(segmentArr, { bufferType = "transient", openDoors = false, clear = true } = {}) {
    const device = this.device;
    const commandEncoder = device.createCommandEncoder();
    const buffer = this.buffers[`${bufferType}Terrain`];

    let pipeline = { segments: null, points: null };
    let bindGroup = { segments: null, points: null };
    if ( openDoors ) {
      pipeline.segments = this.pipelines.openSegments;
      pipeline.points = this.pipelines.openPoints;
      bindGroup.segments = this.bindGroups.staticOpenDoors;
      bindGroup.points = this.bindGroups.staticOpenDoorsPoints;
    } else {
      pipeline.segments = this.pipelines.segments;
      pipeline.points = this.pipelines.points;
      bindGroup.segments = this.bindGroups[`${bufferType}Walls`];
      bindGroup.points = this.bindGroups[`${bufferType}WallsPoints`];
    }

    // Clear map before drawing.
    if ( clear ) commandEncoder.clearBuffer(buffer);

    // Send the segment vertices to the GPU.
    const vertexBuffer = this._createMappedBuffer(segmentArr, GPUBufferUsage.VERTEX);

    // Process the segments on the GPU.
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.dummyTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "discard", // We don't care about saving the pixel colors.
      }] // No visual output needed; dummy texture used.
    });

    // Draw the lines (fills gaps between endpoints).
    const vertexCount = segmentArr.length / 2; // 2 floats per vertex
    renderPass.setPipeline(pipeline.segments);
    renderPass.setBindGroup(0, bindGroup.segments);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.draw(vertexCount);

    // Draw the points (ensure endpoints are filled). Minimal overhead to draw both.
    renderPass.setPipeline(pipeline.points);
    renderPass.setBindGroup(0, bindGroup.points);
    renderPass.draw(vertexCount);

    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Extract a specific buffer to a typed array for debug inspection.
   * @param {"transient"|"static"|"subject"} [bufferType="transient"]
   * @param {Float32Array} [out]
   * @returns {Float32Array} The out array or a new array
   */
  async extractBufferData(bufferType = "transient", out) { /* eslint-disable-line default-param-last */
    const device = this.device;
    const buffer = this.buffers[`${bufferType}Terrain`];
    const commandEncoder = device.createCommandEncoder();

    // Copy result from Storage -> Staging
    commandEncoder.copyBufferToBuffer(
      buffer, 0,
      this.buffers.staging, 0,
      this.area * Uint32Array.BYTES_PER_ELEMENT,
    );
    device.queue.submit([commandEncoder.finish()]);

    await this.buffers.staging.mapAsync(GPUMapMode.READ);
    const terrainBufferView = new Uint32Array(this.buffers.staging.getMappedRange());
    out ??= new Uint32Array(terrainBufferView.length);
    out.set(terrainBufferView);
    this.buffers.staging.unmap();
    return out;
  }

  /**
   * Process terrain triangles on the GPU.
   * The pixels under the triangles will be multiplied by 2 for the difficulty.
   * @param {VertexObject} triVO
   * @param {object} opts
   * - @prop {"static"|"subject"|"transient"} bufferType
   * - @prop {boolean} clear                                If true, clears the buffer first
   */
  processTerrainTriangles(vertices, indices, { bufferType = "transient", clear = true } = {}) {
    const device = this.device;
    const commandEncoder = device.createCommandEncoder();
    const bindGroup = this.bindGroups[`${bufferType}Terrain`];
    const buffer = this.buffers[`${bufferType}Terrain`];

    // Clear map before drawing.
    if ( clear ) commandEncoder.clearBuffer(buffer);

    // Send the triangle vertices and indices to the GPU.
    const vBuf = this._createMappedBuffer(vertices, GPUBufferUsage.VERTEX);
    const iBuf = this._createIndexBuffer(indices);

    // Render to the selected buffer.
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.dummyTexture.createView(),
        loadOp: "clear",
        storeOp: "discard",
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
      }]
    });
    renderPass.setPipeline(this.pipelines.triangles);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.setVertexBuffer(0, vBuf);
    renderPass.setIndexBuffer(iBuf, "uint16"); // Or uint32
    renderPass.drawIndexed(indices.length);
    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Sums the static and subject buffers into the transient buffer.
   * Ensures every pixel has a minimum value of 1.
   */
  combineTerrainBuffers() {
    const device = this.device;
    const commandEncoder = device.createCommandEncoder({ label: "Combine Terrains" });

    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.pipelines.combine);
    passEncoder.setBindGroup(0, this.bindGroups.combine);

    // Dispatch workgroups. We use 64 as the workgroup size (defined in shader).
    const gridDims = this.gridDims;
    const workgroupCountX = Math.ceil(gridDims[0] / 8);
    const workgroupCountY = Math.ceil(gridDims[1] / 8);
    passEncoder.dispatchWorkgroups(workgroupCountX, workgroupCountY);
    passEncoder.end();
    device.queue.submit([commandEncoder.finish()]);
  }

  // ----- NOTE: Destroy ----- //

  destroy() {
    // Destroy all GPU buffers.
    for ( const key in this.buffers ) {
      if ( this.buffers[key] ) {
        this.buffers[key].destroy();
        this.buffers[key] = null;
      }
    }

    // Destroy the dummy texture.
    if ( this.dummyTexture ) {
      this.dummyTexture.destroy();
      this.dummyTexture = null;
    }

    // Clear references to pipelines and bind groups to trigger GC.
    this.pipelines = {};
    this.bindGroups = {};
    this.device = null;
  }

  // ----- NOTE: Shader code ----- //


  static shaderCode = `

struct Uniforms {
  sceneRes: vec2<f32>,
  gridRes: vec2<f32>,
  translation: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
};


@group(0) @binding(0) var<uniform> config: Uniforms;
@group(0) @binding(1) var<storage, read_write> terrainMap: array<atomic<u32>>;

@group(0) @binding(2) var<storage, read> staticMap: array<u32>;
@group(0) @binding(3) var<storage, read> subjectMap: array<u32>;
@group(0) @binding(4) var<storage, read_write> transientMap: array<u32>;
@group(0) @binding(5) var<storage, read_write> combinedMap: array<u32>;

fn get_idx(x: u32, y: u32) -> u32 { return y * u32(config.gridRes.x) + x; }

@vertex
fn vs_main(@location(0) pos: vec2<f32>) -> VertexOutput {
  var out: VertexOutput;

  // Apply 0.5 offset to target pixel centers.
  // This moves the coordinate from the "edge" of the pixel to its "middle."
  // This fixes the bottom-right off-by-one shift.
  let adjustedPos = pos + 0.5;

  // Transform to NDC.
  // Formula: (((pos - translation) * sceneRes) * 2.0) - 1.0
  let ndc = (((adjustedPos - config.translation) / config.sceneRes) * 2.0) - 1.0;

  // WebGPU NDC y-axis points UP, but Foundry/canvas y points DOWN.
  // Negate y result to flip it.
  out.pos = vec4<f32>(ndc.x, -ndc.y, 0.0, 1.0);
  return out;
}

const WALL: u32 = 255u;
const OPEN_DOOR: u32 = 0u;

@fragment
fn fs_wall(@builtin(position) fragPos: vec4<f32>) {
  // fragPos is in the coordinate space of the attachment (the dummy texture).
  // Since the dummy texture is sized to gridRes, these are already grid coords.
  let x = u32(fragPos.x);
  let y = u32(fragPos.y);
  let idx = get_idx(x, y);

  // Safety check to prevent out-of-bounds if floating point error occurs
  // TODO: Is atomic necessary here? We are not incrementing for walls.
  if ( idx < arrayLength(&terrainMap) ) { atomicStore(&terrainMap[idx], WALL); }
}

@fragment
fn fs_open_door(@builtin(position) fragPos: vec4<f32>) {
  // fragPos is in the coordinate space of the attachment (the dummy texture).
  // Since the dummy texture is sized to gridRes, these are already grid coords.
  let x = u32(fragPos.x);
  let y = u32(fragPos.y);
  let idx = get_idx(x, y);

  // Safety check to prevent out-of-bounds if floating point error occurs
  // TODO: Is atomic necessary here? We are not incrementing for walls.
  if ( idx < arrayLength(&terrainMap) ) { atomicStore(&terrainMap[idx], OPEN_DOOR); }
}

fn updateTerrainValue(idx: u32) {
  // Initial read of the current value.
  let oldValue = atomicLoad(&terrainMap[idx]);
  atomicStore(&terrainMap[idx], max(oldValue, 1u) * 2u);

  // Enter a loop to ensure the update eventually succeeds.
  /*
  loop {
    var newValue: u32;

    // Try to set the new value.
    // if ( oldValue == 0u ) { newValue = 2u; }
    // else { newValue = oldValue * 2u; }
    newValue = max(oldValue, 2u);

    // Attempt to swap.
    let res = atomicCompareExchangeWeak(&terrainMap[idx], oldValue, newValue);
    if ( res.exchanged ) { break; }
  }
  */

}

@fragment
fn fs_difficult_terrain(@builtin(position) fragPos: vec4<f32>) {
  // fragPos is in the coordinate space of the attachment (the dummy texture).
  // Since the dummy texture is sized to gridRes, these are already grid coords.
  let x = u32(fragPos.x);
  let y = u32(fragPos.y);
  let idx = get_idx(x, y);

  // Safety check to prevent out-of-bounds if floating point error occurs
  if ( idx < arrayLength(&terrainMap) ) {
    // Set terrain to 2 (double it). If 2+, multiply by 2.
    // TODO: Is atomic necessary here? Multiple fragments should not overlap.
    updateTerrainValue(idx);
  }
}

@compute @workgroup_size(8, 8, 1)
fn cs_combine(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x;
  let y = id.y;
  let totalPixels = arrayLength(&combinedMap);

  // Boundary check.
  let width = u32(config.gridRes.x);
  let height = u32(config.gridRes.y);
  if ( x >= width || y >= height ) { return; }

  // Linear index for the pixel.
  let idx = (y * width) + x;

  // 1. Sum corresponding pixels.
  var result = staticMap[idx] + subjectMap[idx] + transientMap[idx];

  // 2. Set the minimum pixel value to 1.
  result = max(result, 1u);
  combinedMap[idx] = result;
}
`;
}

/**
 * Fix a number to 8 decimal places
 * @param {number} x    Number to fix
 * @returns {number}
 */
const POW10_8 = Math.pow(10, 8);
function fastFixed(x) { return Math.round(x * POW10_8) / POW10_8; }


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
pf.terrain.staticTerrain.draw({ maximumPixelValue: 255, local: true, skip: 5, colorFn, alphaFn })
pf.terrain.transientTerrain.draw({ maximumPixelValue: 255, local: true, skip: 5, colorFn, alphaFn })

pf.terrain.staticTerrain.draw({ maximumPixelValue: 255, local: false, skip: 5, colorFn, alphaFn })
pf.terrain.transientTerrain.draw({ maximumPixelValue: 255, local: false, skip: 5, colorFn, alphaFn })

*/

/* Test pathfinding
PixelCache = CONFIG.GeometryLib.lib.PixelCache
Draw = CONFIG.GeometryLib.lib.Draw
GridCoordinates3d = CONFIG.GeometryLib.lib.threeD.GridCoordinates3d
api = game.modules.get("elevationruler").api
WebGPUPathfinder = api.pathfinding.WebGPUPathfinder
await WebGPUPathfinder.initializeDevice();

let randal = canvas.tokens.placeables.find(t => t.name === "Randal")
let zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")

start = GridCoordinates3d.fromObject(randal.center)
end = GridCoordinates3d.fromObject(zanna.center)

pf = new WebGPUPathfinder(randal, 1);
await pf.initialize()
await pf.calculateDistanceMap(start)
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


/**
 * Get unique array values and sort low-to-high.
 * @param {TypedArray} arr
 * @returns {number[]}
 */
function sortedUnique(arr) {
  const s = new Set(arr);
  const out = [...s];
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Histogram using map
 * @param {TypedArray} arr
 * @returns {Map<number, number>} Number and total count for each
 */
function histogram(arr) {
  const s = new Set(arr);
  const m = new Map();
  for ( const n of s ) m.set(n, 0);
  for ( const n of arr ) m.set(n, m.get(n) + 1);
  return m;
}

/**
 * Creates a function that maps a value to a color between blue and red.
 *
 * @param {number} min - The minimum value of the range (Blue/Cold).
 * @param {number} max - The maximum value of the range (Red/Hot).
 * @returns {function(number): number} - A function that accepts a value and returns a PIXI-compatible Hex integer.
 */
function createHeatMap(min, max) {
  return function(value) {
    // 1. Normalize the value to a 0-1 range
    // Clamp the value to ensure it stays within the min/max bounds
    const clampedValue = Math.max(min, Math.min(max, value));

    // Calculate ratio (0 = min, 1 = max)
    const ratio = (clampedValue - min) / (max - min);

    // 2. Map ratio to Hue
    // Blue is 240°, Red is 0°.
    // We want to go from 240 down to 0 based on the ratio.
    const hue = (1 - ratio) * 240;

    // 3. Convert HSL to RGB
    // Using standard saturation (100%) and lightness (50%) for vibrant colors
    const saturation = 100;
    const lightness = 50;

    return hslToHex(hue, saturation, lightness);
  };
}

/**
 * Helper: Converts HSL values to a PIXI-friendly Hex Integer.
 * * @param {number} h - Hue (0-360)
 * @param {number} s - Saturation (0-100)
 * @param {number} l - Lightness (0-100)
 * @returns {number} - Hex integer (e.g., 0xFF0000)
 */
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;

  const k = n => (n + (h / 30)) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n =>
    l - (a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));

  // Calculate RGB components (0-255)
  const r = Math.round(255 * f(0));
  const g = Math.round(255 * f(8));
  const b = Math.round(255 * f(4));

  // Combine bitwise into a single integer
  return (r << 16) + (g << 8) + b;
}

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
WebGPUPathfinderWithWorker = api.pathfinding.WebGPUPathfinderWithWorker

let randal = canvas.tokens.placeables.find(t => t.name === "Randal")
let zanna = canvas.tokens.placeables.find(t => t.name === "Zanna")

start = GridCoordinates3d.fromObject(randal.center)
end = GridCoordinates3d.fromObject(zanna.center)

await WebGPUPathfinder.initialize(1);
await WebGPUPathfinderWithWorker.initialize(1);

pf = new WebGPUPathfinder(randal);
pf = new WebGPUPathfinderWithWorker(randal)
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
terrain = Terrain.fromPixelArray(bufferData, pf.constructor.worker.gridDims.x, { resolution: pf.constructor.worker.resolution })
terrain.translation = pf.constructor.worker.sceneTranslation
terrain.draw({ skip: 20, local: false })

bufferData[pf.constructor.worker.pf.terrainMapper.indexAtCanvas(1997, 2699)]


// Change the resolution of the worker
WebGPUPathfinderWithWorker.worker.resolution
await WebGPUPathfinderWithWorker.destroy()
await WebGPUPathfinderWithWorker.initialize(2/100)



worker = WebGPUPathfinderWithWorker.worker
await worker.destroy();
await worker.initialize(2/100)
WebGPUPathfinderWithWorker.currentElevationZ = null
WebGPUPathfinderWithWorker.currentTokenId = ""

await WebGPUPathfinderWithWorker.updateStaticTerrain();


*/

/*
idleCallBackTest = function(idleDeadline) {
  console.debug(`${idleDeadline.timeRemaining()}, ${idleDeadline.timeout}`);
  requestIdleCallback(idleCallBackTest)
}

requestIdleCallback(idleCallBackTest)
*/
