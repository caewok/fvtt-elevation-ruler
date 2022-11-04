/* globals
libWrapper,
Ruler,
game
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { log } from "./util.js";
import {
  clearRuler,
  _addWaypointRuler,
  _removeWaypointRuler,
  incrementElevation,
  decrementElevation,
  toJSONRuler,
  updateRuler } from "./ruler.js";

import {
  _getMeasurementSegmentsRuler,
  _getMeasurementSegmentsDragRulerRuler,
  measureDistancesGridLayer,
  _getSegmentLabelRuler,
  _animateSegmentRuler } from "./segments.js";

import {
  terrainElevationAtPoint,
  terrainElevationAtDestination,
  elevationAtOrigin } from "./terrain_elevation.js";

export function registerRuler() {

  // Basic ruler methods
  libWrapper.register(MODULE_ID, "Ruler.prototype.clear", clearRuler, libWrapper.WRAPPER);
  libWrapper.register(MODULE_ID, "Ruler.prototype._addWaypoint", _addWaypointRuler, libWrapper.WRAPPER);
  libWrapper.register(MODULE_ID, "Ruler.prototype._removeWaypoint", _removeWaypointRuler, libWrapper.WRAPPER);

  // Pass needed variables across the sockets
  libWrapper.register(MODULE_ID, "Ruler.prototype.toJSON", toJSONRuler, libWrapper.WRAPPER);
  libWrapper.register(MODULE_ID, "Ruler.prototype.update", updateRuler, libWrapper.WRAPPER);

  // Ruler methods related to ruler segments
  libWrapper.register(MODULE_ID, "Ruler.prototype._getMeasurementSegments", _getMeasurementSegmentsRuler, libWrapper.WRAPPER);
  libWrapper.register(MODULE_ID, "GridLayer.prototype.measureDistances", measureDistancesGridLayer, libWrapper.WRAPPER);
  libWrapper.register(MODULE_ID, "Ruler.prototype._getSegmentLabel", _getSegmentLabelRuler, libWrapper.WRAPPER);

  // Move token methods
  libWrapper.register(MODULE_ID, "Ruler.prototype._animateSegment", _animateSegmentRuler, libWrapper.WRAPPER);

  Object.defineProperty(Ruler.prototype, "terrainElevationAtPoint", {
    value: terrainElevationAtPoint,
    writable: true,
    configurable: true
  });

  Object.defineProperty(Ruler.prototype, "terrainElevationAtDestination", {
    value: terrainElevationAtDestination,
    writable: true,
    configurable: true
  });

  Object.defineProperty(Ruler.prototype, "incrementElevation", {
    value: incrementElevation,
    writable: true,
    configurable: true
  });

  Object.defineProperty(Ruler.prototype, "decrementElevation", {
    value: decrementElevation,
    writable: true,
    configurable: true
  });

  Object.defineProperty(Ruler.prototype, "terrainElevationAtPoint", {
    value: terrainElevationAtPoint,
    writable: true,
    configurable: true
  });

  Object.defineProperty(Ruler.prototype, "terrainElevationAtDestination", {
    value: terrainElevationAtDestination,
    writable: true,
    configurable: true
  });

  Object.defineProperty(Ruler.prototype, "elevationAtOrigin", {
    value: elevationAtOrigin,
    writable: true,
    configurable: true
  });

  log("registerRuler finished!");
}

export function registerDragRuler() {
  libWrapper.register(MODULE_ID, "CONFIG.Canvas.rulerClass.prototype._getMeasurementSegments", _getMeasurementSegmentsDragRulerRuler, libWrapper.WRAPPER);
}
