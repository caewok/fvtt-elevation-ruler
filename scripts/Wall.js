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
 * When the walls layer is deactivated, check for modified walls.
 *
 * A hook event that fires with a {@link foundry.canvas.layers.InteractionLayer} becomes inactive.
 * The dispatched event name replaces "Layer" with the named InteractionLayer subclass, i.e. "deactivateTokensLayer".
 * @event
 * @category InteractionLayer
 * @param {InteractionLayer} layer    The layer becoming inactive
 */

let updatesMade = false;

function deactivateWallsLayer(layer) {
  if ( !updatesMade ) return;

  // Trigger a full update of the static terrain.
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
  "ds",
]);

function updateWall(wallD, changed, options, userId) {
  const PF = Settings.KEYS.PATHFINDING;
  if ( Settings.get(PF.ALGORITHM) !== PF.ALGORITHM_CHOICES.WEBGPU ) return;

  // Record the update for once we move out of the walls layer.
  if ( canvas.walls.active ) {
    if ( updatesMade ) return;
    const changeKeys = Object.keys(foundry.utils.flattenObject(changed));
    if ( changeKeys.some(key => DOCUMENT_KEYS.has(key)) ) updatesMade = true;
    return;
  }

  // Not in the walls layer.
  if ( !Object.hasOwn(changed, "ds") ) return;

  // Door opened or closed while not in the walls layer.
  // Update that door state in WebGPU pathfinding.
  const doorAction = changed.ds === CONST.WALL_DOOR_STATES.OPEN ? "openDoors" : "closeDoors";
  WebGPUPathfinderWithWorker[doorAction]({ walls: wallD.object }); // Async.
}

PATCHES.BASIC.HOOKS = {
  updateWall,
  deactivateWallsLayer,
};