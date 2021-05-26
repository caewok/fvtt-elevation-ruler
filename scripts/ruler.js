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


