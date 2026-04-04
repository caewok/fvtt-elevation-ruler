/* globals
CONFIG,
CONST,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "./const.js";
import { Settings } from "./settings.js";
import { WebGPUPathfinder } from "./pathfinding/WebGPUPathfinding.js";

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

function updateWall(wallD, changed, _options, _userId) {
  // Update scene graph.
  const graph = CONFIG[MODULE_ID].sceneGraph;
  if ( graph ) {
    graph.removePlaceable(wallD.object);
    graph.addWall(wallD.object);
  }


  const PF = Settings.KEYS.PATHFINDING;
  if ( Settings.get(PF.ALGORITHM) !== PF.ALGORITHM_CHOICES.WEBGPU ) return;
  if ( WebGPUPathfinder.currentElevationZ === null ) return;

  const changeKeys = Object.keys(foundry.utils.flattenObject(changed));
  if ( changeKeys.some(key => DOCUMENT_KEYS.has(key)) ) {
    WebGPUPathfinder.currentElevationZ = null;
    return;
  }

  // Otherwise, check if a door state has changed and update the static terrain.
  // Could do this update per-wall, but that would likely be overkill.
  if ( Object.hasOwn(changed, "ds") ) {
    const doorAction = changed.ds === CONST.WALL_DOOR_STATES.OPEN ? "openDoors" : "closeDoors";
    WebGPUPathfinder[doorAction]({ walls: wallD.object }); // Async.
  }
}

/**
 * On wall creation, update scene graph.
 * @event
 * @category Document
 * @param {Document} document                       The new Document instance which has been created
 * @param {Partial<DatabaseCreateOperation>} options Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
function createWall(wallD, _options, _userId) {
  const graph = CONFIG[MODULE_ID].sceneGraph;
  if ( graph ) graph.addWall(wallD.object);
}

/**
 * On wall destruction, update scene graph.
 * Cannot use deleteWall because cannot access the placeable there.
 * GC is not collecting the deleted wall, so cannot simply rely on weakset to remove it.
 * @event
 * @category PlaceableObject
 * @param {PlaceableObject} object    The object instance being destroyed
 */
function destroyWall(wall) {
  // Cannot access the wall placeable, but it should be removed from graph placeables weak set already.
  // Update the scene graph.
  const graph = CONFIG[MODULE_ID].sceneGraph;
  if ( graph ) graph.removePlaceable(wall);
}


PATCHES.BASIC.HOOKS = {
  createWall,
  updateWall,
  destroyWall,
};
