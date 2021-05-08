import { log } from "./module.js";


/**
 * Modified Ruler 
 * Measure elevation change at each waypoint and destination.
 * Modify distance calculation accordingly.
 * Display current elevation change and change at each waypoint.
 */
 
// wrapping the constructor appears not to work.
export function elevationRulerConstructor(wrapped, ...args) {
  console.log("Elevation Ruler|wrapper elevationRulerConstructor called.");
  return wrapped(...args);
  
  //log("elevationRulerConstructor this", this)
  //let result = wrapped(...args);
  
  
  /**
   * This Array tracks elevation change at waypoints along the measured path.
   * The first waypoint is always the origin of the route. See class Ruler.
   * @type {Array.integer}
   */
  //this.elevation_increments = [];
  
  /**
   * This elevation labels element is a container of Text elements which label
   *   elevation changes along the measured path. 
   * Cf. Range.labels.
   * @type {PIXI.Container}
   */
  //this.elevation_labels = this.addChild(new PIXIContainer());
  
  /**
   * Track the elevation state of the destination, relative to origin
   * @type {number}
   */
  //this.destination_elevation_increment = 0;
  
  //log("elevationRulerConstructor this after", this);
  //log("elevationRulerConstructor result", result);
  
  //return result;
}


// will need to update measuring to account for elevation
export function elevationRulerMeasure(wrapped, ...args) {
  log("we are measuring!", this);
  return wrapped(...args);
}

// moveToken should modify token elevation 
export function elevationRulerMoveToken(wrapped, ...args) {
  log("we are moving!", this);
  return wrapped(...args);
}

// clear should reset elevation info
export function elevationRulerClear(wrapped, ...args) {
  log("we are clearing!", this);
  return wrapped(...args);
}

// update will need to transfer relevant elevation data (probably?)
export function elevationRulerUpdate(wrapped, ...args) {
  log("we are updating!", this);
  return wrapped(...args);
}

// adding waypoint should also add elevation info
export function elevationRulerAddWaypoint(wrapped, ...args) {
  log("adding waypoint!", this);
  return wrapped(...args);
}





