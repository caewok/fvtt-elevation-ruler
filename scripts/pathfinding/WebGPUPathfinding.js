/* globals
canvas,
CONFIG,
CONST,
game,
GPUMapMode,
GPUBufferUsage,
Hooks,
PIXI,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractPathfinder } from "./AbstractPathfinder.js";
import { PixelCache } from "../geometry/PixelCache.js";
import { GEOMETRY_LIB_ID, GEOMETRY_ID } from "../geometry/const.js";
import { Settings } from "../settings.js";
import { Draw } from "../geometry/Draw.js";

// TODO: import { FastBitSet } from "../FastBitSet/FastBitSet.js";

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

  get resolution() { return this.scale.resolution; }

  get size() { return this.pixels.length; } // Or this.area.

  /**
   * @param {object} [opts]
   * @param {number} [opts.resolution=1]
   * @param {CONST.WALL_RESTRICTION_TYPES} [opts.senseType="move"]
   * @param {number} [opts.elevationZ = 0]
   * @returns {PixelCache<Uint32Array}
   */
  constructor(pixels, pixelWidth, { senseType = "move", elevationZ = 0, ...opts} = {}) {
    super(pixels, pixelWidth, opts);
    this.#senseType = senseType;
    this.#elevationZ = elevationZ;
  }

  static create({ resolution = 1, senseType = "move", elevationZ = 0 } = {}) {
    const sceneRect = canvas.scene.dimensions.sceneRect;
    const scale = {
      resolution,
      x: sceneRect.x,
      y: sceneRect.y,
    };
    const localWidth = Math.ceil(sceneRect.width * resolution);
    const localHeight = Math.ceil(sceneRect.height * resolution);
    const N = localWidth * localHeight;
    const out = new this(new Uint32Array(N), localWidth, { scale, senseType, elevationZ });
    out.pixels.fill(this.FEATURES.CLEAR);
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

/**
 * Hook canvas load to wipe the data map.
 */
Hooks.on("canvasReady", function() {
  WebGPUPathfinder.staticTerrainMap.clear();
});

export class WebGPUPathfinder extends AbstractPathfinder {

  // ----- NOTE: Terrain handling ----- //
  /**
   * Map of static terrain data for different elevations and sense types.
   * @type {Map<string, Terrain}
   */
  static staticTerrainMap = new Map();

  /**
   * Retrieve the static terrain for given parameters.
   * Create a new one if none yet present.
   * @param {object} opts
   * @param {number} opts.resolution
   * @param {CONST.WALL_RESTRICTION_TYPES} opts.senseType
   * @param {number} opts.elevationZ
   * @returns {PixelCache<Uint32Array}
   */
  static getStaticTerrain({ resolution = 1, senseType = "move", elevationZ = 0 } = {}) {
    const key = `${elevationZ}_${senseType}_${resolution}`;
    if ( this.staticTerrainMap.has(key) ) return this.staticTerrainMap.get(key);

    // Build new cache.
    const data = Terrain.create({ resolution, senseType, elevationZ });
    this.staticTerrainMap.set(key, data);
    return data;
  }

  /** @type {Terrain} */
  staticTerrain;

  /** @type {Terrain} */
  tokenTerrain;     // Token-specific, such as region difficulty.

  /** @type {Terrain} */
  transientTerrain; // Transient terrain, such as tokens and doors

  /** @type {Terrain} */
  combinedTerrain; // Combined static + token + transient. TODO: Copy directly to the WebGPU buffer for this instead of allocating.

  /** @type {number} */
  #resolution = 1;

  get resolution() { return this.#resolution; }

  #senseType = "move";

  get senseType() { return this.#senseType; }

  initializeTerrain() {
    const opts = { resolution: this.resolution, senseType: this.senseType, elevationZ: this.token.bottomZ };
    this.staticTerrain = this.constructor.getStaticTerrain(opts);
    this.tokenTerrain = this.staticTerrain.clone();
    this.transientTerrain = this.staticTerrain.clone();
    this.tokenTerrain.clear();
    this.transientTerrain.clear();

    // TODO: Copy directly to the WebGPU buffer for this instead of allocating.
    this.combinedTerrain = this.staticTerrain.clone();
    this.combinedTerrain.clear();
  }

  updateStaticTerrain() {
    const terrain = this.staticTerrain;
    terrain.clear();
    terrain.updateWalls();
  }

  updateTokenTerrain() {
    const terrain = this.tokenTerrain;
    terrain.clear();
    terrain.updateRegions(this.token);
  }

  updateTransientTerrain() {
    const terrain = this.transientTerrain;
    terrain.clear();
    terrain.updateDoors();
    terrain.updateTokens(this.token);
  }

  updateCombinedTerrain() {
    const { staticTerrain, tokenTerrain, transientTerrain, combinedTerrain } = this;
    for ( let i = 0, iMax = staticTerrain.size; i < iMax; i += 1 ) {
      // No need to use Math.min to keep under 256 so long as the typed array does not wrap.
      // Must set normal terrain to 1. Otherwise, the initial start marked as 0 will fail.
      combinedTerrain.pixels[i] = (staticTerrain.pixels[i] + tokenTerrain.pixels[i] + transientTerrain.pixels[i]) || 1;
    }
  }

  // ----- NOTE: Constructor ----- //

  constructor(token, resolution = 1) {
    super(token);
    if ( !this.constructor.device ) throw new Error(`${this.constructor.name}|webGPU device not initialized.`);
    this.#resolution = resolution;
  }

  // ----- NOTE: Initialize ----- //

  async initializeWebGPU() {
    this.initializeTerrain();

    // TODO: Postpone terrain updating and subsequent buffer updating.
    this.updateStaticTerrain();
    this.updateTokenTerrain();
    this.updateTransientTerrain();
    this.updateCombinedTerrain();

    this.createPipeline();
    this.createBuffers();
    this._createBindGroups();
  }

  /* Needed?
  initialize() {

  }

  async updateScene() {

  }
  */

  /** @type {boolean} */
  #distanceMapReady = false;

  get distanceMapReady() { return this.#distanceMapReady; }

  async calculateDistanceMap(start, _signal = {}) {
    this.#distanceMapReady = false;
    this.buffers.read.unmap();

    console.time("GPU Terrain Buffer Update");
    this.updateTerrainBuffer();
    console.timeEnd("GPU Terrain Buffer Update");

    console.time("GPU Pathfinding Setup");
    this._wavefrontPropagation(start);
    console.timeEnd("GPU Pathfinding Setup");
    console.time("GPU Pathfinding");
    await this._readResult();
    console.timeEnd("GPU Pathfinding");
    this.#distanceMapReady = true;
  }

  async findPath(start, goal, signal) {
    // Skip caching if distance map not yet prepared.
    if ( !this.distanceMapReady ) return null;
    return super.findPath(start, goal, signal);
  }

  async _findPath(_start, goal, _signal) {
    return this.backtrackPath(goal);
  }

  _wavefrontPropagation(start) {
    // 1. Upload start index to the GPU
    const startIndex = this.staticTerrain._indexAtCanvas(start.x, start.y);
    const { width, height, size } = this.staticTerrain;
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
    commandEncoder.copyBufferToBuffer(finalBuffer, 0, this.buffers.read, 0, size * 4);

    this.constructor.device.queue.submit([commandEncoder.finish()]);
  }

  /** @type {Uint32Array} */
  distanceMap;

  async _readResult() {
    await this.buffers.read.mapAsync(GPUMapMode.READ);
    this.distanceMap = new Uint32Array(this.buffers.read.getMappedRange());

    // Should be able to keep mapped and unmap only once we need a new buffer or destroy this pathfinder.
    // this.distanceMap.set(resultArray);
    // this.buffers.read.unmap();
  }

  destroy() {
    this.buffers.read.unmap();
    this.distanceMap = null;
  }


  /** @type {object<GPUPipeline>} */
  pipelines = {
    init: null,
    propagation: null,
  };

  pipeline = null;

  /** @type {GPUPipeline} */
  initPipeline = null;

  /** @type {GPUDevice} */
  static device = null;

  static async initializeDevice() {
    if ( this.device ) return;
    if ( !navigator.gpu ) throw new Error("WebGPU not supported");
    const adapter = await navigator.gpu.requestAdapter();
    this.device = await adapter.requestDevice();
  }

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
    this._createTerrainBuffer();
    this._createReadBackBuffer();
  }

  _createUniformBuffer() {
    const { width, height } = this.staticTerrain;
    const uniformData = new Uint32Array([width, height]);
    this.buffers.uniform = this.createMappedBuffer(uniformData, GPUBufferUsage.UNIFORM);

    // Buffer for InitParams (startIndex)
    this.buffers.initUniform = this.constructor.device.createBuffer({
      size: Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  _createTerrainBuffer() {
    this.buffers.terrain = this.constructor.device.createBuffer({
      size: this.combinedTerrain.size * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  _createDistanceBuffers() {
    // Distance Buffers (Ping-Pong)
    // Initialize: Start Node = 0, Others = MAX_INT
    // Allocate memory here but no mapping; handled on the GPU.
    const size = this.staticTerrain.size * Uint32Array.BYTES_PER_ELEMENT;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.buffers.A = this.constructor.device.createBuffer({ size, usage });
    this.buffers.B = this.constructor.device.createBuffer({ size, usage });
  }

  _createReadBackBuffer() {
    this.buffers.read = this.constructor.device.createBuffer({
      size: this.staticTerrain.size * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
  }


  _createBindGroups() {
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

  updateTerrainBuffer() {
    this.constructor.device.queue.writeBuffer(this.buffers.terrain, 0, this.combinedTerrain.pixels);
  }

  backtrackPath(end) {
    end = this.staticTerrain._fromCanvasCoordinates(end.x, end.y);

    const distMap = this.distanceMap;
    const { width, height } = this.staticTerrain;
    const path = [];
    let curr = end.clone();
    let idx = this.staticTerrain._indexAtLocal(curr.x, curr.y);
    if (distMap[idx] === 0xFFFFFFFF) return null; // No path found
    path.push(curr.clone());

    // Preallocate neighbors.
    const neighborOffsets = [
      PIXI.Point.tmp.set(-1, 0), // Left
      PIXI.Point.tmp.set(1, 0), // Right
      PIXI.Point.tmp.set(0, -1), // Top
      PIXI.Point.tmp.set(0, 1), // Bottom

      PIXI.Point.tmp.set(-1, -1), // Top left
      PIXI.Point.tmp.set(1, -1), // Top right
      PIXI.Point.tmp.set(-1, 1), // Bottom left
      PIXI.Point.tmp.set(1, 1), // Bottom right
    ];

    const neighbors = [
      PIXI.Point.tmp,
      PIXI.Point.tmp,
      PIXI.Point.tmp,
      PIXI.Point.tmp,

      PIXI.Point.tmp,
      PIXI.Point.tmp,
      PIXI.Point.tmp,
      PIXI.Point.tmp
    ];


    // Safety to break infinite loops in bad maps.
    let safety = 0;
    const MAX_STEPS = width * height;
    while ( distMap[idx] !== 0 && safety < MAX_STEPS ) {
      safety += 1;

      // Look for neighbor with strictly lower distance
      for ( let i = 0; i < 8; i += 1 ) curr.add(neighborOffsets[i], neighbors[i]);
      let bestNode = null;
      let lowestDist = distMap[idx]; // Starts with the current distance.

      // Find the neighbor with the strictly lowest distance value.
      for ( let n of neighbors ) {
        // Boundary checks
        if ( n.x >= 0 && n.x < width && n.y >= 0 && n.y < height ) {
          let nIdx = this.staticTerrain._indexAtLocal(n.x, n.y);
          let val = distMap[nIdx];
          let terrain = this.staticTerrain.pixels[nIdx];

          // We just want to roll "downhill" to 0.
          // Any neighbor with a lower value is a valid step towards home.
          // Check if neighbor is a wall (255).
          if ( terrain < 255 && val < lowestDist ) {
            lowestDist = val;
            bestNode = n;
            // Optimization: You could break here if you don't care about "perfect" path smoothness,
            // but iterating all 8 ensures we pick the steepest descent.
          }
        }
      }
      if ( bestNode ) {
        curr = bestNode;
        idx = this.staticTerrain._indexAtLocal(curr.x, curr.y);
        path.push(curr.clone());
      } else break; // We got stuck. Shouldn't happen in valid wavefront.
    }
    PIXI.Point.release(...neighborOffsets, ...neighbors, curr);
    path.forEach(pt => this.staticTerrain._toCanvasCoordinates(pt.x, pt.y, pt));
    return path.reverse();
  }

  static shaderCode = `
struct GridInfo { width: u32, height: u32 };
struct InitParams { startIndex: u32 };

@group(0) @binding(0) var<uniform> grid: GridInfo;

// terrainMap holds weights.
// e.g. 1 = Road, 5 = Grass, 255 = Wall
@group(0) @binding(1) var<storage, read> terrainMap: array<u32>;
@group(0) @binding(2) var<storage, read_write> inputDist: array<u32>;
@group(0) @binding(3) var<storage, read_write> outputDist: array<u32>;

// Params specifically for initialization
@group(0) @binding(4) var<uniform> initParams: InitParams;

fn get_idx(x: u32, y: u32) -> u32 { return y * grid.width + x; }

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
    let WALL = 255u;
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
    if (x > 0u) {
        let v = inputDist[get_idx(x - 1u, y)];
        if (v != MAX_VAL) { best = min(best, v + COST_STRAIGHT); }
    }

    // Right
    if (x < grid.width - 1u) {
        let v = inputDist[get_idx(x + 1u, y)];
        if (v != MAX_VAL) { best = min(best, v + COST_STRAIGHT); }
    }

    // Up
    if (y > 0u) {
        let v = inputDist[get_idx(x, y - 1u)];
        if (v != MAX_VAL) { best = min(best, v + COST_STRAIGHT); }
    }

    // Down
    if (y < grid.height - 1u) {
        let v = inputDist[get_idx(x, y + 1u)];
        if (v != MAX_VAL) { best = min(best, v + COST_STRAIGHT); }
    }

    // --- Check Diagonal Neighbors (Cost 14) ---

    // Strict diagonal check top-left example
    // if (x > 0u && y > 0u) {
    //  let left_wall = mapState[get_idx(x - 1u, y)] == 1u;
    //  let up_wall = mapState[get_idx(x, y - 1u)] == 1u;

    //  // Only process diagonal if adjacent cardinals are NOT walls
    //  if (!left_wall && !up_wall) {
    //       let v = inputDist[get_idx(x - 1u, y - 1u)];
    //       if (v != MAX_VAL) { best = min(best, v + COST_DIAGONAL); }
    //  }
    // }

    // Top-Left
    if (x > 0u && y > 0u) {
        let v = inputDist[get_idx(x - 1u, y - 1u)];
        if (v != MAX_VAL) { best = min(best, v + COST_DIAGONAL); }
    }

    // Top-Right
    if (x < grid.width - 1u && y > 0u) {
        let v = inputDist[get_idx(x + 1u, y - 1u)];
        if (v != MAX_VAL) { best = min(best, v + COST_DIAGONAL); }
    }

    // Bottom-Left
    if (x > 0u && y < grid.height - 1u) {
        let v = inputDist[get_idx(x - 1u, y + 1u)];
        if (v != MAX_VAL) { best = min(best, v + COST_DIAGONAL); }
    }

    // Bottom-Right
    if (x < grid.width - 1u && y < grid.height - 1u) {
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

/**
 * Manage mapping, reading, unmapping of WebGPU buffers using a staging ring.
 * See https://toji.dev/webgpu-best-practices/buffer-uploads.html
 */
class StagingBufferRing {
  /** @type {WebGPUDevice} */
  device;

  /** @type {number} */
  bufferSize = 0;

  /** @type {class<TypedArray>} */
  typedArrayClass = Uint32Array;

  /** @type {GPUBuffer[]} */
  buffers = [];

  constructor(device, { bufferSize = 0, typedArrayClass = Uint32Array } = {}) {
    this.device = device;
    this.bufferSize = bufferSize;
    this.typedArrayClass = typedArrayClass;
  }

  get stagingBuffer() {
    return this.buffers.pop() || this.device.createBuffer({
      size: this.bufferSize,
      usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
  }

  mapStagingBuffer(stagingBuffer, typedArrayClass = this.typedArrayClass) {
    return new typedArrayClass(stagingBuffer.getMappedRange());
  }

  copyToBuffer(stagingBuffer, copyBuffer, copyBufferSize) {
    stagingBuffer.unmap();
    const commandEncoder = this.device.createCommandEncoder({});
    commandEncoder.copyBufferToBuffer(stagingBuffer, 0, copyBuffer, 0, copyBufferSize);
    this.device.queue.submit([commandEncoder.finish()]);

    // Immediately after copying, re-map the buffer. Push onto the list of staging buffers when the
    // mapping completes.
    stagingBuffer.mapAsync(GPUMapMode.WRITE).then(() => this.buffers.push(stagingBuffer));
  }

  destroy() {
    this.buffers.forEach(buffer => buffer.destroy());
  }
}


/**
 * Test using the GPU to write the terrain map.
 * Draw segments for the walls and flat triangles for everything else.
 */
class GPUTerrainMap {

  resolution = 1;

  get sceneWidth() { return canvas.scene.dimensions.width; }

  get sceneHeight() { return canvas.scene.dimensions.height; }

  get gridWidth() { return Math.ceil(canvas.scene.dimensions.width * this.resolution); }

  get gridHeight() { return Math.ceil(canvas.scene.dimensions.height * this.resolution); }

  get gridSize() { return this.gridWidth * this.gridHeight; }

  constructor(resolution = 1) {
    if ( !this.constructor.device ) throw new Error(`${this.constructor.name}|webGPU device not initialized.`);
    this.resolution = resolution;
  }

  /** @type {GPUDevice} */
  static device = null;

  static async initializeDevice() {
    if ( this.device ) return;
    if ( !navigator.gpu ) throw new Error("WebGPU not supported");
    const adapter = await navigator.gpu.requestAdapter();
    this.device = await adapter.requestDevice();
  }

  /** @type {object<WebGPUBuffer>} */
  buffers = {
    uniform: null,
    terrain: null,
    staging: null,
  };

  /** @type {object<WebGPUPipeline} */
  pipelines = {
    segment: null,
  };

  /** @type {object<WebGPUBindGroup} */
  bindGroups = {
    segment: null,
  };

  /** @type {WebGPUTexture} */
  dummyTexture;

  async initialize() {
    const format = navigator.gpu.getPreferredCanvasFormat();

    // 0. Uniform buffer.
    const uniformData = new Float32Array([
      this.sceneWidth, this.sceneHeight,
      this.gridWidth, this.gridHeight,
    ]);
    this.buffers.uniform = this.constructor.device.createBuffer({
      label: "uniform",
      size: uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.constructor.device.queue.writeBuffer(this.buffers.uniform, 0, uniformData);

    // 1. Storage buffer. (The terrain map on the GPU, scaled by resolution.)
    this.buffers.terrain = this.constructor.device.createBuffer({
      label: "storage",
      size: this.gridSize * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    // 2. Staging buffer, scaled by resolution.
    this.buffers.staging = this.constructor.device.createBuffer({
      label: "staging",
      size: this.gridSize * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Create dummy texture.
    // This defines the coordinate space for the rasterizer.
    this.dummyTexture = this.constructor.device.createTexture({
      label: "dummy raster attachment",
      size: [this.gridWidth, this.gridHeight],
      format, // Match the format used in your pipeline targets
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // 3. Create pipeline.
    const shaderModule = this.constructor.device.createShaderModule({
      code: this.constructor.shaderCode,
    });
    this.pipelines.segment = this.constructor.device.createRenderPipeline({
      label: "segmentRender",
      layout: "auto",
      vertex: {
        module: shaderModule,
        entryPoint: "vs_segment_main",
        buffers: [{
          arrayStride: 8, // 2 floats (x, y) * 4 bytes
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }]
        }]
      },

      // Even though we are writing to a Storage Buffer, WebGPU's RenderPipeline still expects
      // a "drawing surface" (a texture) to define the boundaries of the grid.
      // We use a "dummy" texture for this.
      fragment: {
        module: shaderModule,
        entryPoint: "fs_segment_main",
        targets: [{
          format,
          writeMask: 0, // IMPORTANT: Do not write to the dummy texture.
        }]
      },
      primitive: { topology: "line-list" }
    });

    this.bindGroups.segment = this.constructor.device.createBindGroup({
      label: "segment",
      layout: this.pipelines.segment.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.uniform } },
        { binding: 1, resource: { buffer: this.buffers.terrain } },
      ]
    });
  }

  /**
   * @typedef object Segment
   * @prop {PIXI.Point} a
   * @prop {PIXI.Point} b
   *
   * Or
   * @prop {PIXI.Point} A
   * @prop {PIXI.Point} B
   */


  /**
   * @param {Wall[]} walls
   * @returns {Float32Array}
   */
  static convertWallsToArray(walls) {
    const numSegments = walls.length;
    const numCoordinates = numSegments * 4; // A.x, A.y, B.x, B.y
    const segmentArr = new Float32Array(numCoordinates);
    let i = 0;
    for ( const wall of walls ) {
      segmentArr.set(wall.document.c, i);
      i += 4;
    }
    return segmentArr;
  }

  /**
   * @param {Segment[]} segments
   * @returns {Float32Array}
   */
  static convertEdgesToArray(edges) {
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
   * @param {Segment[]} segments
   */
  async processWalls(segmentArr) {
    // Copy segment data to GPU.
    const vertexBuffer = this.constructor.device.createBuffer({
      size: segmentArr.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(vertexBuffer.getMappedRange()).set(segmentArr);
    vertexBuffer.unmap();

    // Process the segments on the GPU.
    const commandEncoder = this.constructor.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.dummyTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "discard", // We don't care about saving the pixel colors.
      }] // No visual output needed; dummy texture used.
    });

    passEncoder.setPipeline(this.pipelines.segment);
    passEncoder.setBindGroup(0, this.bindGroups.segment);
    passEncoder.setVertexBuffer(0, vertexBuffer);
    passEncoder.draw(segmentArr.length / 2); // 2 floats per vertex
    passEncoder.end();

    // Copy result from Storage -> Staging
    commandEncoder.copyBufferToBuffer(
      this.buffers.terrain, 0,
      this.buffers.staging, 0,
      this.gridSize * Uint32Array.BYTES_PER_ELEMENT,
    );

    this.constructor.device.queue.submit([commandEncoder.finish()]);

    // Read the data.
    await this.buffers.staging.mapAsync(GPUMapMode.READ);
    const terrainBuffer = this.buffers.staging.getMappedRange();
    const data = new Uint32Array(terrainBuffer.slice()); // Use slice to copy the buffer.
    this.buffers.staging.unmap();

    return data; // Flat JS array.
  }

  static shaderCode = `

struct Uniforms {
  sceneRes: vec2<f32>,
  gridRes: vec2<f32>,
};

struct VertexOutput {
  @builtin(position) pos: vec4<f32>,
};

// TODO: Is atomic necessary here? We are not incrementing for walls.
@group(0) @binding(0) var<uniform> config: Uniforms;
@group(0) @binding(1) var<storage, read_write> terrainMap: array<atomic<u32>>;

fn get_idx(x: u32, y: u32) -> u32 { return y * u32(config.gridRes.x) + x; }

@vertex
fn vs_segment_main(@location(0) pos: vec2<f32>) -> VertexOutput {
  var out: VertexOutput;

  // Convert scene coordinates (0 to res) to NDC (-1 to 1)
  let ndcX = ((pos.x / config.sceneRes.x)) * 2.0 - 1.0;
  let ndcY = 1.0 - ((pos.y / config.sceneRes.y) * 2.0); // Flip Y for screen space.
  out.pos = vec4<f32>(ndcX, ndcY, 0.0, 1.0);
  return out;
}

const WALL: u32 = 255u;

@fragment
fn fs_segment_main(@builtin(position) fragPos: vec4<f32>) {
  // fragPos is in the coordinate space of the attachment (the dummy texture).
  // Since the dummy texture is sized to gridRes, these are already grid coords.
  let x = u32(fragPos.x);
  let y = u32(fragPos.y);
  let index = get_idx(x, y);

  // Safety check to prevent out-of-bounds if floating point error occurs
  if ( index < arrayLength(&terrainMap) ) { atomicStore(&terrainMap[index], WALL); }
}
`;

}


/* Test GPUTerrainMap
Draw = CONFIG.GeometryLib.lib.Draw
api = game.modules.get("elevationruler").api
Terrain = api.pathfinding.Terrain
await GPUTerrainMap.initializeDevice()
resolution = 0.25
width = Math.ceil(canvas.scene.dimensions.width * resolution)
height = Math.ceil(canvas.scene.dimensions.height * resolution);

mapper = new GPUTerrainMap(resolution)
await mapper.initialize();
segmentArr = GPUTerrainMap.convertWallsToArray(canvas.walls.placeables)
terrainMap = await mapper.processWalls(segmentArr)

terrain = new Terrain(terrainMap, width, { scale: { resolution, x: 0, y: 0 } })


new Set(terrain.pixels)
terrain.draw({ skip: 5, local: true })

terrain.draw({ skip: 5, local: false })

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
await pf.initializeWebGPU(randal)
await pf.calculateDistanceMap(start)
path = await pf.findPath(start, end)
WebGPUPathfinder.drawPath(path);


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

distMap = new PixelCache(pf.distanceMap, pf.terrain.width)
distValues = sortedUnique(distMap.pixels);
console.log(`Max distance is ${distValues.at(-2)}`);

heatMap = createHeatMap(0, distValues.at(-2));
colorFn = value => value > distValues.at(-2) ? Draw.COLORS.red : heatMap(value);
alphaFn = value => value > distValues.at(-2) ? 1 : 0.5;
distMap.draw({ local: true, skip: 5, maximumPixelValue: distValues.at(-2), colorFn, alphaFn, gammaCorrect: false })


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

