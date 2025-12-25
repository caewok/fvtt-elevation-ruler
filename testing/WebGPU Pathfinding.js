/* GPU pathfinding test

Implementing a pathfinding algorithm on the GPU requires a different mindset than CPU-based approaches (like A*). CPU algorithms rely on priority queues and sequential processing, which are difficult to parallelize.

On the GPU, the most effective technique is a **Parallel Wavefront Algorithm** (essentially a parallel Breadth-First Search or Bellman-Ford).

Here is a complete implementation using WebGPU.

### The Logic: Wavefront Propagation

Instead of a single "walker" exploring the map, every cell on the grid calculates its distance simultaneously.

1. **Initialization:** The Start Node is `0`. All other nodes are `Infinity`. Walls are marked.
2. **Propagation (Compute Shader):** In every frame, every cell looks at its four neighbors (Up, Down, Left, Right). If a neighbor has a distance value of , the current cell updates its distance to  (assuming it is smaller than its current value).
3. **Iteration:** We swap buffers (Ping-Pong) and repeat until the "wave" reaches the destination or covers the map.
4. **Backtracking:** Once the distance field is generated, we trace the path from **End -> Start** by always moving to the neighbor with the lowest value.

---

### 1. The WGSL Shader (`pathfinding.wgsl`)

This shader runs for every single cell on your grid in parallel.

```rust
// WGSL
struct GridInfo {
    width: u32,
    height: u32,
};

@group(0) @binding(0) var<uniform> grid: GridInfo;
@group(0) @binding(1) var<storage, read> mapState: array<u32>; // 0 = Walkable, 1 = Wall
@group(0) @binding(2) var<storage, read> inputDist: array<u32>;
@group(0) @binding(3) var<storage, read_write> outputDist: array<u32>;

fn get_index(x: u32, y: u32) -> u32 {
    return y * grid.width + x;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= grid.width || y >= grid.height) {
        return;
    }

    let index = get_index(x, y);

    // If this cell is a wall, keep distance at MAX
    if (mapState[index] == 1u) {
        outputDist[index] = 0xFFFFFFFFu;
        return;
    }

    let current_val = inputDist[index];
    var min_neighbor = 0xFFFFFFFFu;

    // Check 4 Neighbors (Boundary Checked)
    // Left
    if (x > 0u) { min_neighbor = min(min_neighbor, inputDist[get_index(x - 1u, y)]); }
    // Right
    if (x < grid.width - 1u) { min_neighbor = min(min_neighbor, inputDist[get_index(x + 1u, y)]); }
    // Up
    if (y > 0u) { min_neighbor = min(min_neighbor, inputDist[get_index(x, y - 1u)]); }
    // Down
    if (y < grid.height - 1u) { min_neighbor = min(min_neighbor, inputDist[get_index(x, y + 1u)]); }

    // Update Logic: If a neighbor + 1 is better than what we have, take it.
    // We use safe math to prevent overflow of Infinity (0xFFFFFFFF)
    if (min_neighbor != 0xFFFFFFFFu) {
        outputDist[index] = min(current_val, min_neighbor + 1u);
    } else {
        outputDist[index] = current_val;
    }
}

```

---

### 2. The JavaScript Implementation

This class handles the WebGPU setup, the "Ping-Pong" buffer swapping, and execution.

```javascript
class GPUPathfinder {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.device = null;
        this.pipeline = null;
    }

    async init() {
        if (!navigator.gpu) throw new Error("WebGPU not supported");
        const adapter = await navigator.gpu.requestAdapter();
        this.device = await adapter.requestDevice();

        // Compile Shader
        const shaderModule = this.device.createShaderModule({
            code: `
                struct GridInfo { width: u32, height: u32 };
                @group(0) @binding(0) var<uniform> grid: GridInfo;
                @group(0) @binding(1) var<storage, read> mapState: array<u32>;
                @group(0) @binding(2) var<storage, read> inputDist: array<u32>;
                @group(0) @binding(3) var<storage, read_write> outputDist: array<u32>;

                fn get_idx(x: u32, y: u32) -> u32 { return y * grid.width + x; }

                @compute @workgroup_size(8, 8)
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    let x = id.x; let y = id.y;
                    if (x >= grid.width || y >= grid.height) { return; }
                    let idx = get_idx(x, y);

                    // 1u represents a WALL.
                    if (mapState[idx] == 1u) { outputDist[idx] = 0xFFFFFFFFu; return; }

                    let current = inputDist[idx];
                    var best = 0xFFFFFFFFu;

                    if (x > 0u) { best = min(best, inputDist[get_idx(x - 1u, y)]); }
                    if (x < grid.width - 1u) { best = min(best, inputDist[get_idx(x + 1u, y)]); }
                    if (y > 0u) { best = min(best, inputDist[get_idx(x, y - 1u)]); }
                    if (y < grid.height - 1u) { best = min(best, inputDist[get_idx(x, y + 1u)]); }

                    if (best != 0xFFFFFFFFu) { outputDist[idx] = min(current, best + 1u); }
                    else { outputDist[idx] = current; }
                }
            `
        });

        this.pipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' }
        });
    }

    async findPath(mapData, start, end) {
        const size = this.width * this.height;
        const device = this.device;

        // 1. Prepare Initial Data
        // Map Buffer: 0 = Walkable, 1 = Wall
        const mapBuffer = this.createBuffer(new Uint32Array(mapData), GPUBufferUsage.STORAGE);

        // Distance Buffers (Ping-Pong)
        // Initialize: Start Node = 0, Others = MAX_INT
        const initialDist = new Uint32Array(size).fill(0xFFFFFFFF);
        initialDist[start.y * this.width + start.x] = 0;

        let bufferA = this.createBuffer(initialDist, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        let bufferB = this.createBuffer(initialDist, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);

        // Uniform Buffer (Dimensions)
        const uniformData = new Uint32Array([this.width, this.height]);
        const uniformBuffer = this.createBuffer(uniformData, GPUBufferUsage.UNIFORM);

        // 2. Create Bind Groups
        // Group A: Reads A, Writes B
        const bindGroupA = this.createBindGroup(uniformBuffer, mapBuffer, bufferA, bufferB);
        // Group B: Reads B, Writes A
        const bindGroupB = this.createBindGroup(uniformBuffer, mapBuffer, bufferB, bufferA);

        // 3. Execute Wavefront Propagation
        const commandEncoder = device.createCommandEncoder();
        const pass = commandEncoder.beginComputePass();
        pass.setPipeline(this.pipeline);

        // Iterate enough times to cover the map (Manhattan distance approx)
        // For a generic grid, Width + Height is a safe upper bound.
        const iterations = this.width + this.height;

        for (let i = 0; i < iterations; i++) {
            // Swap bind groups every iteration
            pass.setBindGroup(0, i % 2 === 0 ? bindGroupA : bindGroupB);
            pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
        }
        pass.end();

        // 4. Read Results
        // The final result is in Buffer A if iterations is even, Buffer B if odd.
        const finalBuffer = (iterations % 2 === 0) ? bufferA : bufferB;

        // Copy to read-back buffer
        const readBuffer = device.createBuffer({
            size: size * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        commandEncoder.copyBufferToBuffer(finalBuffer, 0, readBuffer, 0, size * 4);

        device.queue.submit([commandEncoder.finish()]);

        // 5. Decode on CPU
        await readBuffer.mapAsync(GPUMapMode.READ);
        const resultArray = new Uint32Array(readBuffer.getMappedRange());

        // Reconstruct path by walking backwards from End
        const path = this.backtrackPath(resultArray, end);

        // Cleanup
        readBuffer.unmap();
        // ( Ideally, destroy all buffers here to prevent leaks )

        return path;
    }

    createBuffer(data, usage) {
        const buffer = this.device.createBuffer({
            size: data.byteLength,
            usage: usage | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        new Uint32Array(buffer.getMappedRange()).set(data);
        buffer.unmap();
        return buffer;
    }

    createBindGroup(uniform, map, input, output) {
        return this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniform } },
                { binding: 1, resource: { buffer: map } },
                { binding: 2, resource: { buffer: input } },
                { binding: 3, resource: { buffer: output } }
            ]
        });
    }

    backtrackPath(distMap, end) {
        const path = [];
        let curr = { ...end };
        let idx = curr.y * this.width + curr.x;

        if (distMap[idx] === 0xFFFFFFFF) return null; // No path found

        while (distMap[idx] !== 0) {
            path.push({ ...curr });

            // Look for neighbor with strictly lower distance
            const neighbors = [
                { x: curr.x - 1, y: curr.y },
                { x: curr.x + 1, y: curr.y },
                { x: curr.x, y: curr.y - 1 },
                { x: curr.x, y: curr.y + 1 }
            ];

            let found = false;
            let currentDist = distMap[idx];

            for (let n of neighbors) {
                if (n.x >= 0 && n.x < this.width && n.y >= 0 && n.y < this.height) {
                    let nIdx = n.y * this.width + n.x;
                    if (distMap[nIdx] < currentDist) {
                        curr = n;
                        idx = nIdx;
                        found = true;
                        break;
                    }
                }
            }
            if (!found) break; // Should not happen if path exists
        }
        path.push(curr); // Add start node
        return path.reverse();
    }
}

```

### 3. How to Run It

You can use the class above in an async function like this:

```javascript
(async () => {
    const width = 20;
    const height = 20;
    const pf = new GPUPathfinder(width, height);
    await pf.init();

    // Create a simple map (0 = empty, 1 = wall)
    // Let's make a wall in the middle
    const map = new Uint32Array(width * height).fill(0);
    for(let y = 5; y < 15; y++) map[y * width + 10] = 1;

    const start = { x: 2, y: 10 };
    const end = { x: 18, y: 10 };

    console.time("GPU Pathfinding");
    const path = await pf.findPath(map, start, end);
    console.timeEnd("GPU Pathfinding");

    console.log("Path found:", path);
})();

```

### Key Considerations

* **Ping-Pong Buffers:** Because we cannot read and write to the same buffer reliably within the same dispatch without race conditions, we toggle between `bufferA` and `bufferB`.
* **Performance:** For small grids (), the CPU is faster due to the overhead of moving data to the GPU. This GPU approach shines with massive grids (e.g.,  or agent simulations) where you can calculate flow fields for thousands of units simultaneously.
* **Optimization:** In a production environment, you would not create new buffers (`createBuffer`) every time you call `findPath`. You would allocate them once and reuse them, only uploading new map data when the terrain changes.

Would you like me to extend this to include diagonal movement or different terrain costs?

To enable diagonal movement, we need to modify the logic in two places:

1. **The Shader:** We must check 8 neighbors instead of 4.
2. **The Backtracker (CPU):** The path reconstruction must also look at diagonal options to find the path back to the start.

### The "10 vs. 14" Rule

If we treat diagonal movement as a cost of `1` (same as straight), the pathfinder will generate "zigzag" paths that look unnatural because it thinks moving diagonally is just as fast as moving straight.

To fix this efficiently using integers (which GPUs love), we use the **10-14 approximation**:

* **Straight Step:** Cost = **10**
* **Diagonal Step:** Cost = **14** ()

---

### 1. Updated Shader (`pathfinding.wgsl`)

We update the shader to sample all 8 neighbors and apply the specific costs.

```rust
// WGSL
struct GridInfo {
    width: u32,
    height: u32,
};

@group(0) @binding(0) var<uniform> grid: GridInfo;
@group(0) @binding(1) var<storage, read> mapState: array<u32>;
@group(0) @binding(2) var<storage, read> inputDist: array<u32>;
@group(0) @binding(3) var<storage, read_write> outputDist: array<u32>;

fn get_idx(x: u32, y: u32) -> u32 {
    return y * grid.width + x;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;

    if (x >= grid.width || y >= grid.height) { return; }

    let idx = get_idx(x, y);

    // Wall Check
    if (mapState[idx] == 1u) {
        outputDist[idx] = 0xFFFFFFFFu;
        return;
    }

    let current_val = inputDist[idx];
    var best_new_val = 0xFFFFFFFFu;

    // Costs
    let COST_STRAIGHT = 10u;
    let COST_DIAG = 14u;
    let MAX_VAL = 0xFFFFFFFFu;

    // --- Check Straight Neighbors (Cost 10) ---
    // Left
    if (x > 0u) {
        let v = inputDist[get_idx(x - 1u, y)];
        if (v != MAX_VAL) { best_new_val = min(best_new_val, v + COST_STRAIGHT); }
    }
    // Right
    if (x < grid.width - 1u) {
        let v = inputDist[get_idx(x + 1u, y)];
        if (v != MAX_VAL) { best_new_val = min(best_new_val, v + COST_STRAIGHT); }
    }
    // Up
    if (y > 0u) {
        let v = inputDist[get_idx(x, y - 1u)];
        if (v != MAX_VAL) { best_new_val = min(best_new_val, v + COST_STRAIGHT); }
    }
    // Down
    if (y < grid.height - 1u) {
        let v = inputDist[get_idx(x, y + 1u)];
        if (v != MAX_VAL) { best_new_val = min(best_new_val, v + COST_STRAIGHT); }
    }

    // --- Check Diagonal Neighbors (Cost 14) ---
    // Top-Left
    if (x > 0u && y > 0u) {
        let v = inputDist[get_idx(x - 1u, y - 1u)];
        if (v != MAX_VAL) { best_new_val = min(best_new_val, v + COST_DIAG); }
    }
    // Top-Right
    if (x < grid.width - 1u && y > 0u) {
        let v = inputDist[get_idx(x + 1u, y - 1u)];
        if (v != MAX_VAL) { best_new_val = min(best_new_val, v + COST_DIAG); }
    }
    // Bottom-Left
    if (x > 0u && y < grid.height - 1u) {
        let v = inputDist[get_idx(x - 1u, y + 1u)];
        if (v != MAX_VAL) { best_new_val = min(best_new_val, v + COST_DIAG); }
    }
    // Bottom-Right
    if (x < grid.width - 1u && y < grid.height - 1u) {
        let v = inputDist[get_idx(x + 1u, y + 1u)];
        if (v != MAX_VAL) { best_new_val = min(best_new_val, v + COST_DIAG); }
    }

    // Update
    if (best_new_val != MAX_VAL) {
        outputDist[idx] = min(current_val, best_new_val);
    } else {
        outputDist[idx] = current_val;
    }
}

```

---

### 2. Updated Backtracker (JavaScript)

The `backtrackPath` method in the Javascript class must now scan 8 neighbors and pick the one that lowers the distance the most.

**Note:** Unlike the shader (where we add cost), when backtracking we are looking for the neighbor with the **lowest absolute value**.

```javascript
    backtrackPath(distMap, end) {
        const path = [];
        let curr = { ...end };
        let idx = curr.y * this.width + curr.x;

        // If end is unreachable
        if (distMap[idx] === 0xFFFFFFFF) return null;

        path.push({ ...curr });

        // Safety break to prevent infinite loops in bad maps
        let safety = 0;
        const maxSteps = this.width * this.height;

        while (distMap[idx] !== 0 && safety < maxSteps) {
            safety++;

            // Define all 8 neighbors
            const neighbors = [
                // Straight
                { x: curr.x - 1, y: curr.y },
                { x: curr.x + 1, y: curr.y },
                { x: curr.x, y: curr.y - 1 },
                { x: curr.x, y: curr.y + 1 },
                // Diagonals
                { x: curr.x - 1, y: curr.y - 1 }, // Top Left
                { x: curr.x + 1, y: curr.y - 1 }, // Top Right
                { x: curr.x - 1, y: curr.y + 1 }, // Bot Left
                { x: curr.x + 1, y: curr.y + 1 }  // Bot Right
            ];

            let bestNode = null;
            let lowestDist = distMap[idx]; // Start with current distance

            // Find the neighbor with the strictly lowest distance value
            for (let n of neighbors) {
                // Boundary checks
                if (n.x >= 0 && n.x < this.width && n.y >= 0 && n.y < this.height) {
                    let nIdx = n.y * this.width + n.x;
                    let val = distMap[nIdx];

                    // We just want to roll "downhill" to 0.
                    // Any neighbor with a lower value is a valid step towards home.
                    if (val < lowestDist) {
                        lowestDist = val;
                        bestNode = n;
                        // Optimization: You could break here if you don't care about "perfect" path smoothness,
                        // but iterating all 8 ensures we pick the steepest descent.
                    }
                }
            }

            if (bestNode) {
                curr = bestNode;
                idx = curr.y * this.width + curr.x;
                path.push({ ...curr });
            } else {
                // If we get stuck (shouldn't happen in valid wavefront), break
                break;
            }
        }

        return path.reverse();
    }

```

### 3. Usage Changes

The usage script remains exactly the same. However, you will notice that the `iterations` loop in the main class might need to be slightly higher in worst-case scenarios, though usually `width + height` is still sufficient.

If you are dealing with very complex mazes with diagonals, a safer iteration count is:

```javascript
// A safe upper bound for diagonal traversal
const iterations = Math.max(this.width, this.height) * 1.5;

```

### Does this handle "Corner Cutting"?

This implementation **allows** corner cutting (walking diagonally even if one of the adjacent cardinal corners is a wall).

**Example:**

```text
[ ] [X]  <-- Can you move from Bottom-Left to Top-Right?
[S] [ ]      If yes, this code works perfectly.

```

If you want to **prevent** corner cutting (e.g., you can't squeeze between two diagonal walls), you would need to add logic inside the shader's diagonal checks:

```rust
// Inside Shader: Strict Diagonal Check (Top-Left example)
if (x > 0u && y > 0u) {
    let left_wall = mapState[get_idx(x - 1u, y)] == 1u;
    let up_wall = mapState[get_idx(x, y - 1u)] == 1u;

    // Only process diagonal if adjacent cardinals are NOT walls
    if (!left_wall && !up_wall) {
         let v = inputDist[get_idx(x - 1u, y - 1u)];
         if (v != MAX_VAL) { best_new_val = min(best_new_val, v + COST_DIAG); }
    }
}

```

Would you like me to create the logic for **dynamic terrain costs** (like mud or roads)?
*/

class GPUPathfinder {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.device = null;
        this.pipeline = null;
    }

    async init() {
        if (!navigator.gpu) throw new Error("WebGPU not supported");
        const adapter = await navigator.gpu.requestAdapter();
        this.device = await adapter.requestDevice();

        // Compile Shader
        const shaderModule = this.device.createShaderModule({
            code: `
                struct GridInfo { width: u32, height: u32 };
                @group(0) @binding(0) var<uniform> grid: GridInfo;
                @group(0) @binding(1) var<storage, read> mapState: array<u32>;
                @group(0) @binding(2) var<storage, read> inputDist: array<u32>;
                @group(0) @binding(3) var<storage, read_write> outputDist: array<u32>;

                fn get_idx(x: u32, y: u32) -> u32 { return y * grid.width + x; }

                @compute @workgroup_size(8, 8)
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    let x = id.x; let y = id.y;
                    if (x >= grid.width || y >= grid.height) { return; }
                    let idx = get_idx(x, y);

                    // 1u represents a WALL.
                    if (mapState[idx] == 1u) { outputDist[idx] = 0xFFFFFFFFu; return; }

                    let current = inputDist[idx];
                    var best = 0xFFFFFFFFu;

                    if (x > 0u) { best = min(best, inputDist[get_idx(x - 1u, y)]); }
                    if (x < grid.width - 1u) { best = min(best, inputDist[get_idx(x + 1u, y)]); }
                    if (y > 0u) { best = min(best, inputDist[get_idx(x, y - 1u)]); }
                    if (y < grid.height - 1u) { best = min(best, inputDist[get_idx(x, y + 1u)]); }

                    if (best != 0xFFFFFFFFu) { outputDist[idx] = min(current, best + 1u); }
                    else { outputDist[idx] = current; }
                }
            `
        });

        this.pipeline = this.device.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' }
        });
    }

    async findPath(mapData, start, end) {
        const size = this.width * this.height;
        const device = this.device;

        // 1. Prepare Initial Data
        // Map Buffer: 0 = Walkable, 1 = Wall
        const mapBuffer = this.createBuffer(new Uint32Array(mapData), GPUBufferUsage.STORAGE);

        // Distance Buffers (Ping-Pong)
        // Initialize: Start Node = 0, Others = MAX_INT
        const initialDist = new Uint32Array(size).fill(0xFFFFFFFF);
        initialDist[start.y * this.width + start.x] = 0;

        let bufferA = this.createBuffer(initialDist, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
        let bufferB = this.createBuffer(initialDist, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);

        // Uniform Buffer (Dimensions)
        const uniformData = new Uint32Array([this.width, this.height]);
        const uniformBuffer = this.createBuffer(uniformData, GPUBufferUsage.UNIFORM);

        // 2. Create Bind Groups
        // Group A: Reads A, Writes B
        const bindGroupA = this.createBindGroup(uniformBuffer, mapBuffer, bufferA, bufferB);
        // Group B: Reads B, Writes A
        const bindGroupB = this.createBindGroup(uniformBuffer, mapBuffer, bufferB, bufferA);

        // 3. Execute Wavefront Propagation
        const commandEncoder = device.createCommandEncoder();
        const pass = commandEncoder.beginComputePass();
        pass.setPipeline(this.pipeline);

        // Iterate enough times to cover the map (Manhattan distance approx)
        // For a generic grid, Width + Height is a safe upper bound.
        const iterations = this.width + this.height;

        for (let i = 0; i < iterations; i++) {
            // Swap bind groups every iteration
            pass.setBindGroup(0, i % 2 === 0 ? bindGroupA : bindGroupB);
            pass.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
        }
        pass.end();

        // 4. Read Results
        // The final result is in Buffer A if iterations is even, Buffer B if odd.
        const finalBuffer = (iterations % 2 === 0) ? bufferA : bufferB;

        // Copy to read-back buffer
        const readBuffer = device.createBuffer({
            size: size * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        commandEncoder.copyBufferToBuffer(finalBuffer, 0, readBuffer, 0, size * 4);

        device.queue.submit([commandEncoder.finish()]);

        // 5. Decode on CPU
        await readBuffer.mapAsync(GPUMapMode.READ);
        const resultArray = new Uint32Array(readBuffer.getMappedRange());

        // Reconstruct path by walking backwards from End
        const path = this.backtrackPath(resultArray, end);

        // Cleanup
        readBuffer.unmap();
        // ( Ideally, destroy all buffers here to prevent leaks )

        return path;
    }

    createBuffer(data, usage) {
        const buffer = this.device.createBuffer({
            size: data.byteLength,
            usage: usage | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true
        });
        new Uint32Array(buffer.getMappedRange()).set(data);
        buffer.unmap();
        return buffer;
    }

    createBindGroup(uniform, map, input, output) {
        return this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: uniform } },
                { binding: 1, resource: { buffer: map } },
                { binding: 2, resource: { buffer: input } },
                { binding: 3, resource: { buffer: output } }
            ]
        });
    }

    backtrackPath(distMap, end) {
        const path = [];
        let curr = { ...end };
        let idx = curr.y * this.width + curr.x;

        if (distMap[idx] === 0xFFFFFFFF) return null; // No path found

        while (distMap[idx] !== 0) {
            path.push({ ...curr });

            // Look for neighbor with strictly lower distance
            const neighbors = [
                { x: curr.x - 1, y: curr.y },
                { x: curr.x + 1, y: curr.y },
                { x: curr.x, y: curr.y - 1 },
                { x: curr.x, y: curr.y + 1 }
            ];

            let found = false;
            let currentDist = distMap[idx];

            for (let n of neighbors) {
                if (n.x >= 0 && n.x < this.width && n.y >= 0 && n.y < this.height) {
                    let nIdx = n.y * this.width + n.x;
                    if (distMap[nIdx] < currentDist) {
                        curr = n;
                        idx = nIdx;
                        found = true;
                        break;
                    }
                }
            }
            if (!found) break; // Should not happen if path exists
        }
        path.push(curr); // Add start node
        return path.reverse();
    }
}

Draw = CONFIG.GeometryLib.Draw


width = 20;
height = 20;
pf = new GPUPathfinder(width, height);
await pf.init();

// Create a simple map (0 = empty, 1 = wall)
// Let's make a wall in the middle
map = new Uint32Array(width * height).fill(0);
for(let y = 5; y < 15; y++) map[y * width + 10] = 1;

start = { x: 2, y: 10 };
end = { x: 18, y: 10 };

console.time("GPU Pathfinding");
path = await pf.findPath(map, start, end);
console.timeEnd("GPU Pathfinding");

console.log("Path found:", path);


function drawMap(map, { width, height, scale = 100 } = {}) {
  height ??= Math.floor(Math.sqrt(map.length));
  width ??= height;
  const drawOpts = { radius: Math.sqrt(scale), color: Draw.COLORS.red };
  const border = new PIXI.Rectangle(0, 0, width * scale, height * scale)
  Draw.shape(border, { color: Draw.COLORS.blue, fill: Draw.COLORS.blue, fillAlpha: 0.2 })

  for ( let i = 0; i < map.length; i += 1 ) {
    if ( !map[i] ) continue;
    const x = Math.floor(i % width) * scale;
    const y = Math.floor(i / width) * scale;
    // console.log(`${i}: ${x},${y}`)
    Draw.point({x, y}, drawOpts);
  }
}

function drawPath(path, { scale = 100 } = {}) {
  path = path.map(pt => {
    return { x: pt.x * scale, y: pt.y * scale}
  });
  const drawOpts = { radius: Math.sqrt(scale), color: Draw.COLORS.green };
  Draw.connectPoints(path, drawOpts)
  path.forEach(pt => Draw.point(pt, drawOpts));
  Draw.point(path[0], { radius: drawOpts.radius + 1, color: Draw.lightgreen})
  Draw.point(path.at(-1), { radius: drawOpts.radius + 1, color: Draw.lightorange})
}


