import { MODULE_ID, log } from "./module.js";

/*
 * Add flags to the segment specific to elevation:
 * - incremental elevation of the segment
 * - starting elevation of the segment 
 * - ending elevation of the segment 
 */
export function elevationRulerAddProperties(wrapped, ...args) {
  if(this.segment_num < 0) {
    console.error(`${MODULE_ID}|libRulerAddProperties: this.segment_num is less than zero`, this);
    return;
  }

  const elevation_increments = duplicate(this.ruler.getFlag(MODULE_ID, "elevation_increments"));
  log(`${elevation_increments.length} elevation increments for ruler flag.`)
  
  const destination_elevation_increment = this.ruler.getFlag(MODULE_ID, "destination_elevation_increment");
  elevation_increments.push(destination_elevation_increment);
  log(`${this.ruler.getFlag(MODULE_ID, "elevation_increments").length} elevation increments for ruler flag.`);
  
  
  elevation_increments.shift(); //first increment is 0 for the origin waypoint
  const incremental_elevation = (Math.round(elevation_increments[this.segment_num] *  canvas.scene.data.gridDistance * 100) / 100)
  
  let starting_elevation = 0;
  if(this.segment_num === 0) {
    // starting elevation equals the token elevation 
    const token = this.ruler._getMovementToken();
    if(token) {
      starting_elevation = getProperty(token, "data.elevation");
    }
    
  } else {
    // starting elevation is the prior segment end elevation
    starting_elevation = this.prior_segment.getFlag(MODULE_ID, "ending_elevation");    
    log(`Current ending elevation is ${this.getFlag(MODULE_ID, "ending_elevation")}; Prior segment ending elevation is ${starting_elevation}`);
  }
  
  const ending_elevation = starting_elevation + incremental_elevation;
  
  // Track whether any elevation change has been request for ruler labeling.
  const path_has_elevation_change = incremental_elevation !== 0 || this.prior_segment.getFlag(MODULE_ID, "path_has_elevation_change");
  
  this.setFlag(MODULE_ID, "starting_elevation", starting_elevation);
  this.setFlag(MODULE_ID, "ending_elevation", ending_elevation);
  this.setFlag(MODULE_ID, "incremental_elevation", incremental_elevation)
  this.setFlag(MODULE_ID, "path_has_elevation_change", path_has_elevation_change);
  
  return wrapped(...args);
}

export function elevationRulerConstructPhysicalPath(wrapped, ...args) {
  // elevate or lower the destination point in 3-D space
  // measure from the origin of the ruler movement, so that canvas = 0 and each segment
  // could in theory be connected in space
  //  --> this is done in AddProperties function

  const default_path = wrapped(...args);
  
  const starting_elevation = this.getFlag(MODULE_ID, "starting_elevation");
  const ending_elevation = this.getFlag(MODULE_ID, "ending_elevation");
  const elevation_delta = ending_elevation - starting_elevation;
  
  // For each point on the path, provide an elevation proportional to the distance
  //   compared to the ruler segment distance.
  // This accommodates situations where the destination to measure does not equal segment
  //   destination
  const ruler_distance = this.ray.distance;  
  default_path.map(p => {
    const simple_path_distance = CalculateDistance(default_path[0], p);
    const ratio = simple_path_distance / ruler_distance;
    
    p.z = starting_elevation + elevation_delta * ratio;
    
    return p;
  });
  
  return default_path;
}

export function elevationRulerDistanceFunction(wrapped, physical_path) {
  // Project the 3-D path to 2-D canvas
  log(`Projecting physical_path from origin ${physical_path[0].x, physical_path[0].y, physical_path[0].z}`);
  
  // for each of the points, construct a 2-D path and send to the underlying function
  // may need more testing when there are multiple points in the physical path, rather
  // than just origin and destination...
  const projected_physical_path = [{x: physical_path[0].x,
                                    y: physical_path[0].y }];
  
  for(let i = 1; i < physical_path.length; i++) {
      const height = physical_path[i].z - physical_path[i - 1].z;
      const elevated_destination = ProjectElevatedPoint(physical_path[i - 1], physical_path[i], height);      
      projected_physical_path.push(elevated_destination);      
    }
  
  return wrapped(projected_physical_path);
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
export function elevationRulerGetText(wrapped, ...args) {
  const orig_label = wrapped(...args);
  log(`Adding to segment label ${orig_label}`, this);
  
  const ending_elevation = this.getFlag(MODULE_ID, "ending_elevation");
  const incremental_elevation = this.getFlag(MODULE_ID, "incremental_elevation");
  
  // if no elevation change for any segment, then skip.
  const path_has_elevation_change = this.getFlag(MODULE_ID, "path_has_elevation_change");
  
  if(!path_has_elevation_change) { return orig_label; }
  
  const elevation_label = segmentElevationLabel(incremental_elevation, ending_elevation, orig_label)
  log(`elevation_label is ${elevation_label}`);
  return orig_label + "\n" + elevation_label;
}

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


// ----- MATH FOR MEASURING ELEVATION DISTANCE ----- //
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
