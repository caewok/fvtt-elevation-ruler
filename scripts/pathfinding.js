
Draw = CONFIG.GeometryLib.Draw;



wall0 = canvas.placeables.walls[0]
wall1 = canvas.placeables.walls[1]



/* Need to be able to identify points at open walls.
Types:
                   •
Open wall:   ------  •
                   •

Need three points to navigate around the wall from any position w/o running into the wall.

Convex wall:   ------ •
                    |

No point on inside b/c it does not represent valid position.
Can use one point so long as it is exactly halfway on the outside (larger) angle

180º wall:  ----- ------   No point needed.

Points are all 2d, so we can use PIXI.Point keys with a set.
*/


/* Visibility Point
{number} key        PIXI.Point key of the endpoint.
{PIXI.Point} dir    Directional vector. Used
{PIXI.Point} loc    coordinate of the endpoint
{Set<Wall>} walls   Walls linked to this endpoint
*/

let { Graph, GraphVertex, GraphEdge } = CONFIG.GeometryLib.Graph;

Draw.clearDrawings()
visibilityPoints = new Map();
calculateVisibilityPoints();
drawVisibilityPoints()


/* Build graph
For each visibility point, scale it out by some distance based on the grid.
Center on the grid square.
Use a key and a map, making each GraphVertex a location.

GraphEdge connects if there is visibility (no collisions) between the two vertices.
*/

// Probably need some sort of tracking so change to wall can modify the correct points.
scaledVisibilityPoints = new Set();
spacer = 100;
for ( const [key, pts] of visibilityPoints.entries() ) {
  const endpoint = PIXI.Point.invertKey(key);
  for ( const pt of pts ) {
    const scaledPoint = endpoint.add(pt.multiplyScalar(spacer));
    const center = canvas.grid.grid.getCenter(scaledPoint.x, scaledPoint.y);
    scaledVisibilityPoints.add((new PIXI.Point(center[0], center[1])).key);
  }
}

// Visibility test to construct the edges.
graph = new Graph();

vertices = scaledVisibilityPoints.map(key => new GraphVertex(key));
verticesArr = [...vertices];
nVertices = verticesArr.length;
collisionCfg = { mode: "any", type: "move" }
for ( let i = 0; i < nVertices; i += 1 ) {
  const iV = verticesArr[i];
  const iPt = PIXI.Point.invertKey(iV.value)
  for ( let j = i + 1; j < nVertices; j += 1 ) {
    const jV = verticesArr[j];
    const jPt = PIXI.Point.invertKey(jV.value);
    // if ( CONFIG.Canvas.polygonBackends.move.testCollision(iPt, jPt, collisionCfg) ) continue;

    const distance = canvas.grid.grid.measureDistances([{ ray: new Ray(iPt, jPt) }])[0];
    graph.addEdgeVertices(iV, jV, distance);
  }
}

// For each vertex, keep the best N edges that don't have a collision.
// Store these edges in a new graph
trimmedGraph = new Graph();
MAX_EDGES = 4;
for ( const vertex of graph.getAllVertices() ) {
  const edges = vertex.edges.sort((a, b) => a.weight - b.weight);
  let n = 1;
  for ( const edge of edges ) {
    if ( n > MAX_EDGES ) break;
    const A = PIXI.Point.invertKey(edge.A.value);
    const B = PIXI.Point.invertKey(edge.B.value);
    if ( CONFIG.Canvas.polygonBackends.move.testCollision(A, B, collisionCfg) ) continue;
    n += 1;
    trimmedGraph.addEdge(edge);
  }
}



// Draw graph vertices
vertices = graph.getAllVertices();
for ( const vertex of vertices ) {
  Draw.point(PIXI.Point.invertKey(vertex.value), { color: Draw.COLORS.green });
}

// Draw the graph edges
edges = graph.getAllEdges();
for ( const edge of edges ) {
  const A = PIXI.Point.invertKey(edge.A.value);
  const B = PIXI.Point.invertKey(edge.B.value);
  Draw.segment({ A, B })
}

edges = trimmedGraph.getAllEdges();
for ( const edge of edges ) {
  const A = PIXI.Point.invertKey(edge.A.value);
  const B = PIXI.Point.invertKey(edge.B.value);
  Draw.segment({ A, B }, { color: Draw.COLORS.green })
}









function drawVisibilityPoints(spacer = 100) {
  for ( const [key, pts] of visibilityPoints.entries() ) {
    const endpoint = PIXI.Point.invertKey(key);
    for ( const pt of pts ) {
      Draw.point(endpoint.add(pt.multiplyScalar(spacer)));
    }
  }

}


function calculateVisibilityPoints() {
  const A = new PIXI.Point();
  const B = new PIXI.Point()
  for (const wall of canvas.walls.placeables ) {
    A.copyFrom(wall.vertices.a);
    B.copyFrom(wall.vertices.b);

    // Determine the visibility point direction(s) for A and B
    if ( !visibilityPoints.has(A.key) ) visibilityPoints.set(A.key, findVisibilityDirections(A, B));
    if ( !visibilityPoints.has(B.key) ) visibilityPoints.set(B.key, findVisibilityDirections(B, A));
  }
}





let PI2 = Math.PI * 2;
function findVisibilityDirections(endpoint, other) {
  const key = endpoint.key;
  const linkedWalls = canvas.walls.placeables.filter(w => w.wallKeys.has(key))
  if ( !linkedWalls.length ) return []; // Shouldn't happen.
  if ( linkedWalls.length < 2 ) {
    // Open wall point. Needs three visibility points.
    const dir = endpoint.subtract(other).normalize();
    return [ dir, new PIXI.Point(-dir.y, dir.x), new PIXI.Point(dir.y, -dir.x) ];
  }

  // Find the maximum angle between all the walls.
  // Test each wall combination once.
  let maxAngle = 0;
  // let clockwise = true;
  let aEndpoint;
  let cEndpoint;

  const nWalls = linkedWalls.length;
  for ( let i = 0; i < nWalls; i += 1 ) {
    const iWall = linkedWalls[i];
    const a = iWall.vertices.a.key === key ? iWall.vertices.b : iWall.vertices.a;
    for ( let j = i + 1; j < nWalls; j += 1 ) {
      const jWall = linkedWalls[j];
      const c = jWall.vertices.a.key === key ? jWall.vertices.b : jWall.vertices.a;
      const angleI = PIXI.Point.angleBetween(a, endpoint, c, { clockwiseAngle: true });
      if ( angleI.almostEqual(Math.PI) ) return []; // 180º, precludes any other direction from being > 180º.

      if ( angleI > Math.PI & angleI > maxAngle ) {
        maxAngle = angleI;
        //clockwise = true;
        aEndpoint = a;
        cEndpoint = c;
      } else if ( (PI2 - angleI) > maxAngle ) {
        maxAngle = PI2 - angleI;
        //clockwise = false;
        aEndpoint = a;
        cEndpoint = c;
      }
    }
  }

  // Calculate the direction for 1/2 of the maximum angle
  const ab = endpoint.subtract(aEndpoint).normalize();
  const cb = endpoint.subtract(cEndpoint).normalize();
  return [ab.add(cb).multiplyScalar(0.5).normalize()];

  // To test:
  // res = ab.add(cb).multiplyScalar(0.5);
  // Draw.point(endpoint.add(res.multiplyScalar(100)))
}



// Alternative: Triangulate
/*
Take the 4 corners plus coordinates of each wall endpoint.
(TODO: Use wall edges to capture overlapping walls)

Triangulate.

Can traverse using the half-edge structure.

Start in a triangle. For now, traverse between triangles at midpoints.
Triangle coords correspond to a wall. Each triangle edge may or may not block.
Can either look up the wall or just run collision between the two triangle midpoints (probably the latter).
This handles doors, one-way walls, etc., and limits when the triangulation must be re-done.

Each triangle can represent terrain. Triangle terrain is then used to affect the distance value.
Goal heuristic based on distance (modified by terrain?).
Alternatively, apply terrain only when moving. But should still triangulate terrain so can move around it.

Ultimately traverse by choosing midpoint or points 1 grid square from each endpoint on the edge.

*/



endpointKeys = new Set();
for ( const wall of [...canvas.walls.placeables, ...canvas.walls.outerBounds] ) {
  endpointKeys.add(wall.vertices.a.key);
  endpointKeys.add(wall.vertices.b.key);
}

coords = new Uint32Array(endpointKeys.size * 2);
let i = 0;
for ( const key of endpointKeys ) {
  const pt = PIXI.Point.invertKey(key);
  coords[i] = pt.x;
  coords[i + 1] = pt.y;
  i += 2;
}

delaunay = new Delaunator(coords);

// Draw each endpoint
for ( const key of endpointKeys ) {
  const pt = PIXI.Point.invertKey(key);
  Draw.point(pt, { color: Draw.COLORS.blue })
}

// Draw each triangle
triangles = [];
for (let i = 0; i < delaunay.triangles.length; i += 3) {
  const j = delaunay.triangles[i] * 2;
  const k = delaunay.triangles[i + 1] * 2;
  const l = delaunay.triangles[i + 2] * 2;
  triangles.push(new PIXI.Polygon(
    delaunay.coords[j], delaunay.coords[j + 1],
    delaunay.coords[k], delaunay.coords[k + 1],
    delaunay.coords[l], delaunay.coords[l + 1]
  ));
}

for ( const tri of triangles ) Draw.shape(tri);


// Build array of border triangles
borderTriangles = [];
for (let i = 0, ii = 0; i < delaunay.triangles.length; i += 3, ii += 1) {
  const j = delaunay.triangles[i] * 2;
  const k = delaunay.triangles[i + 1] * 2;
  const l = delaunay.triangles[i + 2] * 2;

  const a = { x: delaunay.coords[j], y: delaunay.coords[j + 1] };
  const b = { x: delaunay.coords[k], y: delaunay.coords[k + 1] };
  const c = { x: delaunay.coords[l], y: delaunay.coords[l + 1] };
  const tri = BorderTriangle.fromPoints(a, b, c);
  borderTriangles.push(tri);
  tri.id = ii; // Mostly for debugging at this point.
}

// Set the half-edges
EDGE_NAMES = ["AB", "BC", "CA"];
triangleEdges = new Set();
for ( let i = 0; i < delaunay.halfedges.length; i += 1 ) {
  const halfEdgeIndex = delaunay.halfedges[i];
  if ( !~halfEdgeIndex ) continue;
  const triFrom = borderTriangles[Math.floor(i / 3)];
  const triTo = borderTriangles[Math.floor(halfEdgeIndex / 3)];

  // Always a, b, c in order (b/c ccw)
  const fromEdge = EDGE_NAMES[i % 3];
  const toEdge = EDGE_NAMES[halfEdgeIndex % 3];

  // Need to pick one; keep the fromEdge
  const edgeToKeep = triFrom.edges[fromEdge];
  triTo.setEdge(toEdge, edgeToKeep);

  // Track edge set to link walls.
  triangleEdges.add(edgeToKeep);
}

// Map of wall keys corresponding to walls.
wallKeys = new Map();
for ( const wall of [...canvas.walls.placeables, ...canvas.walls.outerBounds] ) {
  const aKey = wall.vertices.a.key;
  const bKey = wall.vertices.b.key;
  if ( wallKeys.has(aKey) ) wallKeys.get(aKey).add(wall);
  else wallKeys.set(aKey, new Set([wall]));

  if ( wallKeys.has(bKey) ) wallKeys.get(bKey).add(wall);
  else wallKeys.set(bKey, new Set([wall]));
}

// Set the wall(s) for each triangle edge
nullSet = new Set();
for ( const edge of triangleEdges.values() ) {
  const aKey = edge.a.key;
  const bKey = edge.b.key;
  const aWalls = wallKeys.get(aKey) || nullSet;
  const bWalls = wallKeys.get(bKey) || nullSet;
  edge.wall = aWalls.intersection(bWalls).first(); // May be undefined.
}

borderTriangles.forEach(tri => tri.drawEdges());
borderTriangles.forEach(tri => tri.drawLinks())


// Use Quadtree to locate starting triangle for a point.

// quadtree.clear()
// quadtree.update({r: bounds, t: this})
// quadtree.remove(this)
// quadtree.update(this)


quadtreeBT = new CanvasQuadtree()
borderTriangles.forEach(tri => quadtreeBT.insert({r: tri.bounds, t: tri}))


token = _token
startPoint = _token.center;
endPoint = _token.center

// Find the strat and end triangles
collisionTest = (o, _rect) => o.t.contains(startPoint);
startTri = quadtreeBT.getObjects(boundsForPoint(startPoint), { collisionTest }).first();

collisionTest = (o, _rect) => o.t.contains(endPoint);
endTri = quadtreeBT.getObjects(boundsForPoint(endPoint), { collisionTest }).first();

startTri.drawEdges();
endTri.drawEdges();

// Locate valid destinations
destinations = startTri.getValidDestinations(startPoint, null, token.w * 0.5);
destinations.forEach(d => Draw.point(d.entryPoint, { color: Draw.COLORS.yellow }))
destinations.sort((a, b) => a.distance - b.distance);


// Pick direction, repeat.
chosenDestination = destinations[0];
Draw.segment({ A: startPoint, B: chosenDestination.entryPoint }, { color: Draw.COLORS.yellow })
nextTri = chosenDestination.triangle;
destinations = nextTri.getValidDestinations(startPoint, null, token.w * 0.5);
destinations.forEach(d => Draw.point(d.entryPoint, { color: Draw.COLORS.yellow }))
destinations.sort((a, b) => a.distance - b.distance);


function boundsForPoint(pt) {
  return new PIXI.Rectangle(pt.x - 1, pt.y - 1, 3, 3);
}


/* For the triangles, need:
√ Contains test. Could use PIXI.Polygon, but a custom contains will be faster.
  --> Used to find where a start/end point is located.
  --> Needs to also handle when on a line. PIXI.Polygon contains returns true if on top or left but not right or bottom.
- Look up wall for each edge.
√ Link to adjacent triangle via half-edge
- Provide 2x corner + median pass-through points
*/

/**
 * An edge that makes up the triangle-shaped polygon
 */
class BorderEdge {
  /** @type {PIXI.Point} */
  a = new PIXI.Point();

  /** @type {PIXI.Point} */
  b = new PIXI.Point();

  /** @type {Set<number>} */
  endpointKeys = new Set();

  /** @type {BorderTriangle} */
  cwTriangle;

  /** @type {BorderTriangle} */
  ccwTriangle;

  /** @type {Wall} */
  wall;

  constructor(a, b) {
    this.a.copyFrom(a);
    this.b.copyFrom(b);
    this.endpointKeys.add(this.a.key);
    this.endpointKeys.add(this.b.key);
  }

  /** @type {PIXI.Point} */
  #median;

  get median() { return this.#median || (this.#median = this.a.add(this.b).multiplyScalar(0.5)); }

  /** @type {number} */
  #length;

  get length() { return this.#length || (this.#length = this.b.subtract(this.a).magnitude()); }

  /**
   * Get the other triangle for this edge.
   * @param {BorderTriangle}
   * @returns {BorderTriangle}
   */
  otherTriangle(triangle) { return this.cwTriangle === triangle ? this.ccwTriangle : this.cwTriangle; }

  /**
   * Remove the triangle link.
   * @param {BorderTriangle}
   */
  removeTriangle(triangle) {
    if ( this.cwTriangle === triangle ) this.cwTriangle = undefined;
    if ( this.ccwTriangle === triangle ) this.ccwTriangle = undefined;
  }

  /**
   * Provide valid destinations for this edge.
   * Blocked walls are invalid.
   * Typically returns 2 corner destinations plus the median destination.
   * If the edge is less than 2 * spacer, no destinations are valid.
   * @param {Point} center              Test if wall blocks from perspective of this origin point.
   * @param {number} [spacer]           How much away from the corner to set the corner destinations.
   *   If the edge is less than 2 * spacer, it will be deemed invalid.
   *   Corner destinations are skipped if not more than spacer away from median.
   * @returns {PIXI.Point[]}
   */
  getValidDestinations(origin, spacer) {
    spacer ??= canvas.grid.size * 0.5;
    const length = this.length;
    const destinations = [];

    // No destination if edge is smaller than 2x spacer.
    if ( length < (spacer * 2) || this.wallBlocks(origin) ) return destinations;
    destinations.push(this.median);

    // Skip corners if not at least spacer away from median.
    if ( length < (spacer * 4) ) return destinations;

    const { a, b } = this;
    const t = spacer / length;
    destinations.push(
      a.projectToward(b, t),
      b.projectToward(a, t));
    return destinations;
  }


  /**
   * Does this edge wall block from an origin somewhere else in the triangle?
   * Tested "live" and not cached so door or wall orientation changes need not be tracked.
   * @param {Point} origin    Measure wall blocking from perspective of this origin point.
   * @returns {boolean}
   */
  wallBlocks(origin) {
    const wall = this.wall;
    if ( !wall ) return false;
    if ( !wall.document.move || wall.isOpen ) return false;

    // Ignore one-directional walls which are facing away from the center
    const side = wall.orientPoint(origin);
    const wdm = PointSourcePolygon.WALL_DIRECTION_MODES;
    if ( wall.document.dir
      && (wallDirectionMode === wdm.NORMAL) === (side === wall.document.dir) ) return false;
    return true;
  }

  /**
   * Link a triangle to this edge, replacing any previous triangle in that position.
   */
  linkTriangle(triangle) {
    const { a, b } = this;
    if ( !triangle.endpointKeys.has(a.key)
      || !triangle.endpointKeys.has(b.key) ) throw new Error("Triangle does not share this edge!");

    const { a: aTri, b: bTri, c: cTri } = triangle.vertices;
    const otherEndpoint = !this.endpointKeys.has(aTri.key) ? aTri
      : !this.endpointKeys.has(bTri.key) ? bTri
        : cTri;
    const orient2d = foundry.utils.orient2dFast;
    if ( orient2d(a, b, otherEndpoint) > 0 ) this.ccwTriangle = triangle;
    else this.cwTriangle = triangle;
  }

  /**
   * For debugging.
   * Draw this edge.
   */
  draw(opts = {}) {
    opts.color ??= this.wall ? Draw.COLORS.red : Draw.COLORS.blue;
    Draw.segment({ A: this.a, B: this.b }, opts);
  }
}

/**
 * A triangle-shaped polygon.
 * Assumed static---points cannot change.
 * Note: delaunay triangles from Delaunator are oriented counterclockwise
 */
class BorderTriangle {
  vertices = {
    a: new PIXI.Point(), /** @type {PIXI.Point} */
    b: new PIXI.Point(), /** @type {PIXI.Point} */
    c: new PIXI.Point()  /** @type {PIXI.Point} */
  };

  edges = {
    AB: undefined, /** @type {BorderEdge} */
    BC: undefined, /** @type {BorderEdge} */
    CA: undefined  /** @type {BorderEdge} */
  };

  /** @type {BorderEdge} */

  /** @type {Set<number>} */
  endpointKeys = new Set();

  /** @type {number} */
  id = -1;

  /**
   * @param {Point} a
   * @param {Point} b
   * @param {Point} c
   */
  constructor(edgeAB, edgeBC, edgeCA) {
    // Determine the shared endpoint for each.
    let a = edgeCA.endpointKeys.has(edgeAB.a.key) ? edgeAB.a : edgeAB.b;
    let b = edgeAB.endpointKeys.has(edgeBC.a.key) ? edgeBC.a : edgeBC.b;
    let c = edgeBC.endpointKeys.has(edgeCA.a.key) ? edgeCA.a : edgeCA.b;

    const oABC = foundry.utils.orient2dFast(a, b, c);
    if ( !oABC ) throw Error("BorderTriangle requires three non-collinear points.");
    if ( oABC < 0 ) {
      // Flip to ccw.
      [a, b, c] = [c, b, a];
      [edgeAB, edgeCA] = [edgeCA, edgeAB];
    }

    this.vertices.a.copyFrom(a);
    this.vertices.b.copyFrom(b);
    this.vertices.c.copyFrom(c);

    this.edges.AB = edgeAB;
    this.edges.BC = edgeBC;
    this.edges.CA = edgeCA;

    Object.values(this.vertices).forEach(v => this.endpointKeys.add(v.key));
    Object.values(this.edges).forEach(e => e.linkTriangle(this));
  }

  /**
   * Construct a BorderTriangle from three points.
   * Creates three new edges.
   * @param {Point} a     First point of the triangle
   * @param {Point} b     Second point of the triangle
   * @param {Point} c     Third point of the triangle
   * @returns {BorderTriangle}
   */
  static fromPoints(a, b, c) {
    return new this(
      new BorderEdge(a, b),
      new BorderEdge(b, c),
      new BorderEdge(c, a)
    );
  }

  /** @type {Point} */
  #center;

  get center() { return this.#center
    || (this.#center = this.vertices.a.add(this.vertices.b).add(this.vertices.c).multiplyScalar(1/3)); }

  /**
   * Contains method based on orientation.
   * More inclusive than PIXI.Polygon.prototype.contains in that any point on the edge counts.
   * @param {number} x                  X coordinate of point to test
   * @param {number} y                  Y coordinate of point to test
   * @returns {boolean}
   */
  contains(pt) {
    const orient2d = foundry.utils.orient2dFast;
    const { a, b, c } = this.vertices;
    return orient2d(a, b, pt) >= 0
        && orient2d(b, c, pt) >= 0
        && orient2d(c, a, pt) >= 0;
  }

  /** @type {PIXI.Rectangle} */
  #bounds;

  get bounds() { return this.#bounds || (this.#bounds = this._getBounds()); }

  getBounds() { return this.bounds; }

  _getBounds() {
    const { a, b, c } = this.vertices;
    const xMinMax = Math.minMax(a.x, b.x, c.x);
    const yMinMax = Math.minMax(a.y, b.y, c.y);
    return new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
  }

  /**
   * Provide valid destinations given that you came from a specific neighbor.
   * Blocked walls are invalid.
   * Typically returns 2 corner destinations plus the median destination.
   * @param {Point} entryPoint
   * @param {BorderTriangle|null} priorTriangle
   * @param {number} spacer           How much away from the corner to set the corner destinations.
   *   If the edge is less than 2 * spacer, it will be deemed invalid.
   *   Corner destinations are skipped if not more than spacer away from median.
   * @returns {object[]} Each element has properties describing the destination:
   *   - {BorderTriangle} triangle
   *   - {Point} entryPoint
   *   - {number} distance
   */
  getValidDestinations(entryPoint, priorTriangle, spacer) {
    spacer ??= canvas.grid.size * 0.5;
    const destinations = [];
    const center = this.center;
    for ( const edge of Object.values(this.edges) ) {
      const neighbor = edge.otherTriangle(this);
      if ( priorTriangle && priorTriangle === neighbor ) continue;
      const pts = edge.getValidDestinations(center, spacer);
      pts.forEach(pt => {
        destinations.push({
          entryPoint: pt,
          triangle: neighbor,

          // TODO: Handle 3d distances.
          // Probably use canvas.grid.measureDistances, passing a Ray3d.
          // TODO: Handle terrain distance
          distance: canvas.grid.measureDistance(center, pt),
        });
      })
    }
    return destinations;
  }

  /**
   * Replace an edge in this triangle.
   * Used to link triangles by an edge.
   * @param {string} edgeName     "AB"|"BC"|"CA"
   */
  setEdge(edgeName, newEdge) {
    const oldEdge = this.edges[edgeName];
    if ( !oldEdge ) {
      console.error(`No edge with name ${edgeName} found.`);
      return;
    }

    if ( !(newEdge instanceof BorderEdge) ) {
      console.error("BorderTriangle requires BorderEdge to replace an edge.");
      return;
    }

    if ( !(oldEdge.endpointKeys.has(newEdge.a.key) && oldEdge.endpointKeys.has(newEdge.b.key)) ) {
      console.error("BorderTriangle edge replacement must have the same endpoints. Try building a new triangle instead.");
      return;
    }

    oldEdge.removeTriangle(this);
    this.edges[edgeName] = newEdge;
    newEdge.linkTriangle(this);
  }

  /**
   * For debugging. Draw edges on the canvas.
   */
  drawEdges() { Object.values(this.edges).forEach(e => e.draw()); }

  /*
   * Draw links to other triangles.
   */
  drawLinks() {
    const center = this.center;
    for ( const edge of Object.values(this.edges) ) {
      if ( edge.otherTriangle(this) ) {
        const color = edge.wallBlocks(center) ? Draw.COLORS.orange : Draw.COLORS.green;
        Draw.segment({ A: center, B: edge.median }, { color });

      }
    }
  }
}
