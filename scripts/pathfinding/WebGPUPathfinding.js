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

/**
 * Hook canvas load to wipe the data map.
 */
Hooks.on("canvasReady", function() {
  Terrain.dataMap.clear();
});

export class Terrain {

  /**
   * Map of static data for different elevations and sense types.
   * @type {Map<string, PixelCache<Uint32Array>}
   */
  static dataMap = new Map();

  /**
   * Data that seldom moves, like walls.
   * @type {PixelCache<Uint32Array>} TODO: Why not use Uint8?
   */
  staticData;

  /**
   * The data that often moves, like token positions.
   * @type {PixelCache<Uint32Array>} TODO: Why not use Uint8?
   */
  transientData;

  /** @type {enum<number>} */
  static FEATURES = {
    NORMAL: 1, // Lowest cost available is 1.
    BLOCKING: 255, // Considered infinite cost: 2^8 - 1.
  };

  /** @type {number} */
  #width = 0;

  /** @type {number} */
  #height = 0;

  /** @type {number} */
  #resolution = 1;

  get size() { return this.#width * this.#height; }

  constructor({ resolution = 1 } = {}) {
    const sceneRect = canvas.scene.dimensions.sceneRect;

    // Calculate the pixel grid for given resolution.
    this.#width = Math.round(sceneRect.width * resolution);
    this.#height = Math.round(sceneRect.height * resolution);
    this.#resolution = resolution;
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
    if ( this.staticData ) this.staticData.pixels.fill(0);
    if ( this.transientData ) this.clearTransient();
  }

  clearTransient() { this.transientData.pixels.fill(0); }

  /**
   * Mark the edges in the static data.
   * Does not mark transient data nor copy static to transient.
   * @param {Edge[]} [edges]        Edges to mark, if not the entire canvas
   */
  markEdge(edge, dataType = "staticData") {
    const value = this.constructor.FEATURES.BLOCKING;
    this[dataType].setPixelsUnderCanvasSegment(edge.a, edge.b, value);
  }

  markToken(token, value = this.constructor.FEATURES.BLOCKING ) {
    this.transientData.setPixelsUnderCanvasShape(token.constrainedTokenBorder, value);
  }

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
      const localShape = this.transientData._shapeToLocalCoordinates(shape[GEOMETRY_LIB_ID][GEOMETRY_ID].shapePIXI);
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
      const i = this.transientData._indexAtLocal(idx.x, idx.y);
      const currValue = this.transientData.pixels[i];
      const newValue = Math.min(this.constructor.FEATURES.BLOCKING, currValue * value);
      this.transientData.pixels[i] = newValue;
    });
    idx.release();
  }

  /**
   * Update the static data for the scene.
   * The subject token defines the elevation.
   * @param {number} elevationZ                           Elevation for the terrain
   * @param {CONST.WALL_RESTRICTION_TYPES} senseType      For testing walls
   */
  updateStaticData(elevationZ = 0, senseType = "move") {
    const key = `${elevationZ}_${senseType}_${this.#resolution}`;
    if ( !this.constructor.dataMap.has(key) ) {
      const scale = {
        resolution: this.#resolution,
        x: canvas.scene.dimensions.sceneX,
        y: canvas.scene.dimensions.sceneY,
      };
      const data = new PixelCache(new Uint32Array(this.size), this.#width, { scale });
      this.constructor.dataMap.set(key, data);
    }
    this.staticData = this.constructor.dataMap.get(key);
    this.clear();

    // TODO: Handle other sense types with special walls.
    // For now, ignore walls that do not fully restrict.
    // For now, ignore token height.
    const NORMAL = CONST.WALL_SENSE_TYPES.NORMAL;
    canvas.walls.placeables
      .filter(wall => {
        if ( wall.document[senseType] !== NORMAL ) return false;
        if ( wall.isDoor ) return false; // Doors go in transient data.
        if ( elevationZ >= wall.topZ && elevationZ < wall.bottomZ ) return false; // If top equals token elevation, don't blokc.
        return true;
      })
      .forEach(wall => this.markEdge(wall.edge, "staticData"));
  }

  /**
   * Update the transient data for the scene.
   * Token-specific data, such as difficult terrain.
   * @param {Token} subjectToken
   */
  updateTransientData(subjectToken, senseType = "move") {
    if ( !this.transientData ) {
      const scale = {
        resolution: this.#resolution,
        x: canvas.scene.dimensions.sceneX,
        y: canvas.scene.dimensions.sceneY,
      };
      this.transientData = new PixelCache(new Uint32Array(this.size), this.#width, { scale });
    }
    this.clearTransient();

    // Mark closed doors.
    const elevationZ = subjectToken.bottomZ;
    const NORMAL = CONST.WALL_SENSE_TYPES.NORMAL;
    canvas.walls.placeables
      .filter(wall => {
        if ( wall.document[senseType] !== NORMAL ) return false;
        if ( !wall.isDoor ) return false; // Doors go in transient data.
        if ( elevationZ >= wall.topZ && elevationZ < wall.bottomZ ) return false; // If top equals token elevation, don't blokc.
        return true;
      })
      .forEach(wall => this.markEdge(wall.edge, "transientData"));

    // Score each token.
    // Since we just cleared, need only mark non-normal move difficulty.
    canvas.tokens.placeables.forEach(token => {
      const value = this.constructor.tokenValue(token, subjectToken);
      if ( value !== this.constructor.FEATURES.NORMAL ) this.markToken(token, value);
    });

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

  draw({ type = "static", ...opts } = {}) {
    type = `${type}Data`;
    const heatMap = createHeatMap(2, 254);
    const colorFn = value => {
      switch ( value ) {
        case 1: return Draw.COLORS.gray;
        case 255: return Draw.COLORS.red;
        default: return heatMap(value);
      }
    }
    const alphaFn = value => value === 255 ? 1 : 1 ? 0.1 : 0.5;
    opts.colorFn ??= colorFn;
    opts.alphaFn ??= alphaFn;
    opts.maximumPixelValue ??= 255;
    opts.skip ??= 10;
    this[type].draw(opts);
  }
}


export class WebGPUPathfinder extends AbstractPathfinder {

  /** @type {Terrain} */
  terrain;

  /** @type {number} */
  resolution = 1;

  constructor(token) {
    super(token);
    if ( !this.constructor.device ) throw new Error(`${this.constructor.name}|webGPU device not initialized.`);
  }

  initializeWebGPU() {
    this.createTerrain({ resolution: this.resolution });
    this.createPipeline();
    // this.createBuffers();
    // this.createBindGroups();
  }

  createBuffers() {
    const buffers = this.buffers;

    // Static terrain weights.
    buffers.terrain = this.createMappedBuffer(this.terrain.transientData.pixels, GPUBufferUsage.STORAGE);

    // Distance Buffers (Ping-Pong)
    // Initialize: Start Node = 0, Others = MAX_INT
    const size = this.terrain.size;
    const initialDist = new Uint32Array(size).fill(0xFFFFFFFF);
    this.buffers.A = this.createMappedBuffer(initialDist, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    this.buffers.B = this.createMappedBuffer(initialDist, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);

    // Uniform Buffer (Dimensions)
    const { width, height } = this.terrain;
    const uniformData = new Uint32Array([width, height]);
    buffers.uniform = this.createMappedBuffer(uniformData, GPUBufferUsage.UNIFORM);

    // 2. Create Bind Groups
    // Group A: Reads A, Writes B
    this.bindGroups.A = this.createBindGroup(buffers.A, buffers.B);

    // Group B: Reads B, Writes A
    this.bindGroups.B = this.createBindGroup(buffers.B, buffers.A);

    // Read-back buffer.
    buffers.read = this.constructor.device.createBuffer({
      size: size * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    this.distanceMap = new Uint32Array(size);
  }

  updateStaticTerrain(elevationZ = 0) {
    this.terrain.updateStaticData(elevationZ);
  }

  updateTransientTerrain(subjectToken) {
    this.terrain.updateTransientData(subjectToken);

    // Combine with static data.
    // If, e.g, static costs 2 and transient costs 3, that means there is a 2x static and 3x transient.
    // In total, 5 units.
    // Static and transient start as 0 if no obstacle/terrain present.
    // And treat 255 as hard cap. (May be necessary for Uint8Array implementation.)
    const { staticData, transientData } = this.terrain;
    const { NORMAL, BLOCKING } = this.terrain.constructor.FEATURES;
    for ( let i = 0, iMax = staticData.pixels.length; i < iMax; i += 1 ) {
      transientData.pixels[i] = Math.min(BLOCKING, staticData.pixels[i] + transientData.pixels[i]) || 1; // Replace zeroes with ones.
    }
    // this.updateBufferData(this.buffers.terrain, transientData.pixels);
  }

  updateBufferData(buffer, newData, { srcOffset = 0, destOffset = 0 } = {}) {
    this.constructor.device.queue.writeBuffer(
      buffer,             // Destination buffer
      destOffset,         // Destination offset (byte)
      newData.buffer,     // Source data (ArrayBuffer)
      srcOffset,          // Source offset (byte)
      newData.byteLength  // Source size (byte)
    );
  }

  distanceMapReady = false;

  get start() { return super.start; }

  set start(value) {
    if ( this.start.equals(value) ) return;
    super.start = value;

    this.distanceMapReady = false;
    this.calculateDistanceMap(value); // Async.
  }

  async findPath(start, goal, signal) {
    // Skip caching if distance map not yet prepared.
    if ( !this.distanceMapReady ) return null;
    return super.findPath(start, goal, signal);
  }

  async _findPath(start, goal, _signal) {
    return this.backtrackPath(goal);
  }

  async calculateDistanceMap(start, _signal = {}) {
    this.distanceMapReady = false;
    // try {
      console.time("GPU Pathfinding Setup");
      this._initializeDistanceBuffers(start);
      this._wavefrontPropagation();
      console.timeEnd("GPU Pathfinding Setup");
      console.time("GPU Pathfinding Distance Map");
      await this._readResult();
      console.timeEnd("GPU Pathfinding Distance Map");
      this.distanceMapReady = true;
    /*} catch(err) {
      console.error(err);
      this.distanceMapReady = false;
    } finally {
      // this._resetDistanceBuffers(start);
    }*/
  }

  _initializeDistanceBuffers(start) {
    const startIndex = this.terrain.staticData._indexAtCanvas(start.x, start.y);
    const initialDist = new Uint32Array(this.terrain.size).fill(0xFFFFFFFF);
    initialDist[startIndex] = 0;
    this.constructor.device.queue.writeBuffer(
      this.buffers.A,         // Destination buffer
      0,                      // Destination offset (byte)
      initialDist.buffer,     // Source data (ArrayBuffer)
      0,                      // Source offset (byte)
      initialDist.byteLength  // Source size (byte)
    );
    this.constructor.device.queue.writeBuffer(
      this.buffers.B,         // Destination buffer
      0,                      // Destination offset (byte)
      initialDist.buffer,     // Source data (ArrayBuffer)
      0,                      // Source offset (byte)
      initialDist.byteLength  // Source size (byte)
    );

    /*
    // TODO: Create initialDist only once? Would take quite a bit of memory to keep around.
    // Distance Buffers (Ping-Pong)
    // Initialize: Start Node = 0, Others = MAX_INT
    const initialDist = new Uint32Array([0]);
    this.constructor.device.queue.writeBuffer(
      this.buffers.A,         // Destination buffer
      startIndex * Uint32Array.BYTES_PER_ELEMENT, // Destination offset (byte)
      initialDist.buffer,     // Source data (ArrayBuffer)
      0,                      // Source offset (byte)
      initialDist.byteLength  // Source size (byte)
    );
    this.constructor.device.queue.writeBuffer(
      this.buffers.B,         // Destination buffer
      startIndex * Uint32Array.BYTES_PER_ELEMENT,                      // Destination offset (byte)
      initialDist.buffer,     // Source data (ArrayBuffer)
      0,                      // Source offset (byte)
      initialDist.byteLength  // Source size (byte)
    );
    */
  }

  /*
  _resetDistanceBuffers() {
    const defaultDist = new Uint32Array(this.terrain.size).fill(0xFFFFFFFF);
    this.constructor.device.queue.writeBuffer(
      this.buffers.A,         // Destination buffer
      0,                      // Destination offset (byte)
      defaultDist.buffer,     // Source data (ArrayBuffer)
      0,                      // Source offset (byte)
      defaultDist.byteLength  // Source size (byte)
    );
    this.constructor.device.queue.writeBuffer(
      this.buffers.B,         // Destination buffer
      0,                      // Destination offset (byte)
      defaultDist.buffer,     // Source data (ArrayBuffer)
      0,                      // Source offset (byte)
      defaultDist.byteLength  // Source size (byte)
    );
  }
  */

  _wavefrontPropagation() {
    const commandEncoder = this.constructor.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.pipeline);

    // Iterate enough times to cover the map (Manhattan distance approx)
    // For a generic grid, Width + Height is a safe upper bound.
    // With diagonals, increase 150%.
    const { width, height, size } = this.terrain;
    const iterations = Math.max(width, height) * 1.5;
    for ( let i = 0; i < iterations; i += 1 ) {
      // Swap bind groups every iteration
      pass.setBindGroup(0, i % 2 === 0 ? this.bindGroups.A : this.bindGroups.B);
      pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    }
    pass.end();

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
    const resultArray = new Uint32Array(this.buffers.read.getMappedRange());

    // TODO: Should be able to keep mapped and unmap only once we need a new buffer or destroy this pathfinder.
    this.distanceMap ??= new Uint32Array(this.terrain.size);
    this.distanceMap.set(resultArray);
    this.buffers.read.unmap();
  }


  /** @type {GPUDevice} */
  static device = null;

  /** @type {GPUPipeline} */
  pipeline = null;

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

    this.pipeline = this.constructor.device.createComputePipeline({
      layout: "auto",
      compute: { module: shaderModule, entryPoint: "main" },
    });
  }

  _createUniformBuffer() {
    const { width, height } = this.terrain;
    const uniformData = new Uint32Array([width, height]);
    this.buffers.uniform = this.createMappedBuffer(uniformData, GPUBufferUsage.UNIFORM);
  }

  _createTerrainBuffer() {
    const size = this.terrain.size;
    const byteLength = size * Uint32Array.BYTES_PER_ELEMENT;
    this.buffers.terrain = this.createBuffer(byteLength, GPUBufferUsage.STORAGE);
  }

  _createDistanceBuffers() {
    // Initialize: Start Node = 0, Others = MAX_INT
    const size = this.terrain.size;
    const initialDist = new Uint32Array(size).fill(0xFFFFFFFF);
    this.buffers.A = this.createMappedBuffer(initialDist, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    this.buffers.B = this.createMappedBuffer(initialDist, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
  }

  _createReadBackBuffer() {
    const size = this.terrain.size;
    this.buffers.read = this.createBuffer(size * Uint32Array.BYTES_PER_ELEMENT, GPUBufferUsage.MAP_READ);
  }

  createBuffer(byteLength, usage) {
    return this.constructor.device.createBuffer({
      size: byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
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

  createBindGroup(input, output) {
    const buffers = this.buffers;
    return this.constructor.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.terrain } },
        { binding: 2, resource: { buffer: input } },
        { binding: 3, resource: { buffer: output } }
      ]
    });
  }

  createTerrain({ resolution = 1 } = {}) {
    this.terrain = new Terrain({ resolution });
  }

  buffers = {
    uniform: null,
    terrain: null,

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
  };

  /*
  createBuffers() {
    this._createUniformBuffer();
    this._createTerrainBuffer();
    this._createDistanceBuffers();
    this._createReadBackBuffer();
  }
  */

  createBindGroups() {
    const buffers = this.buffers;

    // Group A: Reads A, Writes B
    this.bindGroups.A = this.createBindGroup(
      buffers.A,
      buffers.B
    );

    // Group B: Reads B, Writes A
    this.bindGroups.B = this.createBindGroup(
      buffers.B,
      buffers.A
    );
  }


  backtrackPath(end) {
    end = this.terrain.staticData._fromCanvasCoordinates(end.x, end.y);

    const distMap = this.distanceMap;
    const { width, height } = this.terrain;
    const path = [];
    let curr = end.clone();
    let idx = this.terrain.staticData._indexAtLocal(curr.x, curr.y);
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
          let nIdx = this.terrain.staticData._indexAtLocal(n.x, n.y);
          let val = distMap[nIdx];
          let terrain = this.terrain.staticData.pixels[nIdx];

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
        idx = this.terrain.staticData._indexAtLocal(curr.x, curr.y);
        path.push(curr.clone());
      } else break; // We got stuck. Shouldn't happen in valid wavefront.
    }
    PIXI.Point.release(...neighborOffsets, ...neighbors, curr);
    path.forEach(pt => this.terrain.staticData._toCanvasCoordinates(pt.x, pt.y, pt));
    return path.reverse();
  }

  drawDistanceMap(opts = {}) {
    opts.local ??= true;
    opts.skip ??= 5;

    const distMap = new PixelCache(this.distanceMap, this.terrain.width);
    const distValues = sortedUnique(distMap.pixels);
    opts.maximumPixelValue = distValues.at(-2);
    console.debug(`Max distance is ${distValues.at(-2)}`);

    const heatMap = createHeatMap(0, distValues.at(-2));
    opts.colorFn = value => value > distValues.at(-2) ? Draw.COLORS.red : heatMap(value);
    opts.alphaFn = value => value > distValues.at(-2) ? 1 : 0.5;
    distMap.draw(opts);
  }

  static shaderCode = `
struct GridInfo { width: u32, height: u32 };

@group(0) @binding(0) var<uniform> grid: GridInfo;

// terrainMap holds weights.
// e.g. 1 = Road, 5 = Grass, 255 = Wall
@group(0) @binding(1) var<storage, read> terrainMap: array<u32>;

// Calculate new output distance given input distance for each index.
@group(0) @binding(2) var<storage, read> inputDist: array<u32>;
@group(0) @binding(3) var<storage, read_write> outputDist: array<u32>;

fn get_idx(x: u32, y: u32) -> u32 { return y * grid.width + x; }

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let x = id.x;
    let y = id.y;
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
terrain.staticData._setPixelsUnderLocalShape(rect, 255)
terrain.staticData.draw({ maximumPixelValue: 255, skip: 0, local: true })
terrain.staticData.drawFromCoords({ maximumPixelValue: 255, skip: 0, local: true })
Draw.shape(rect)


wall = canvas.walls.placeables[0];
terrain.markEdges([wall.edge])

terrain.markEdges();
terrain.markTokens();

terrain.staticData.draw({ maximumPixelValue: 255, skip: 0 })
terrain.transientData.draw({ maximumPixelValue: 255, skip: 0 })

terrain.staticData.drawFromCoords({ maximumPixelValue: 255, skip: 0 })
terrain.transientData.drawFromCoords({ maximumPixelValue: 255, skip: 0 })

terrain.staticData.draw({ maximumPixelValue: 255, local: true, skip: 0 })
terrain.staticData.drawFromCoords({ maximumPixelValue: 255, local: true, skip: 0 })

terrain.transientData.draw({ maximumPixelValue: 255, local: true, skip: 0 })
terrain.transientData.drawFromCoords({ maximumPixelValue: 255, local: true, skip: 0 })


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
pf.terrain.staticData.draw({ maximumPixelValue: 255, local: true, skip: 5, colorFn, alphaFn })
pf.terrain.transientData.draw({ maximumPixelValue: 255, local: true, skip: 5, colorFn, alphaFn })

pf.terrain.staticData.draw({ maximumPixelValue: 255, local: false, skip: 5, colorFn, alphaFn })
pf.terrain.transientData.draw({ maximumPixelValue: 255, local: false, skip: 5, colorFn, alphaFn })

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

pf = new WebGPUPathfinder(randal);
pf.resolution = .25;
await pf.initializeWebGPU()
pf.initialize();
pf.updateStaticTerrain(0)
pf.updateTransientTerrain(randal)

pf.createBuffers()
// pf.createBindGroups()

await pf.calculateDistanceMap(start)

new Set(pf.terrain.staticData.pixels)
new Set(pf.terrain.transientData.pixels)
new Set(pf.distanceMap)

path = await pf.findPath(start, end)
path = await pf.findPath(start, end)

pf.terrain.staticData.draw({ maximumPixelValue: 255, skip: 10 })
WebGPUPathfinder.drawPath(path);


pf.terrain.draw({ type: "static", skip: 5, local: true })
pf.terrain.draw({ type: "transient", skip: 5, local: true })
pf.terrain.draw({ type: "static", skip: 5, local: false })
pf.terrain.draw({ type: "transient", skip: 5, local: false })

pf.drawDistanceMap({ local: true, skip: 5 })
pf.drawDistanceMap({ local: false, skip: 5 })

pf.terrain.staticData.draw({ maximumPixelValue: 255, skip: 2, local: true })

distMap = new PixelCache(pf.distanceMap, pf.terrain.width)
distValues = sortedUnique(distMap.pixels);
console.log(`Max distance is ${distValues.at(-2)}`);

heatMap = createHeatMap(0, distValues.at(-2));
colorFn = value => value > distValues.at(-2) ? Draw.COLORS.red : heatMap(value);
alphaFn = value => value > distValues.at(-2) ? 1 : 0.5;
distMap.draw({ local: true, skip: 5, maximumPixelValue: distValues.at(-2), colorFn, alphaFn, gammaCorrect: false })


pf.terrain.staticData.draw({ maximumPixelValue: 255, local: true, skip: 10 })
localStart = pf.terrain.staticData._fromCanvasCoordinates(start.x, start.y);
localEnd = pf.terrain.staticData._fromCanvasCoordinates(end.x, end.y);

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

