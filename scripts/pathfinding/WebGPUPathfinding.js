/* globals
canvas,
GPUMapMode,
GPUBufferUsage,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { AbstractPathfinder } from "./AbstractPathfinder.js";
import { PixelCache } from "../geometry/PixelCache.js";

// TODO: import { FastBitSet } from "../FastBitSet/FastBitSet.js";


export class Terrain {
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

  get width() { return this.staticData.width; }

  get height() { return this.staticData.height; }

  get size() { return this.staticData.width * this.staticData.height; }

  constructor({ resolution = 1 } = {}) {
    const sceneRect = canvas.scene.dimensions.rect; // canvas.scene.dimensions.sceneRect;
    const scale = {
      resolution,
      x: sceneRect.x,
      y: sceneRect.y,
    };

    // Calculate the pixel grid for given resolution.
    const localWidth = Math.round(sceneRect.width * resolution);
    const localHeight = Math.round(sceneRect.height * resolution);
    const N = localWidth * localHeight;

    const fixedArr = new Uint32Array(N);
    this.staticData = new PixelCache(fixedArr, localWidth, { scale });
    this.staticData.pixels.fill(this.constructor.FEATURES.NORMAL);
    this.transientData = this.staticData.clone();
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
    this.staticData.pixels.fill(this.constructor.FEATURES.NORMAL);
    this.transientData.pixels.fill(this.constructor.FEATURES.NORMAL);
  }

  clearTransient() {
    this.transientData.pixels.fill(this.constructor.FEATURES.NORMAL);
  }

  /**
   * Mark the edges in the static data.
   * Does not mark transient data nor copy static to transient.
   * @param {Edge[]} [edges]        Edges to mark, if not the entire canvas
   */
  markEdges(edges) {
    edges ??= canvas.edges.getEdges(canvas.scene.dimensions.rect, {
      includeOuterBounds: false,
      includeInnerBounds: true
    });
    edges.forEach(edge => this.staticData.setPixelsUnderCanvasSegment(edge.a, edge.b, this.constructor.FEATURES.BLOCKING));
  }

  /**
   * Mark tokens in the transient data.
   * Does not otherwise clear or modify transient data.
   * @param {Token[]} [tokens]        Tokens to mark, if not the entire canvas
   */
  markTokens(tokens, value = this.constructor.FEATURES.BLOCKING) {
    tokens ??= canvas.tokens.placeables;
    tokens.forEach(token => this.transientData.setPixelsUnderCanvasShape(token.constrainedTokenBorder, value));
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

  async initializeWebGPU() {
    this.createTerrain({ resolution: this.resolution });
    this.terrain.markEdges();
    this.createPipeline();
    this.createBuffers();
  }

  /* Needed?
  initialize() {

  }

  async updateScene() {

  }
  */

  async findPath(start, end, _signal = {}) {
    // NOTE: uniform buffer already initialized.
    // NOTE: terrain buffer already initialized.
    console.time("GPU Pathfinding Setup");
    this._initializeDistanceBuffers(start);
    this._wavefrontPropagation();
    console.timeEnd("GPU Pathfinding Setup");
    console.time("GPU Pathfinding");
    await this._readResult();
    console.timeEnd("GPU Pathfinding");
    console.time("GPU Pathfinding backtrackPath");
    const out = this.backtrackPath(end);
    console.timeEnd("GPU Pathfinding backtrackPath");

    // TODO: Only need to rerun the webGPU if the start changes.
    // Otherwise just call backtrackPath.
  }

  _initializeDistanceBuffers(start) {
    // TODO: Create initialDist only once? Would take quite a bit of memory to keep around.
    // Distance Buffers (Ping-Pong)
    // Initialize: Start Node = 0, Others = MAX_INT
    const { width, size } = this.terrain;
    const initialDist = new Uint32Array(size).fill(0xFFFFFFFF);
    initialDist[(start.y * width) + start.x] = 0;
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
  }

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

  createBuffer(data, usage) {
    const buffer = this.constructor.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  createBindGroup(uniform, map, input, output) {
    return this.constructor.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: map } },
        { binding: 2, resource: { buffer: input } },
        { binding: 3, resource: { buffer: output } }
      ]
    });
  }

  createTerrain({ resolution = 1 } = {}) {
    this.terrain = new Terrain({ resolution });
  }

  buffers = {
    terrain: null,
    uniform: null,

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

  createBuffers() {
    const buffers = this.buffers;

    // Static terrain weights.
    buffers.terrain = this.createBuffer(this.terrain.staticData.pixels, GPUBufferUsage.STORAGE);

    // Distance Buffers (Ping-Pong)
    // Initialize: Start Node = 0, Others = MAX_INT
    const size = this.terrain.size;
    const initialDist = new Uint32Array(size).fill(0xFFFFFFFF);
    this.buffers.A = this.createBuffer(initialDist, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    this.buffers.B = this.createBuffer(initialDist, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);

    // Uniform Buffer (Dimensions)
    const { width, height } = this.terrain;
    const uniformData = new Uint32Array([width, height]);
    buffers.uniform = this.createBuffer(uniformData, GPUBufferUsage.UNIFORM);

    // 2. Create Bind Groups
    // Group A: Reads A, Writes B
    this.bindGroups.A = this.createBindGroup(buffers.uniform, buffers.terrain, buffers.A, buffers.B);

    // Group B: Reads B, Writes A
    this.bindGroups.B = this.createBindGroup(buffers.uniform, buffers.terrain, buffers.B, buffers.A);

    // Read-back buffer.
    buffers.read = this.constructor.device.createBuffer({
      size: size * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
    this.distanceMap = new Uint32Array(size);
  }


  backtrackPath(end) {
    const distMap = this.distanceMap;
    const { width, height } = this.terrain;
    const path = [];
    let curr = { ...end };
    let idx = (curr.y * width) + curr.x;

    if (distMap[idx] === 0xFFFFFFFF) return null; // No path found
    path.push({ ...curr });

    // Safety to break infinite loops in bad maps.
    let safety = 0;
    const MAX_STEPS = width * height;
    while (distMap[idx] !== 0 && safety < MAX_STEPS) {
      safety += 1;

      // Look for neighbor with strictly lower distance
      const neighbors = [
        // Straight
        { x: curr.x - 1, y: curr.y }, // Left
        { x: curr.x + 1, y: curr.y }, // Right
        { x: curr.x, y: curr.y - 1 }, // Top
        { x: curr.x, y: curr.y + 1 }, // Bottom

        // Diagonals
        { x: curr.x - 1, y: curr.y - 1 }, // Top Left
        { x: curr.x + 1, y: curr.y - 1 }, // Top Right
        { x: curr.x - 1, y: curr.y + 1 }, // Bottom Left
        { x: curr.x + 1, y: curr.y + 1 }, // Bottom Right
      ];

      let bestNode = null;
      let lowestDist = distMap[idx]; // Starts with the current distance.

      // Find the neighbor with the strictly lowest distance value.
      for ( let n of neighbors ) {
        // Boundary checks
        if ( n.x >= 0 && n.x < width && n.y >= 0 && n.y < height ) {
          let nIdx = (n.y * width) + n.x;
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
        idx = (curr.y * width) + curr.x;
        path.push({ ...curr });
      } else break; // We got stuck. Shouldn't happen in valid wavefront.
    }
    return path.reverse();
  }

  static shaderCode = `
struct GridInfo { width: u32, height: u32 };

@group(0) @binding(0) var<uniform> grid: GridInfo;

// terrainMap holds weights.
// e.g. 1 = Road, 5 = Grass, 255 = Wall
@group(0) @binding(1) var<storage, read> terrainMap: array<u32>;
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
await pf.initializeWebGPU()
path = await pf.findPath(start, end)


distMap = new PixelCache(pf.distanceMap, pf.terrain.width)
distMap.draw({ local: true, skip: 50 })


*/


/*
for ( let x = 0; x < 100; x += 1 ) {
  for ( let y = 0; y < 100; y += 1 ) {
    Draw.point({ x, y}, { color: Draw.COLORS.red, radius: 1 })
  }
}
*/


