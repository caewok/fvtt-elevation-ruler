// NOTE: Helper functions to handle Delaunay coordinates.
// See https://mapbox.github.io/delaunator/

/**
 * Get the three vertex coordinates (edges) for a delaunay triangle.
 * @param {number} t    Triangle index
 * @returns {number[3]}
 */
function edgesOfTriangle(t) { return [3 * t, 3 * t + 1, 3 * t + 2]; }

/**
 * Get the points of a delaunay triangle.
 * @param {Delaunator} delaunay     The triangulation to use
 * @param {number} t                Triangle index
 * @returns {PIXI.Point[3]}
 */
function pointsOfTriangle(delaunay, t) {
  const points = delaunay.coords;
  return edgesOfTriangle(t)
        .map(e => delaunay.triangles[e])
        .map(p => new PIXI.Point(points[2 * p], points[(2 * p) + 1]));
}

/**
 * Apply a function to each triangle in the triangulation.
 * @param {Delaunator} delaunay     The triangulation to use
 * @param {function} callback       Function to apply, which is given the triangle id and array of 3 points
 */
function forEachTriangle(delaunay, callback) {
  const nTriangles = delaunay.triangles.length / 3;
  for ( let t = 0; t < nTriangles; t += 1 ) callback(t, pointsOfTriangle(delaunay, t));
}

/**
 * Get index of triangle for a given edge.
 * @param {number} e      Edge index
 * @returns {number} Triangle index
 */
function triangleOfEdge(e)  { return Math.floor(e / 3); }

/**
 * For a given half-edge index, go to the next half-edge for the triangle.
 * @param {number} e    Edge index
 * @returns {number} Edge index.
 */
function nextHalfedge(e) { return (e % 3 === 2) ? e - 2 : e + 1; }

/**
 * For a given half-edge index, go to the previous half-edge for the triangle.
 * @param {number} e    Edge index
 * @returns {number} Edge index.
 */
function prevHalfedge(e) { return (e % 3 === 0) ? e + 2 : e - 1; }

/**
 * Apply a function for each triangle edge in the triangulation.
 * @param {Delaunator} delaunay     The triangulation to use
 * @param {function} callback       Function to call, passing the edge index and points of the edge.
 */
function forEachTriangleEdge(delaunay, callback) {
  const points = delaunay.coords;
    for (let e = 0; e < delaunay.triangles.length; e++) {
      if (e > delaunay.halfedges[e]) {
        const ip = delaunay.triangles[e];
        const p = new PIXI.Point(points[2 * ip], points[(2 * ip) + 1])

        const iq = delaunay.triangles[nextHalfedge(e)];
        const q = new PIXI.Point(points[2 * iq], points[(2 * iq) + 1])
        callback(e, p, q);
      }
    }
}

/**
 * Identify triangle indices corresponding to triangles adjacent to the one provided.
 * @param {Delaunator} delaunay     The triangulation to use
 * @param {number} t    Triangle index
 * @returns {number[]}
 */
function trianglesAdjacentToTriangle(delaunay, t) {
  const adjacentTriangles = [];
  for ( const e of edgesOfTriangle(t) ) {
    const opposite = delaunay.halfedges[e];
    if (opposite >= 0) adjacentTriangles.push(triangleOfEdge(opposite));
  }
  return adjacentTriangles;
}