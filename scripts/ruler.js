import { log } from "./module.js";


/**
 * Modified Ruler 
 * Measure elevation change at each waypoint and destination.
 * Modify distance calculation accordingly.
 * Display current elevation change and change at each waypoint.
 */
 
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

export function elevationRulerMeasure(wrapped, ...args) {
  console.log("Elevation Ruler|we are measuring!");
  return wrapped(...args);
}
