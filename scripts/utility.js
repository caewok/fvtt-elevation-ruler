import { log } from "./module.js";

/*
 * Generator to iterate grid points under a line.
 * This version handles lines in 3d.
 *   It assumes elevation movement by the set grid distance. 
 * @param {x: Number, y: Number, z: Number} origin Origination point
 * @param {x: Number, y: Number, z: Number} destination Destination point
 * @return Iterator, which in turn 
 *   returns [row, col, elevation] for each grid point under the line.
 */
export function * iterateGridUnder3dLine(generator, origin, destination) {  
  let prior_elevation = origin.z || 0;
  const end_elevation = destination.z || 0;
  const direction = prior_elevation <= end_elevation ? 1 : -1;
  const elevation_increment = canvas.scene.data.gridDistance * canvas.scene.data.grid;
  log(`elevation: ${prior_elevation}[prior], ${end_elevation}[end], ${direction}[direction], ${elevation_increment}[increment]`);
  //log(generator);
  let last_row, last_col;  

  for(const res of generator) {
    // step down in elevation if necessary
    log(res);
    //const {value, done} = res;
    const [row, col] = res;
    [last_row, last_col] = res;
    
    if(prior_elevation != end_elevation) {
      const remainder = Math.abs(prior_elevation - end_elevation);
      const step_elevation = Math.min(remainder, elevation_increment);
      prior_elevation += step_elevation * direction;
      
    }
    yield [row, col, prior_elevation];
  }
  
  // more elevation? increment straight down.
  const MAX_ITERATIONS = 1000; // to avoid infinite loops
  let iteration = 0;
  while(prior_elevation != end_elevation && iteration < MAX_ITERATIONS) {
    iteration += 1;
    const remainder = Math.abs(prior_elevation - end_elevation);
    const step_elevation = Math.min(remainder, elevation_increment);
    log(`elevation: ${prior_elevation}[prior], ${end_elevation}[end], ${step_elevation}[step]`);
    prior_elevation += step_elevation * direction;
    
    yield [last_row, last_col, prior_elevation];
  } 
}

// needed for libWrapper
export function iterateGridUnder3dLine_wrapper(wrapped, origin, destination) {
  log(`iterateGrid origin, destination`, origin, destination);
  return iterateGridUnder3dLine(wrapped(origin, destination), origin, destination);
}

 /*
  * Calculate a new point by projecting the elevated point back onto the 2-D surface
  * If the movement on the plane is represented by moving from point A to point B,
  *   and you also move 'height' distance orthogonal to the plane, the distance is the
  *   hypotenuse of the triangle formed by A, B, and C, where C is orthogonal to B.
  *   Project by rotating the vertical triangle 90º, then calculate the new point C. 
  *
  * Cx = { height * (By - Ay) / dist(A to B) } + Bx
  * Cy = { height * (Bx - Ax) / dist(A to B) } + By
  * @param {{x: number, y: number}} A
  * @param {{x: number, y: number}} B
  */
export function projectElevatedPoint(A, B) {
  const height = A.z - B.z;
  const distance = window.libRuler.RulerUtilities.calculateDistance(A, B);
  const projected_x = A.x + ((height / distance) * (B.y - A.y));
  const projected_y = A.y - ((height / distance) * (B.x - A.x));
  
  // for square grids, rotate so that the origin point A is vertical or horizontal from original A?
  // for hex grids, rotate so that the origin point A is in a straight line from original A?
  // this will give correct results for diagonal moves, b/c A should always be straight line to projected A, as it is a vertical move 

  return new PIXI.Point(projected_x, projected_y);
}

 /*
  * Calculate the distance between two points in {x,y,z} dimensions.
  * @param {PIXI.Point} A   Point in {x, y, z} format.
  * @param {PIXI.Point} B   Point in {x, y, z} format.
  * @return The distance between the two points.
  */
export function calculate3dDistance(wrapped, A, B, EPSILON = 1e-6) {
  if(A.z === undefined) A.z = 0;
  if(B.z === undefined) B.z = 0;
  
  const dz = Math.abs(B.z - A.z);  
  if(dz < EPSILON) { return wrapped(A, B, EPSILON); }
  
  const dy = Math.abs(B.y - A.y);
  if(dy < EPSILON) { return wrapped({x: A.x, y: A.z}, {x: B.x, y: B.z}, EPSILON); }
    
  const dx = Math.abs(B.x - A.x);
  if(dx < EPSILON) { return wrapped({x: A.z, y: A.y}, {x: B.z, y: B.y}, EPSILON); }
  
  return Math.hypot(dz, dy, dx);
}


