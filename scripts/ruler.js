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


