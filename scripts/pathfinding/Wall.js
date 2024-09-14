/* globals
CONST
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { Pathfinder } from "./pathfinding.js";

// Track wall creation, update, and deletion, constructing WallTracerEdges as we go.
// Use to update the pathfinding triangulation.

export const PATCHES = {};
PATCHES.PATHFINDING = {};

/**
 * Hook createWall to update the scene graph and triangulation.
 * @param {Document} document                       The new Document instance which has been created
 * @param {DocumentModificationContext} options     Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
function createWall(document, _options, _userId) {
  if ( document.move === CONST.WALL_MOVEMENT_TYPES.NONE ) return;
  Pathfinder.dirty = true;
}

/**
 * Hook updateWall to update the scene graph and triangulation.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateWall(document, changes, _options, _userId) {
  // Only update the edges if the coordinates or move type have changed.
  if ( !(Object.hasOwn(changes, "c") || Object.hasOwn(changes, "move")) ) return;
  Pathfinder.dirty = true;
}

/**
 * Hook deleteWall to update the scene graph and triangulation.
 * @param {Document} document                       The existing Document which was deleted
 * @param {DocumentModificationContext} options     Additional options which modified the deletion request
 * @param {string} userId                           The ID of the User who triggered the deletion workflow
 */
function deleteWall(_document, _options, _userId) {
  Pathfinder.dirty = true;
}

PATCHES.PATHFINDING.HOOKS = { createWall, updateWall, deleteWall };
