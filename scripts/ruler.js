/* globals
canvas
*/
"use strict";

import { log } from "./module.js";


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

/*
UX goals:
1. Ruler origin elevation is the starting token elevation, if any, or the terrain elevation.
2. Dragging the ruler to the next space may cause it to drop if the token is elevated.
- This is probably fine? If flying while everyone else is on the ground, the default should
    account for that.
- A bit cumbersome if measuring straight across elevated terrain, but (a) use terrain layer and
    (b) other elevated tokens should change the destination elevation automatically. (see 3 below)
3. If the destination space is an elevated token or terrain, use that elevation for destination.
- So measuring that space will change the ruler elevation indicator accordingly.
- This will cause the elevation indicator to change without other user input. This is probably fine?
    User will be dragging the ruler, so that is appropriate feedback.
4. User can at any time increment or decrement. This is absolute, in that it is added on top of any
    default elevations from originating/destination tokens or terrain.
- Meaning, origination could be 0, user increments 5 and then drags to a terrain space of 50; ruler
    would go from 5 to 55.
*/

/**
 * Wrap Ruler.prototype.clear
 * Reset properties used to track when the user increments/decrements elevation
 */
export function clearRuler(wrapper) {
  log("we are clearing!", this);

  // User increments/decrements to the elevation for the current destination
  this.destination._userElevationIncrements = 0;
  this.destination._terrainElevation = () => this.terrainElevationAtDestination();

  return wrapper();
}

/**
 * Wrap Ruler.prototype.addWaypoint
 * Add elevation increments
 */
export function _addWaypointRuler(wrapper, point) {
  log("adding waypoint!");
  wrapper(point);

  const newWaypoint = this.waypoints[this.waypoints.length - 1];
  newWaypoint._terrainElevation = this.terrainElevationAtPoint(point);
  newWaypoint._userElevationIncrements = this.destination._userElevationIncrements;

  this.destination._userElevationIncrements = 0;
}

/**
 * Wrap Ruler.prototype.removeWaypoint
 * Remove elevation increments.
 */
export function _removeWaypointRuler(wrapper, point, { snap = true } = {}) {
  log("removing waypoint!");
  this.destination._userElevationIncrements = 0;
  wrapper(point, { snap });
}

export function incrementElevation() {
  const ruler = canvas.controls.ruler;
  log("Trying to increment...", ruler);
  if ( !ruler || !ruler.active ) return;

  this.destination._userElevationIncrements += 1;
  ruler.measure(ruler.destination);
}

export function decrementElevation() {
  const ruler = canvas.controls.ruler;
  log("Trying to decrement...", ruler);
  if ( !ruler || !ruler.active ) return;

  this.destination._userElevationIncrements -= 1;
  ruler.measure(ruler.destination);
}
