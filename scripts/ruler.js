import { MODULE_ID, log } from "./module.js";


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
 
/*
 * Construct a label to represent elevation changes in the ruler.
 * Waypoint version: 10 ft↑ or 10 ft↓
 * Total version: 10 ft↑ [20 ft↓]
 * @param {number} segmentElevationIncrement Incremental elevation for the segment.
 * @param {number} totalElevationIncrement Total elevation for all segments to date.
 * @param {boolean} isTotal Whether this is the label for the final segment
 * @return {string}
 */
function segmentElevationLabel(segmentElevationIncrement, totalElevationIncrement, isTotal) {
  const segmentArrow = (segmentElevationIncrement > 0) ? "↑" :
                      (segmentElevationIncrement < 0) ? "↓" :
                      "";
  
  // Take absolute value b/c segmentArrow will represent direction
  // * 100 / 100 is used in _getSegmentLabel; not sure whys
  let label = `${Math.abs(Math.round(segmentElevationIncrement * 100) / 100)} ${canvas.scene.data.gridUnits}${segmentArrow}`;
  
  if ( isTotal ) {
      const totalArrow = (totalElevationIncrement > 0) ? "↑" :
                      (totalElevationIncrement < 0) ? "↓" :
                      "";
      label += ` [${Math.round(totalElevationIncrement * 100) / 100} ${canvas.scene.data.gridUnits}${totalArrow}]`;
  }
  return label;
}
 
 
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
function ProjectElevatedPoint(A, B, height) {
  const distance = CalculateDistance(A, B);
  const projected_x = B.x + ((height / distance) * (A.y - B.y));
  const projected_y = B.y - ((height / distance) * (A.x - B.x));

  return new PIXI.Point(projected_x, projected_y);
}

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


/* 
 * Create a distance ray that is the hypotenuse of the triangle 
 * origin, destination, elevated destination, projected (or rotated 90º)
 * onto the canvas.
 * @param {PIXI.Point} origin Where the segment starts on the canvas.
 * @param {PIXI.Point} dest PIXI.Point Where the segment ends on the canvas.
 * @param {integer} segment_num The segment number, where 1 is the
 *    first segment between origin and the first waypoint (or destination),
 *    2 is the segment between the first and second waypoints.
 *
 *    The segment_num can also be considered the waypoint number, equal to the index 
 *    in the array this.waypoints.concat([this.destination]). Keep in mind that 
 *    the first waypoint in this.waypoints is actually the origin 
 *    and segment_num will never be 0.
 */ 
export function elevationRulerConstructSegmentDistanceRay(wrapped, origin, dest, segment_num) {
	// first waypoint is origin; elevation increment is 0.
	// need to account for units of the grid
	// canvas.scene.data.grid e.g. 140; canvas.scene.data.gridDistance e.g. 5
	// if there is no elevation increment to consider, use original function.
	const destination_elevation_increment = this.getFlag(MODULE_ID, "destination_elevation_increment") || 0;
	const elevation_increments = this.getFlag(MODULE_ID, "elevation_increments") || [];
	const waypoints_elevation = elevation_increments.concat([destination_elevation_increment]);
	if(waypoints_elevation[segment_num] === 0) { return wrapped(origin, dest, segment_num); }
  
  const elevation = waypoints_elevation[segment_num] * canvas.scene.data.grid; 
  const elevated_dest = ProjectElevatedPoint(origin, dest, elevation);
  
  return wrapped(origin, elevated_dest, segment_num);
}


/* 
 * @param {number} segmentDistance
 * @param {number} totalDistance
 * @param {boolean} isTotal
 * @param {integer} segment_num The segment number, where 1 is the
 *    first segment between origin and the first waypoint (or destination),
 *    2 is the segment between the first and second waypoints.
 *
 *    The segment_num can also be considered the waypoint number, equal to the index 
 *    in the array this.waypoints.concat([this.destination]). Keep in mind that 
 *    the first waypoint in this.waypoints is actually the origin 
 *    and segment_num will never be 0.
 */ 
export function elevationRulerGetSegmentLabel(wrapped, segmentDistance, totalDistance, isTotal, segment_num) {
  const orig_label = wrapped(segmentDistance, totalDistance, isTotal, segment_num);
  log(`Constructing segment ${segment_num} label`, this);
  log(`orig_label is ${orig_label}`);

  // if all waypoints to this point have no elevation change, ignore the elevation label
  const destination_elevation_increment = this.getFlag(MODULE_ID, "destination_elevation_increment") || 0;
  const elevation_increments = this.getFlag(MODULE_ID, "elevation_increments") || [];
  log(`destination_elevation_increment is ${destination_elevation_increment}, elevation_increments are ${elevation_increments}.`);
  
  const waypoints_elevation = elevation_increments.concat([destination_elevation_increment]);  
  const elevation = waypoints_elevation[segment_num] * canvas.scene.data.gridDistance;
  
  // first waypoint is origin with no incremental elevation; could be skipped
  // slice takes start_point to end_point - 1, so need to increment here to capture the current segment
  const summedElevation = waypoints_elevation.slice(0, segment_num + 1).reduce((acc, total) => acc + total, 0);
  const totalElevation = summedElevation * canvas.scene.data.gridDistance; 
  log(`summedElevation is ${summedElevation}; totalElevation is ${totalElevation}; elevation is ${elevation}`, waypoints_elevation);
  if(totalElevation === 0) { return orig_label }
  
  const elevation_label = segmentElevationLabel(elevation, totalElevation, orig_label)
  log(`elevation_label is ${elevation_label}`);
  return orig_label + "\n" + elevation_label;
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
  this.setFlag(MODULE_ID, "destination_elevation_increment", 0);

  return wrapped(...args);
}

// removing waypoint should also remove elevation info
export function elevationRulerRemoveWaypoint(wrapped, ...args) {
  log("removing waypoint!");
  
  // following || shouldn't happen, but worth a test?
  const elevation_increments = this.getFlag(MODULE_ID, "elevation_increments") || [];
  
  elevation_increments.pop();
  this.setFlag(MODULE_ID, "elevation_increments", elevation_increments);
  this.setFlag(MODULE_ID, "destination_elevation_increment", 0);
  
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
  
  const elevation_increments = this.getFlag(MODULE_ID, "elevation_increments");
  const destination_elevation_increment = this.getFlag(MODULE_ID, "destination_elevation_increment");
  elevation_increments.push(destination_elevation_increment);
  
  const current_elevation = getProperty(token, "data.elevation");
  const new_elevation = current_elevation + (Math.round(elevation_increments[segment_num] *  canvas.scene.data.gridDistance * 100) / 100);
  log(`Adding ${new_elevation} elevation to token.`);
  
  await token.update({ 'elevation': new_elevation });
  return wrapped(token, ray, dx, dy, segment_num);
}


