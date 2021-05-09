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


Object.defineProperty(Ruler.prototype, "elevation_increments", {
  value: [],
  writable: true,
  configurable: true
});

Object.defineProperty(Ruler.prototype, "destination_elevation_increment", {
  value: 0,
  writable: true,
  configurable: true
});

// need a function to change elevation on the ruler item
Object.defineProperty(Ruler.prototype, "changeElevation", {
  value: function changeElevation(elevation_increment) {
    log(`we are changing elevation by ${elevation_increment}!`);
    this.destination_elevation_increment += elevation_increment;
  },
  writable: true,
  configurable: true
});


// will need to update measuring to account for elevation
export function elevationRulerMeasure(wrapped, ...args) {
  log("we are measuring!");
  log(`${this.waypoints.length} waypoints. ${this.destination_elevation_increment} elevation increments.`);
  return wrapped(...args);
}

// moveToken should modify token elevation 
export function elevationRulerMoveToken(wrapped, ...args) {
  log("we are moving!");
  return wrapped(...args);
}

// clear should reset elevation info
export function elevationRulerClear(wrapped, ...args) {
  log("we are clearing!", this);
  
  /**
   * The set of elevation increments corresponding to waypoints.
   * Note: waypoint 0 is origin and should be elevation 0 (no increment +/-)
   * type: Array of integers
   */  
  // setFlag not a function for Ruler object
  this.elevation_increments = [];
  
  /**
   * The current destination point elevation increment relative to origin.
   * type: integer
   */ 
  this.destination_elevation_increment = 0;
  
  
  return wrapped(...args);
}

// update will need to transfer relevant elevation data (probably?)
export function elevationRulerUpdate(wrapped, ...args) {
  log("we are updating!", this);
  return wrapped(...args);
}

// adding waypoint should also add elevation info
export function elevationRulerAddWaypoint(wrapped, ...args) {
  log("adding waypoint!");
  return wrapped(...args);
}

export function incrementElevation() {
  const ruler = canvas.controls.ruler;
  log("Trying to increment...", ruler);
  if(!ruler || !ruler.active) return;
  ruler.changeElevation(1);
}

export function decrementElevation() {
  const ruler = canvas.controls.ruler;
  log("Trying to decrement...", ruler);
  if(!ruler || !ruler.active) return;
  ruler.changeElevation(-1);
}

