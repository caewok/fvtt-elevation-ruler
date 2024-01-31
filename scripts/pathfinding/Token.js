/* globals
canvas,
Hooks
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { MODULE_ID } from "../const.js";
import { SCENE_GRAPH } from "./WallTracer.js";
import { Pathfinder } from "./pathfinding.js";

// Track wall creation, update, and deletion, constructing WallTracerEdges as we go.
// Use to update the pathfinding triangulation.

export const PATCHES = {};
PATCHES.PATHFINDING_TOKENS = {};

/**
 * Hook createToken to update the scene graph and triangulation.
 * @param {Document} document                       The new Document instance which has been created
 * @param {DocumentModificationContext} options     Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
function createToken(document, _options, _userId) {
  SCENE_GRAPH.addToken(document.object);
  Pathfinder.dirty = true;
}

/**
 * Hook updateToken to update the scene graph and triangulation.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateToken(document, changes, _options, _userId) {
  // Only update the edges if the coordinates have changed.
  if ( !Object.hasOwn(changes, "c") ) return;

  // Easiest approach is to trash the edges for the wall and re-create them.
  SCENE_GRAPH.removeToken(document.id);
  SCENE_GRAPH.addToken(document.object);

  // Need to re-do the triangulation because the change to the wall could have added edges if intersected.
  Pathfinder.dirty = true;
}

/**
 * Hook deleteToken to update the scene graph and triangulation.
 * @param {Document} document                       The existing Document which was deleted
 * @param {DocumentModificationContext} options     Additional options which modified the deletion request
 * @param {string} userId                           The ID of the User who triggered the deletion workflow
 */
function deleteToken(document, _options, _userId) {
  SCENE_GRAPH.removeToken(document.id); // The document.object is now null; use the id to remove the wall.
  Pathfinder.dirty = true;
}

PATCHES.PATHFINDING_TOKENS.HOOKS = { createToken, updateToken, deleteToken };
