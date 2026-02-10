/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Settings } from "./settings.js";
import { WebGPUPathfinderWithWorker } from "./pathfinding/WebGPUPathfinding.js";

// Patches for the Region class
export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * When the walls layer is deactivated, check for modified walls.
 *
 * A hook event that fires with a {@link foundry.canvas.layers.InteractionLayer} becomes inactive.
 * The dispatched event name replaces "Layer" with the named InteractionLayer subclass, i.e. "deactivateTokensLayer".
 * @event
 * @category InteractionLayer
 * @param {InteractionLayer} layer    The layer becoming inactive
 */

let updatesMade = false;

function deactivateRegionsLayer(layer) {
  if ( !updatesMade ) return;

  // Trigger full update of the region difficult terrain.
  const PF = Settings.KEYS.PATHFINDING;
  if ( Settings.get(PF.ALGORITHM) !== PF.ALGORITHM_CHOICES.WEBGPU ) return;
  WebGPUPathfinderWithWorker.updateStaticTerrain(); // Async.
}

/**
 * If a door is opened or closed, modify the WebGPUPathfinder static terrain for that door.
 *
 * A hook event that fires for every Document type after conclusion of an update workflow.
 * Substitute the Document name in the hook event to target a specific Document type, for example "updateActor".
 * This hook fires for all connected clients after the update has been processed.
 * @event
 * @category Document
 * @param {Document} document                       The existing Document which was updated
 * @param {object} changed                          Differential data that was used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
const DOCUMENT_KEYS = new Set([
  "shapes",
  "flags.terrainmapper.rampDirection",
  "flags.terrainmapper.splitPolygons",
  "flags.terrainmapper.elevationAlgorithm",
  "elevation.bottom",
  "elevation.top",
  "flags.terrainmapper.plateauElevation",
  "flags.terrainmapper.rampFloor",
]);

function updateRegion(regionD, changed, options, userId) {
  const PF = Settings.KEYS.PATHFINDING;
  if ( !canvas.regions.active || Settings.get(PF.ALGORITHM) !== PF.ALGORITHM_CHOICES.WEBGPU ) return;

  if ( canvas.regions.active ) {
    if ( updatesMade ) return;
    const changeKeys = Object.keys(foundry.utils.flattenObject(changed));
    if ( changeKeys.some(key => DOCUMENT_KEYS.has(key)) ) updatesMade = true;
    return;
  }
}

PATCHES.BASIC.HOOKS = {
  updateRegion,
  deactivateRegionsLayer,
};
