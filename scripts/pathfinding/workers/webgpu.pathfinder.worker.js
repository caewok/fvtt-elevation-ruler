/* globals
GPUBufferUsage,
GPUMapMode,
GPUTextureUsage,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

// ----- NOTE: Properties ----- //

/** @type {WebGPUPathfinder} */
let pf;


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
  pf = new WebGPUPathfinder();
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
function updateBufferBlockingSegments({ segments, bufferType = "transient", clear = true, debug = false } = {}) { /* eslint-disable-line no-unused-vars */
  pf.terrainMapper.processBlockingSegments(segments, { bufferType, clear });
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
 * @param {Float32Array} buffer
 * @returns {[result: object, transfer: object[]}
 */
async function extractBufferData({ bufferType = "transient", buffer } = {}) { /* eslint-disable-line no-unused-vars */
  if ( bufferType === "distance" ) buffer.set(pf.distanceMap);
  else await pf.terrainMapper.extractBufferData(bufferType, buffer);
  return [{ buffer, width: pf.width }, [buffer.buffer]];
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
async function findPath({ startX = 0, startY = 0, endX = 0, endY = 0, _elevation = 0, signal = {}, _debug = false }) { /* eslint-disable-line no-unused-vars */
  const start = { x: startX, y: startY };
  const goal = { x: endX, y: endY };
  const path = await pf.findPath(start, goal, signal);
  return [{ path }, [path.buffer]];
}


/**
 * Helper for backtrackPath.
 * Stores the current value and the neighbor offsets.
 * @type {Int16Array[18]}
 */
const neighborBuffer = new ArrayBuffer(18 * Int16Array.BYTES_PER_ELEMENT);
const currDistMapPosition = new Int16Array(neighborBuffer, 0, 2);
const neighborOffsets = new Int16Array(neighborBuffer, 2 * Int16Array.BYTES_PER_ELEMENT, 16);

// Define the neighbor offsets.
// 8 coordinates. E.g., -1,-1, or 0,-1.
// L, R, T, B, TL, TR, BL, BR.
(() => {
  let i = 0;
  for ( let x = -1; x < 2; x += 1 ) {
    for ( let y = -1; y < 2; y += 1 ) {
      if ( !(x || y) ) continue; // Skip 0,0.
      neighborOffsets[i++] = x;
      neighborOffsets[i++] = y;
    }
  }
})();


/**
 * Get a path
 */
class WebGPUPathfinder {
  /**
   * Map of static terrain buffers for different elevations.
   * @type {Map<string, Terrain>}
   */
  static staticTerrainMap = new Map();


  // ----- NOTE: Constructor ----- //

  /** @type {number} */
  resolution = 1;


  // ----- NOTE: Initialize ----- //

  async initialize({ resolution = 1, sceneWidth, sceneHeight, translationX = 0, translationY = 0, debug = false } = {}) {
    this.resolution = resolution;
    await this.constructor.initializeDevice();
    if ( debug ) console.debug("WebGPUPathfinderWorker|Initialized device.");
    const gridWidth = Math.ceil(sceneWidth * resolution);
    const gridHeight = Math.ceil(sceneHeight * resolution);
    const uniforms = [sceneWidth, sceneHeight, gridWidth, gridHeight, translationX, translationY];
    this.terrainMapper = new GPUTerrainMap(uniforms, this.constructor.device);
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

  static STATUS = {
    CALCULATING: -1,
    NOT_READY: 0,
    READY: 1,
  };

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

  destroy() {
    this.buffers.read.unmap();
    this.distanceMap = null;
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

  constructor(uniforms, device) {
    this.uniforms.set(uniforms);
    this.device = device;
    this.#resolution = this.sceneDims[0] / this.gridDims[0];
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
    if ( x < 0 || y < 0 ) return -1;
    const [width, height] = this.gridDims;
    if ( x >= width || y >= height ) return -1;

    // Skip floor for speed; x and y should be integers.
    return (y * width) + x;
  }

  indexAtCanvas(x, y) {
    const local = this.fromCanvasCoordinates(x, y);
    return this.indexAtLocal(local.x, local.y);
  }

  fromCanvasCoordinates(x, y) {
    const [trX, trY] = this.sceneTranslation;
    const res = this.resolution;
    x = fastFixed((x - trX) / res);
    y = fastFixed((y - trY) / res);
    return { x, y };
  }

  toCanvasCoordinates(x, y) {
    const [trX, trY] = this.sceneTranslation;
    const res = this.resolution;
    x = fastFixed((x * res) + trX);
    y = fastFixed((y * res) + trY);
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
    segment: null,
    triangle: null,
    combine: null,
  };

  /** @type {object<WebGPUBindGroup} */
  bindGroups = {
    staticWalls: null,
    staticTerrain: null,
    subjectWalls: null,
    subjectTerrain: null,
    transientWalls: null,
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

    const fragmentDifficultTerrain = {
      module: shaderModule,
      entryPoint: "fs_difficult_terrain",
      targets: [{
        format,
        writeMask: 0, // IMPORTANT: Do not write to the dummy texture.
      }]
    };

    pipelines.segment = device.createRenderPipeline({
      label: "segment",
      layout: "auto",
      vertex,
      fragment: fragmentWall,
      primitive: { topology: "line-list" },
    });

    pipelines.triangle = device.createRenderPipeline({
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
      layout: pipelines.segment.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.staticTerrain } },
      ]
    });

    bindGroups.staticTerrain = device.createBindGroup({
      label: "staticTerrain",
      layout: pipelines.triangle.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.staticTerrain } },
      ]
    });

    bindGroups.subjectWalls = device.createBindGroup({
      label: "subjectWalls",
      layout: pipelines.segment.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.subjectTerrain } },
      ]
    });

    bindGroups.subjectTerrain = device.createBindGroup({
      label: "subjectTerrain",
      layout: pipelines.triangle.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.subjectTerrain } },
      ]
    });

    bindGroups.transientWalls = device.createBindGroup({
      label: "transientWalls",
      layout: pipelines.segment.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.uniform } },
        { binding: 1, resource: { buffer: buffers.transientTerrain } },
      ]
    });

    bindGroups.transientTerrain = device.createBindGroup({
      label: "transientTerrain",
      layout: pipelines.triangle.getBindGroupLayout(0),
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
  processBlockingSegments(segmentArr, { bufferType = "transient", clear = true } = {}) {
    const device = this.device;
    const commandEncoder = device.createCommandEncoder();
    const bindGroup = this.bindGroups[`${bufferType}Walls`];
    const buffer = this.buffers[`${bufferType}Terrain`];

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

    renderPass.setPipeline(this.pipelines.segment);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.draw(segmentArr.length / 2); // 2 floats per vertex
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
    renderPass.setPipeline(this.pipelines.triangle);
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

  // Convert scene coordinates (0 to res) to NDC (-1 to 1)
  let ndcX = (((pos.x - config.translation.x) / config.sceneRes.x)) * 2.0 - 1.0;
  let ndcY = 1.0 - (((pos.y - config.translation.y) / config.sceneRes.y) * 2.0); // Flip Y for screen space.
  out.pos = vec4<f32>(ndcX, ndcY, 0.0, 1.0);
  return out;
}

const WALL: u32 = 255u;

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

// ----- NOTE: Helper functions ----- //

/**
 * Fix a number to 8 decimal places
 * @param {number} x    Number to fix
 * @returns {number}
 */
const POW10_8 = Math.pow(10, 8);
function fastFixed(x) { return Math.round(x * POW10_8) / POW10_8; }


