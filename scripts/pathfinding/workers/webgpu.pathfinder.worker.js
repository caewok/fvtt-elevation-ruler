/* globals
GPUBufferUsage,
GPUMapMode,
GPUTextureUsage,
self,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// Cannot currently use import. import { bresenhamLine } from "../geometry/util.js";

// Currently throws error re Cannot use import statement outside a module.
// Worked when creating worker manually from console though...
// import { GPUTerrainMap } from "../WebGPUPathfinding.js";

// ----- NOTE: Properties ----- //

/** @type {GPUPathfinder} */
let pf;

const SCENE_EDGES = {
  static: 0,
  subject: 0,
  transient: 0,
};

/**
 * Simple integer point key.
 */
function pointKey(x, y) { return (x << 16) ^ y; }

/**
 * Bresenham's line algorithm
 * Returns an array of coordinates.
 * @param {number} x1   First coordinate x value
 * @param {number} y1   First coordinate y value
 * @param {number} x2   Second coordinate x value
 * @param {number} y2   Second coordinate y value
 * @returns {number[]}
 */
function bresenhamLine(x1, y1, x2, y2) {
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  x2 = Math.round(x2);
  y2 = Math.round(y2);

  // Calculate differences
  const dx = x2 - x1;
  const dy = y2 - y1;

  // Determine the maximum absolute difference
  const n = Math.max(Math.abs(dx), Math.abs(dy));

  // Calculate increments.
  const incX = dx / n;
  const incY = dy / n;

  // Initialize the result array with the starting point
  const points = Array((n * 2) + 2);
  points[0] = x1;
  points[1] = y1;

  // Iterate through the line
  for ( let i = 2, ln = points.length; i < ln; i += 2 ) {
    // Calculate the next point
    x1 += incX;
    y1 += incY;

    // Add the adjusted point to the result array
    points[i] = Math.round(x1);
    points[i + 1] = Math.round(y1);
  }
  return points;
}

/**
 * Use Bresenham to draw pixels under each wall in the scene, and count the pixels.
 * @param {Float32Array[]} [segments]      Segments to approximate
 * @returns {number} Unique pixels count.
 */
function countUniquePixelsForSegments(segments) {
  const coveredPixels = new Set();
  for ( let i = 0, iMax = segments.length; i < iMax; i += 4 ) {
    const points = bresenhamLine(segments[i], segments[i+1], segments[i+2], segments[i+3]);
    for ( let j = 0, jMax = points.length; j < jMax; j += 2 ) {
      const key = pointKey(points[j], points[j+1]);
      coveredPixels.add(key);
    }
  }
  return coveredPixels.size;
}

/**
 * Estimate the number of iterations required.
 * Depends primarily on the edge count.
 * @param {number} startX
 * @param {number} startY
 * @returns {number} Iterations required
 */
const ERROR_MARGIN = 0.1;

function estimateIterations(startX, startY) {
  const tm = pf.terrainMapper;

  // Determine how far into the scene the starting position is.
  const [width, height] = tm.sceneDims;
  const percentX = startX / width;
  const percentY = startY / height;

  // Determine the wall coverage at the given resolution.
  const wallPixels = (SCENE_EDGES.static + SCENE_EDGES.subject + SCENE_EDGES.transient);
  const wallPixelsForResolution = wallPixels * tm.resolution;

  // Linear regression, with an error adjustment.
  const estimate = (0.19 * wallPixelsForResolution) - (113.42 * percentX) - (254.71 * percentY) + 564.33;
  return Math.ceil(estimate * (1 + ERROR_MARGIN));
}


/**
 * Initialize the pathfinder.
 * @param {object} options
 * @param {number} options.sceneWidth
 * @param {number} options.sceneHeight
 * @param {number} [options.resolution=1]
 * @param {number} [options.translationX=0]
 * @param {number} [options.translationY=0]
 * @param {boolean} [options.debug=false]
 * @returns {boolean}
 */
async function initialize({ debug, ...opts } = {}) { /* eslint-disable-line no-unused-vars */
  pf = new GPUPathfinder();
  await pf.initialize(opts);
  if ( debug ) console.debug("WebGPUPathfinderWorker|Initialized.");
  return [true];
}

/**
 * Update a buffer with blocking segments
 * @param {object} options
 * @param {Float32Array} options.segments                       The 2d segment positions: [A.x, A.y, B.x, B.y]
 * @param {"transient"|"static"|"subject"} [options.bufferType="transient"]   Which buffer to update
 * @param {boolean} [options.clear=true]                                      Clear buffer prior to updating?
 * @param {boolean} [options.debug=false]
 * @returns {boolean}
 */
function updateBufferBlockingSegments({ segments, bufferType = "transient", openDoors = false, clear = true, debug = false } = {}) { /* eslint-disable-line no-unused-vars */
  const size = countUniquePixelsForSegments(segments);
  const doorMult = openDoors ? -1 : 1;
  SCENE_EDGES[bufferType] = clear ? size * doorMult
    : SCENE_EDGES[bufferType] += size * doorMult;

  pf.terrainMapper.processBlockingSegments(segments, { bufferType, openDoors, clear });
  if ( debug ) console.debug(`WebGPUPathfinderWorker|Updated blocking segments for ${bufferType} buffer.`);
  return [true];
}

/**
 * Update a buffer with terrain triangles
 * @param {object} options
 * @param {Float32Array} options.vertices                                     Triangle vertices
 * @param {Uint16Array} options.indicies                                      Triangle indices
 * @param {"transient"|"static"|"subject"} [options.bufferType="transient"]   Which buffer to update
 * @param {boolean} [options.clear=true]                                      Clear buffer prior to updating?
 * @param {boolean} [options.debug=false]
 * @returns {boolean}
 */
function updateBufferTerrainTriangles({ vertices, indices, bufferType = "transient", clear = true, debug = false } = {}) { /* eslint-disable-line no-unused-vars */
  pf.terrainMapper.processTerrainTriangles(vertices, indices, { bufferType, clear });
  if ( debug ) console.debug(`WebGPUPathfinderWorker|Updated terrain for ${bufferType} buffer.`);
  return [true];
}

/**
 * Clear a buffer
 * @param {"transient"|"static"|"subject"} [options.bufferType="transient"]
 * @param {boolean} [options.debug=false]
 */
function clearBuffer({ bufferType = "transient", debug = false } = {}) { /* eslint-disable-line no-unused-vars */
  pf.terrainMapper.clearTerrainMap(bufferType);
  if ( debug ) console.debug(`WebGPUPathfinderWorker|Cleared ${bufferType} buffer.`);
  return [true];
}

/**
 * Dimensions of the pixel buffer used
 * @returns {[result: object]}
 */
function pixelBufferDimensions() { /* eslint-disable-line no-unused-vars */
  const dims = pf.terrainMapper.gridDims;
  return [{ width: dims[0], height: dims[1] }];
}

/**
 * Extract buffer data (for debugging)
 * @param {object} options
 * @param {"transient"|"static"|"subject"|"distance"} options.bufferName
 * @returns {[result: object, transfer: object[]}
 */
async function extractBufferData({ bufferType = "transient" } = {}) { /* eslint-disable-line no-unused-vars */
  const dims = pf.terrainMapper.gridDims;
  let buffer;
  if ( bufferType === "distance" ) buffer = new Uint32Array(pf.distanceMap);
  else buffer = await pf.terrainMapper.extractBufferData(bufferType);
  return [{ buffer, width: dims[0] }, [buffer.buffer]];
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
async function calculateDistanceMap({ startX = 0, startY = 0, elevation = 0, signal, debug = false } = {}) { /* eslint-disable-line no-unused-vars */
  await pf.calculateDistanceMap({ x: startX, y: startY }, signal, debug);
  if ( debug ) console.debug(`WebGPUPathfinderWorker|Distance map calculated for ${startX},${startY},${elevation}.`);
  return [true];
}

/**
 * Calculate the path.
 * @param {object} options
 * @param {number} options.startX           Token x position
 * @param {number} options.startY           Token y position
 * @param {number} options.endX           Token x position
 * @param {number} options.endY           Token y position
 * @param {number} options.elevation        Token elevation
 * @param {number} options.elevation        Token elevation; if changed will
 * @param {AbortSignal} options.signal
 */
async function findPath({ /* eslint-disable-line no-unused-vars */
  startX = 0, startY = 0,
  endX = 0, endY = 0,
  diagonalCost = Math.SQRT2, _elevation = 0, signal = {}, debug = false
}) {
  const start = { x: startX, y: startY };
  const goal = { x: endX, y: endY };
  pf.diagonalCost = diagonalCost;
  const path = await pf.findPath(start, goal, signal, diagonalCost);
  if ( debug ) console.debug(`WebGPUPathfinderWorker|Path length ${path.length} found for ${startX},${startY}.`);
  return [{ path }, [path.buffer]];
}

/**
 * Destroy the current pathfinder.
 */
async function destroy() {
  if ( pf ) pf.destroy();
  pf = null;
  return [true];
}

/**
 * Destroy the current pathfinder and the device, and terminate the worker.
 */
async function terminate() { /* eslint-disable-line no-unused-vars */
  await destroy();
  GPUPathfinder.destroy();
  self.close();
  return [true];
}


/**
 * Get a path
 */
// !!!GPUPathfinder
class GPUPathfinder {
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

  async initialize({ resolution = 1, sceneWidth, sceneHeight, translationX = 0, translationY = 0, debug = false } = {}) { /* eslint-disable-line max-len */
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

  async calculateDistanceMap(start, _signal = {}, debug = false) {
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

    // Initial Pass: Set buffers to Infinity and Start to 0.
    // TODO: Use distinct bind group here instead of A.
    const commandEncoder = this.constructor.device.createCommandEncoder({ label: "Wavefront encoder" });
    const initPass = commandEncoder.beginComputePass({ label: "Wavefront init" });
    initPass.setPipeline(this.pipelines.init);
    initPass.setBindGroup(0, this.bindGroups.init);
    initPass.dispatchWorkgroups(workgroupX, workgroupY);
    initPass.end();

    // 3. Propagation Passes (Ping-Pong)
    // Iterate enough times to cover the map (Manhattan distance approx)
    // For a generic grid, Width + Height is a safe upper bound.
    // With diagonals, increase 150%.
    // const iterations = (width + height) * 5; // Reasonably safe option.
    const iterations = estimateIterations(start.x, start.y);
    console.debug(`Running ${iterations} iterations for the distance map.`);

    // NOTE: This assumes the propagation passes can act out-of-order.
    // If not, the compute pass must be called repeatedly within the loop.
    const propagationPass = commandEncoder.beginComputePass({ label: "Wavefront Propagation"});
    propagationPass.setPipeline(this.pipelines.propagation);
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

  /**
   * Helper for backtrackPath.
   * Stores the neighbor offsets.
   * @type {number[]{dx, dy}}
   */
  static neighborOffsets = [
    // Diagonal. First so it gets preference in case of tie. Important for 1/2/1 diagonals.
    { dx: 1, dy: 1 },
    { dx: -1, dy: -1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 1 },

    // Cardinal.
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
  ];


  async findPath(start, goal, signal = {}, diagonalCost = Math.SQRT2) {
    if ( this.distanceMapStatus === this.constructor.STATUS.NOT_READY ) {
      await this.calculateDistanceMap(start, signal);
    }

    // TODO: Check start elevation and switch buffer data accordingly.
    return this.backtrackPath(goal, signal, diagonalCost);
  }

  /**
   * Backtrack from goal to start using a Manhattan-only distance map.
   * @param {Point} {x, y}                    The end coordinates
   * @param {AbortSignal} signal              Signal to cancel early
   * @param {number} [diagonalCost=1.414]     Cost multiplier for diagonal moves.
   * • 1.414: Normal Euclidean diagonals (will take shortcuts).
   * • 2.0: Manhattan-equivalent (diagonals tie with 2 straight moves).
   * • >2.0: Penalizes/prevents diagonal movement entirely.
   */
  backtrackPath({ x, y } = {}, signal, diagonalCost = Math.SQRT2) { /* eslint-disable-line default-param-last */
    let { x: currX, y: currY } = this.terrainMapper.fromCanvasCoordinates(x, y);
    const distMap = this.distanceMap;
    let idx = this.terrainMapper.indexAtLocal(currX, currY);
    if ( !~idx || distMap[idx] >= 0xFFFFFFFF ) return new Uint16Array(); // No path found

    const neighborValueFn = isFinite(diagonalCost)
      ? this.#neighborValueWithDiagonals.bind(this)
      : this.#neighborValueManhattan.bind(this);

    // Move from the end point along the lowest-cost neighbors back to start.
    const [width, height] = this.terrainMapper.gridDims;
    const area = this.terrainMapper.area;
    const path = [currX, currY];

    const neighborOffsets = isFinite(diagonalCost)
      ? this.constructor.neighborOffsets
      : this.constructor.neighborOffsets.slice(4);

    // Set the diagonal cost.
    // If 1/2/1 or 2/1/2 is chosen, it doesn't work to simply alternate b/c
    // once the value is "2", it never chooses diagonal again. Would need to look ahead,
    // possibly the entire path, to determine if a second diagonal move makes it worth it.
    const invDiagonalCostArr = Array(2);
    switch ( diagonalCost ) {
      case -1: // 1/2/1
        invDiagonalCostArr[0] = 1;
        invDiagonalCostArr[1] = 1 / 2;
        break;
      case -2: // 2/1/2
        invDiagonalCostArr[0] = 1 / 2;
        invDiagonalCostArr[1] = 1;
        break;
      default:
        invDiagonalCostArr[0] = 1 / diagonalCost;
        invDiagonalCostArr[1] = 1 / diagonalCost;
    }
    let diagonalOption = 0;

    // Walk from goal back to start, flowing "downhill."
    let safety = 0; // Safety to break infinite loops in bad maps.
    while ( distMap[idx] !== 0 && safety < area ) {
      safety += 1;
      let bestX = null;
      let bestY = null;
      let maxDrop = Number.NEGATIVE_INFINITY;
      let movedDiagonal = false;
      for ( const { dx, dy } of neighborOffsets ) {
        // Check bounds.
        const nX = currX + dx;
        if ( nX < 0 || nX >= width ) continue;

        const nY = currY + dy;
        if ( nY < 0 || nY >= height ) continue;

        // Get the cost for this neighbor.
        const neighborVal = neighborValueFn(currX, currY, dx, dy);

        // Relative cost: 1.0 for straight, custom cost for diagonal.
        const isDiagonal = !(dx === 0 || dy === 0);
        const moveCost = isDiagonal ? invDiagonalCostArr[diagonalOption] : 1.0;

        // Calculate efficiency of the move.
        const drop = (distMap[idx] - neighborVal) * moveCost;

        // We just want to roll "downhill" to 0.
        // Any neighbor with a lower value is a valid step towards home.
        if ( drop > maxDrop ) {
          maxDrop = drop;
          bestX = nX;
          bestY = nY;
          movedDiagonal = isDiagonal;
        }
      }
      if ( bestX === null || maxDrop <= 0 ) break; // We got stuck. Shouldn't happen in valid wavefront.
      currX = bestX;
      currY = bestY;
      idx = this.terrainMapper.indexAtLocal(currX, currY);
      path.push(bestX, bestY);
      if ( movedDiagonal ) diagonalOption = (diagonalOption + 1) % 2;
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

  #neighborValueManhattan(currX, currY, dx, dy) {
    const nX = currX + dx;
    const nY = currY + dy;
    const nIdx = this.terrainMapper.indexAtLocal(nX, nY);
    return this.distanceMap[nIdx];
  }

  #neighborValueWithDiagonals(currX, currY, dx, dy) {
    const isDiagonal = !(dx === 0 || dy === 0);
    const distMap = this.distanceMap;
    const nX = currX + dx;
    const nY = currY + dy;
    if ( isDiagonal ) {
      const cardXIdx = this.terrainMapper.indexAtLocal(nX, currY);
      const cardYIdx = this.terrainMapper.indexAtLocal(currX, nY);

      // If either cardinal adjacent pixel is a wall, do not cut the corner.
      if ( distMap[cardXIdx] >= 0xFFFFFFFF
        || distMap[cardYIdx] >= 0xFFFFFFFF ) return 0xFFFFFFFF;
    }
    const nIdx = this.terrainMapper.indexAtLocal(nX, nY);
    return distMap[nIdx];
  }

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
    // Example: Road(1) -> Straight=10. Swamp(5) -> Straight=50.
    let COST_STRAIGHT = 10u * tileCost;
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
 * Test using the GPU to write the terrain map.
 * Draw segments for the walls and flat triangles for everything else.
 */
class GPUTerrainMap {

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

  /**
   * @param {Uint16Array|Uint32Array} data
   * @returns {ArrayBuffer}
   */
  _createIndexBuffer(data) {
    // Calculate the aligned size (round up to nearest multiple of 4)
    // Indices must be Uint32 or Uint16
    const alignedSize = (data.byteLength + 3) & ~3;

    const buffer = this.device.createBuffer({
      size: alignedSize,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true,
    });
    new data.constructor(buffer.getMappedRange()).set(data);
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
    const commandEncoder = device.createCommandEncoder({ label: `Process ${bufferType} segments` });
    const buffer = this.buffers[`${bufferType}Terrain`];

    // Clear map before drawing.
    if ( clear ) commandEncoder.clearBuffer(buffer);
    if ( !segmentArr.length ) return; // Nothing to draw.

    // Either draw normal segments or erase segments for open doors.
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
    const commandEncoder = device.createCommandEncoder({ label: `Extract ${bufferType} data` });

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
    const commandEncoder = device.createCommandEncoder({ label: `Process ${bufferType} triangles` });
    const bindGroup = this.bindGroups[`${bufferType}Terrain`];
    const buffer = this.buffers[`${bufferType}Terrain`];

    // Clear map before drawing.
    if ( clear ) commandEncoder.clearBuffer(buffer);
    if ( !indices.length ) return; // Nothing to draw.

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
