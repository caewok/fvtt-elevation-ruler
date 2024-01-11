
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


sceneRect = canvas.scene.dimensions.sceneRect;
TL = new PIXI.Point(sceneRect.left, sceneRect.top);
TR = new PIXI.Point(sceneRect.right, sceneRect.top);
BR = new PIXI.Point(sceneRect.right, sceneRect.bottom);
BL = new PIXI.Point(sceneRect.left, sceneRect.bottom);
endpointKeys = new Set([TL.key, TR.key, BR.key, BL.key]);

for ( const wall of canvas.walls.placeables ) {
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


// Build set of border triangles
borderTriangles = new Map();
for (let i = 0, ii = 0; i < delaunay.triangles.length; i += 3, ii += 1) {
  const j = delaunay.triangles[i] * 2;
  const k = delaunay.triangles[i + 1] * 2;
  const l = delaunay.triangles[i + 2] * 2;
  const tri = new BorderTriangle(
    delaunay.coords[j], delaunay.coords[j + 1],
    delaunay.coords[k], delaunay.coords[k + 1],
    delaunay.coords[l], delaunay.coords[l + 1]);
  borderTriangles.set(ii, tri);
  tri.id = ii;
}

// Set the half-edges
EDGE_NAMES = ["neighborAB", "neighborBC", "neighborCA"];
let i = 0
for ( i = 0; i < delaunay.halfedges.length; i += 1 ) {
  const halfEdgeIndex = delaunay.halfedges[i];
  if ( !~halfEdgeIndex ) continue;
  const triFrom = borderTriangles.get(Math.floor(i / 3));
  const triTo = borderTriangles.get(Math.floor(halfEdgeIndex / 3));

  // Always a, b, c in order (b/c ccw)
  const fromEdge = EDGE_NAMES[i % 3];
  const toEdge = EDGE_NAMES[halfEdgeIndex % 3];
  triFrom[fromEdge] = triTo;
  triTo[toEdge] = triFrom;
}


borderTriangles.forEach(tri => tri.draw());
borderTriangles.forEach(tri => tri.drawLinks())

// Map of wall keys corresponding to walls.
wallKeys = new Map();
for ( const wall of canvas.walls.placeables ) {
  wallKeys.set(wall.vertices.a.key, wall);
  wallKeys.set(wall.vertices.b.key, wall);
}

// Set the wall(s) for each triangle edge



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

  /** @type {BorderTriangle} */
  cwTriangle;

  /** @type {BorderTriangle} */
  ccwTriangle;

  constructor(a, b) {

  }

  /**
   * Link a triangle to this edge, replacing any previous triangle in that position.
   */
  linkTriangle(triangle) {
    const triEndpoints = new Set([triangle.a, triangle.b, triangle.c]);

    otherEndpoint =

  }



}

/**
 * A triangle-shaped polygon.
 * Assumed static---points cannot change.
 * Note: delaunay triangles from Delaunator are oriented counterclockwise
 */
class BorderTriangle extends PIXI.Polygon {
  /** @type {PIXI.Point} */
  a = new PIXI.Point();

  /** @type {PIXI.Point} */
  b = new PIXI.Point();

  /** @type {PIXI.Point} */
  c = new PIXI.Point();

  /** @type {number} */
  id = -1;

  constructor(...args) {
    super(...args);
    if ( this.points.length !== 6 ) throw new Error("Border Triangle must have 6 coordinates");


  }

  /**
   * Initialize properties based on the unchanging coordinates.
   */
  _initialize() {
    // Orient a --> b --> c counterclockwise
    if ( this.isClockwise ) this.reverseOrientation();
    this.a.x = this.points[0];
    this.a.y = this.points[1];
    this.b.x = this.points[2];
    this.b.y = this.points[3];
    this.c.x = this.points[4];
    this.c.y = this.points[5];

    // Get the

  }

  /**
   * Calculate coordinate index in the Delaunay set.
   */
  delaunayCoordinate(vertex = "a") {
    switch ( vertex ) {
      case "a": return BorderTriangle.delauney
    }
  }

  /**
   * Contains method based on orientation.
   * More inclusive than PIXI.Polygon.prototype.contains in that any point on the edge counts.
   * @param {number} x                  X coordinate of point to test
   * @param {number} y                  Y coordinate of point to test
   * @returns {boolean}
   *   - False if not contained at all
   *   -
   */
  containsPoint(pt) {
    const orient2d = foundry.utils.orient2dFast;
    return orient2d(a, b, pt) >= 0
        && orient2d(b, c, pt) >= 0
        && orient2d(c, a, pt) >= 0;
  }

  /**
   * Replace getBounds with static version.
   * @returns {PIXI.Rectangle}
   */

  /** @type {PIXI.Rectangle} */
  #bounds;

  get bounds() { return this.#bounds || (this.#bounds = this._getBounds()); }

  getBounds() { return this.#bounds || (this.#bounds = this._getBounds()); }

  _getBounds() {
    const xMinMax = Math.minMax(this.a.x, this.b.x, this.c.x);
    const yMinMax = Math.minMax(this.a.y, this.b.y, this.c.y);
    return new PIXI.Rectangle(xMinMax.min, yMinMax.min, xMinMax.max - xMinMax.min, yMinMax.max - yMinMax.min);
  }

  /**
   * Links to neighboring triangles.
   * @type {BorderTriangle}
   */
  neighborAB;

  neighborBC;

  neighborCA;

  /**
   * Links to the wall(s) representing each edge
   * @type {Set<Wall>}
   */
  wallsAB;

  wallsBC;

  wallsCA;

  /**
   * Debug helper to draw the triangle.
   */
  draw(opts = {}) {
    Draw.shape(this, opts);
    if ( ~this.id ) Draw.labelPoint(this.center, this.id.toString());
  }

  /*
   * Draw links to other triangles.
   */
  drawLinks() {
    const center = this.center;
    if ( this.neighborAB ) Draw.segment({ A: center, B: this.neighborAB.center });
    if ( this.neighborBC ) Draw.segment({ A: center, B: this.neighborBC.center });
    if ( this.neighborCA ) Draw.segment({ A: center, B: this.neighborCA.center });
  }
}

