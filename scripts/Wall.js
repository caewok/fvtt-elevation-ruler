/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Settings } from "./settings.js";
import { WebGPUPathfinderWithWorker } from "./pathfinding/WebGPUPathfinding.js";

// Patches for the Wall class
export const PATCHES = {};
PATCHES.BASIC = {};

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
  "flags.wall-height.top",
  "flags.wall-height.top",
  "c",
  "dir",
  "light",
  "move",
  "sight",
  "sound",
  "dir",
  "light",
  "move",
  "sight",
  "sound",
  "door",
]);

function updateWall(wallD, changed, options, userId) {
  const PF = Settings.KEYS.PATHFINDING;
  if ( Settings.get(PF.ALGORITHM) !== PF.ALGORITHM_CHOICES.WEBGPU ) return;
  if ( WebGPUPathfinderWithWorker.currentElevationZ === null ) return;

  const changeKeys = Object.keys(foundry.utils.flattenObject(changed));
  if ( changeKeys.some(key => DOCUMENT_KEYS.has(key)) ) {
    WebGPUPathfinderWithWorker.currentElevationZ = null;
    return;
  }

  // Otherwise, check if a door state has changed and update the static terrain.
  // Could do this update per-wall, but that would likely be overkill.
  if ( Object.hasOwn(changed, "ds") ) {
    const doorAction = changed.ds === CONST.WALL_DOOR_STATES.OPEN ? "openDoors" : "closeDoors";
    WebGPUPathfinderWithWorker[doorAction]({ walls: wallD.object }); // Async.
  }
}

PATCHES.BASIC.HOOKS = {
  updateWall,
};