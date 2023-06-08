/* globals
CONFIG,
libWrapper
*/
"use strict";

import { MODULE_ID } from "./const.js";
import { log } from "./util.js";
import {
  clearRuler,
  _addWaypointRuler,
  dragRulerAddWaypointDragRulerRuler,
  dragRulerClearWaypointsDragRuleRuler,
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
  _animateSegmentRuler,
  _onDragLeftDropToken } from "./segments.js";

import {
  terrainElevationAtPoint,
  terrainElevationAtDestination,
  elevationAtOrigin } from "./terrain_elevation.js";

/**
 * Helper to wrap methods.
 * @param {string} method       Method to wrap
 * @param {function} fn         Function to use for the wrap
 * @param {object} [options]    Options passed to libWrapper.register. E.g., { perf_mode: libWrapper.PERF_FAST}
 */
function wrap(method, fn, options = {}) { libWrapper.register(MODULE_ID, method, fn, libWrapper.WRAPPER, options); }

/**
 * Helper to add a method to a class.
 * @param {class} cl      Either Class.prototype or Class
 * @param {string} name   Name of the method
 * @param {function} fn   Function to use for the method
 */
function addClassMethod(cl, name, fn) {
  Object.defineProperty(cl, name, {
    value: fn,
    writable: true,
    configurable: true
  });
}

export function registerRuler() {

  // Basic ruler methods
  wrap("CONFIG.Canvas.rulerClass.prototype.clear", clearRuler);
  wrap("CONFIG.Canvas.rulerClass.prototype._addWaypoint", _addWaypointRuler);
  wrap("CONFIG.Canvas.rulerClass.prototype._removeWaypoint", _removeWaypointRuler);

  // Pass needed variables across the sockets
  wrap("CONFIG.Canvas.rulerClass.prototype.toJSON", toJSONRuler);
  wrap("CONFIG.Canvas.rulerClass.prototype.update", updateRuler);

  // Ruler methods related to ruler segments
  wrap("CONFIG.Canvas.rulerClass.prototype._getMeasurementSegments", _getMeasurementSegmentsRuler);
  wrap("GridLayer.prototype.measureDistances", measureDistancesGridLayer);
  wrap("CONFIG.Canvas.rulerClass.prototype._getSegmentLabel", _getSegmentLabelRuler);

  // Move token methods
  wrap("CONFIG.Canvas.rulerClass.prototype._animateSegment", _animateSegmentRuler);

  addClassMethod(CONFIG.Canvas.rulerClass.prototype, "terrainElevationAtPoint", terrainElevationAtPoint);
  addClassMethod(CONFIG.Canvas.rulerClass.prototype, "terrainElevationAtDestination", terrainElevationAtDestination);
  addClassMethod(CONFIG.Canvas.rulerClass.prototype, "incrementElevation", incrementElevation);
  addClassMethod(CONFIG.Canvas.rulerClass.prototype, "decrementElevation", decrementElevation);
  addClassMethod(CONFIG.Canvas.rulerClass.prototype, "terrainElevationAtPoint", terrainElevationAtPoint);
  addClassMethod(CONFIG.Canvas.rulerClass.prototype, "terrainElevationAtDestination", terrainElevationAtDestination);
  addClassMethod(CONFIG.Canvas.rulerClass.prototype, "elevationAtOrigin", elevationAtOrigin);

  log("registerRuler finished!");
}

export function registerDragRuler() {
  wrap("CONFIG.Canvas.rulerClass.prototype._getMeasurementSegments", _getMeasurementSegmentsDragRulerRuler);
  wrap("CONFIG.Canvas.rulerClass.prototype.dragRulerClearWaypoints", dragRulerClearWaypointsDragRuleRuler);
  wrap("CONFIG.Canvas.rulerClass.prototype.dragRulerAddWaypoint", dragRulerAddWaypointDragRulerRuler);

  wrap("CONFIG.Token.objectClass.prototype._onDragLeftDrop", _onDragLeftDropToken);
}
