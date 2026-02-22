/* globals
canvas,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Settings } from "./settings.js";
import { WebGPUPathfinder } from "./pathfinding/WebGPUPathfinding.js";

// Patches for the Region class
export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * If a region is modified, invalidate the current subject token for WebGPUPathfinderWithWorker.
 * Forces a later update.
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

function updateRegion(regionD, changed, _options, _userId) {
  const PF = Settings.KEYS.PATHFINDING;
  if ( !canvas.regions.active || Settings.get(PF.ALGORITHM) !== PF.ALGORITHM_CHOICES.WEBGPU ) return;
  if ( WebGPUPathfinder.currentTokenId === "" ) return;

  const changeKeys = Object.keys(foundry.utils.flattenObject(changed));
  if ( changeKeys.some(key => DOCUMENT_KEYS.has(key)) ) WebGPUPathfinder.currentTokenId = "";
}

PATCHES.BASIC.HOOKS = {
  updateRegion,
};
