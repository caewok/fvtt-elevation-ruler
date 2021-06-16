import { MODULE_ID, log } from "./module.js";
import { calculateEndElevation, toGridDistance } from "./segments.js";


/**
 * Modified Ruler 
 * Measure elevation change at each waypoint and destination.
 * Modify distance calculation accordingly.
 * Display current elevation change and change at each waypoint.
 */
 
/**
 * Typical Ruler workflow:
 * - clear when drag starts
 * - create initial waypoint
 * - measure (likely multiple)
 * - add'l waypoints (optional)
 * - possible token movement
 * - clear when drag abandoned
 */
 
// wrapping the constructor appears not to work.
// see https://github.com/ruipin/fvtt-lib-wrapper/issues/14
 
 
/**
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
 


function projectElevatedPoint(A, B, height) {
  const distance = CalculateDistance(A, B);
  const projected_x = B.x + ((height / distance) * (A.y - B.y));
  const projected_y = B.y - ((height / distance) * (A.x - B.x));

  return new PIXI.Point(projected_x, projected_y);
}

Object.defineProperty(Ruler.prototype, "projectElevatedPoint", {
  value: projectElevatedPoint,
  writable: true,
  configurable: true
});

function CalculateDistance(A, B) {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  return Math.hypot(dy, dx);
}

// console.log(Math.hypot(3, 4));
// // expected output: 5
// 
// console.log(Math.hypot(5, 12));
// // expected output: 13
// 
// let m;
// let o = {x:0, y:0}
// m = ProjectElevatedPoint(o, {x:1, y:0}, 1);
// CalculateDistance(o, m) // 1.414
// 
// m = ProjectElevatedPoint(o, {x:3, y:0}, 4);
// CalculateDistance(o, m) // 5
// 
// m = ProjectElevatedPoint(o, {x:0, y:3}, 4);
// CalculateDistance(o, m) // 5 
// 
// m = ProjectElevatedPoint(o, {x:0, y:3}, 4);

// m = distance
// n = height
// A = origin ()
// B = destination (1)
// C = destination with height (2)
// |Ay - By| / m = |Bx - Cx| / n
// |Ax - Bx| / m = |Cy - By| / n
// 
// |Bx - Cx| / n = |Ay - By| / m
// |Cy - By| / n = |Ax - Bx| / m
// 
// |Bx - Cx| = |Ay - By| * n/m
// |Cy - By| = |Ax - Bx| * n/m
// 
// Bx - Cx = ± n/m * (Ay - By)
// Cy - By = ± n/m * (Ax - Bx)
// 
// Cx = Bx ± n/m * (Ay - By)
// Cy = By ± n/m * (Ax - Bx)





// will need to update measuring to account for elevation
export function elevationRulerMeasure(wrapped, destination, {gridSpaces=true}={}) {
  log("we are measuring!");
  log(`${this.waypoints.length} waypoints. ${this.destination_elevation_increment} elevation increments for destination. ${this.elevation_increments.length} elevation waypoints.`, this.elevation_increments);
  
  // if no elevation present, go with original function.
  if(!this.destination_elevation_increment &&
     (!this.elevation_increments ||
       this.elevation_increments.every(i => i === 0))) { 
    
     log("Using original measure");
     return wrapped(destination, gridSpaces);
  }  
  
  // Mostly a copy from Ruler.measure, but adding in distance for elevation
  // Original segments need to be retained so that the displayed path is correct.
  // But the distances need to be modified to account for segment elevation.
  // Project the elevated point back to the 2-D space, using a rotated right triangle.
  // See, e.g. https://math.stackexchange.com/questions/927802/how-to-find-coordinates-of-3rd-vertex-of-a-right-angled-triangle-when-everything

  destination = new PIXI.Point(...canvas.grid.getCenter(destination.x, destination.y));
  const waypoints = this.waypoints.concat([destination]);
  const waypoints_elevation = this.elevation_increments.concat([this.destination_elevation_increment]);
  
  const r = this.ruler;
  this.destination = destination;

  log("Measure ruler", r);
  
  // Iterate over waypoints and construct segment rays
  // Also create elevation segments, adjusting segments for elevation
  // waypoint 0 is added as the origin (see _onDragStart)
  // so elevation_waypoint 0 should also be the origin, and so 0
  // the for loop uses the next waypoint as destination. 
  // for loop will count from 0 to waypoints.length - 1
  
  const segments = [];
  const elevation_segments = [];
  for ( let [i, dest] of waypoints.slice(1).entries() ) {
    log(`Processing waypoint ${i}`, dest);
  
    const origin = waypoints[i];
    const label = this.labels.children[i];
    const ray = new Ray(origin, dest);
    
    // first waypoint is origin; elevation increment is 0.
    // need to account for units of the grid
    // canvas.scene.data.grid e.g. 140; canvas.scene.data.gridDistance e.g. 5
    const elevation = waypoints_elevation[i + 1] * canvas.scene.data.grid; 
    log("Origin", origin);
    log("Destination", dest);
    log(`Elevation ${elevation} for i = ${i}.`);

    
    const elevated_dest = this.projectElevatedPoint(origin, dest, elevation);
    const ray_elevated = new Ray(origin, elevated_dest);
    
    log("Elevated_dest", elevated_dest);
    log("Ray", ray);
    log("Elevated Ray", ray_elevated);
    
    if ( ray_elevated.distance < 10 ) {
      if ( label ) label.visible = false;
      continue;
    }
    segments.push({ray, label});
    elevation_segments.push({ray: ray_elevated, label: label});
  }
}
 

// clear should reset elevation info
export function elevationRulerClear(wrapped, ...args) {
  log("we are clearing!", this);
  
  /**
   * The set of elevation increments corresponding to waypoints.
   * Note: waypoint 0 is origin and should be elevation 0 (no increment +/-)
   * type: Array of integers
   */    
  this.setFlag(MODULE_ID,  "elevation_increments", []);
  
  /**
   * The current destination point elevation increment relative to origin.
   * type: integer
   */ 
  this.setFlag(MODULE_ID,  "destination_elevation_increment", 0);
  
  return wrapped(...args);
}

// adding waypoint should also add elevation info
export function elevationRulerAddWaypoint(wrapped, ...args) {
  log("adding waypoint!");
  
  // following || shouldn't happen, but worth a test?
  const elevation_increments = this.getFlag(MODULE_ID, "elevation_increments") || [];
  const destination_elevation_increment = this.getFlag(MODULE_ID, "destination_elevation_increment") || 0;
   
  elevation_increments.push(destination_elevation_increment);
  
  this.setFlag(MODULE_ID, "elevation_increments", elevation_increments);
  
  // Arguably more consistent interface to carry-over increments from the prior section.
  this.setFlag(MODULE_ID, "destination_elevation_increment", elevation_increments[elevation_increments.length - 1]);

  return wrapped(...args);
}

// removing waypoint should also remove elevation info
export function elevationRulerRemoveWaypoint(wrapped, ...args) {
  log("removing waypoint!");
  
  // following || shouldn't happen, but worth a test?
  const elevation_increments = this.getFlag(MODULE_ID, "elevation_increments") || [];
  
  elevation_increments.pop();
  this.setFlag(MODULE_ID, "elevation_increments", elevation_increments);
  
  // Arguably more consistent interface to carry-over increments from the prior section.
  // TO-DO: should the new destination increment be the prior waypoint increment, 0, or the current increment for the removed waypoint?
  this.setFlag(MODULE_ID, "destination_elevation_increment", elevation_increments[elevation_increments.length - 1]);
  
  return wrapped(...args);
}

export function incrementElevation() {
  const ruler = canvas.controls.ruler;
  log("Trying to increment...", ruler);
  if(!ruler || !ruler.active) return;
  
  const destination_elevation_increment = ruler.getFlag(MODULE_ID, "destination_elevation_increment") || 0;
  ruler.setFlag(MODULE_ID, "destination_elevation_increment", destination_elevation_increment + 1);
  ruler.measure(ruler.destination);
}

export function decrementElevation() {
  const ruler = canvas.controls.ruler;
  log("Trying to decrement...", ruler);
  if(!ruler || !ruler.active) return;

  const destination_elevation_increment = ruler.getFlag(MODULE_ID, "destination_elevation_increment") || 0;
  ruler.setFlag(MODULE_ID, "destination_elevation_increment", destination_elevation_increment - 1);
  ruler.measure(ruler.destination);
}

// When moving the token along the segments, update the token elevation
export async function elevationRulerAnimateToken(wrapped, token, ray, dx, dy, segment_num) {
  // probably update first so the token is at elevation throughout the segment move.
  log(`Updating token elevation for segment ${segment_num}`, token);
  
  const elevation_increments = duplicate(this.getFlag(MODULE_ID, "elevation_increments"));
  const destination_elevation_increment = this.getFlag(MODULE_ID, "destination_elevation_increment");
  elevation_increments.push(destination_elevation_increment);
  
  const current_elevation = getProperty(token, "data.elevation");
  const elevation_change = (Math.round(elevation_increments[segment_num] *  canvas.scene.data.gridDistance * 100) / 100);
  log(`Current token elevation is ${current_elevation}. Will be changed by ${elevation_change}.`);
  if(elevation_change !== 0) {
    const new_elevation = current_elevation + elevation_change;
    log(`Adding ${new_elevation} elevation to token.`);
    await token.document.update({ 'elevation': new_elevation });
  }
  
  
  return wrapped(token, ray, dx, dy, segment_num);
}


