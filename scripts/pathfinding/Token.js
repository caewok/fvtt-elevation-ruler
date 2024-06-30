/* globals
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { SCENE_GRAPH } from "./WallTracer.js";
import { Pathfinder } from "./pathfinding.js";
import { log } from "../util.js";

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
 * Hook refresh token to update the scene graph and triangulation.
 * Cannot use updateToken hook b/c the token position is not correctly updated by that point.
 * @param {PlaceableObject} object    The object instance being refreshed
 */
function refreshToken(object, flags) {
  if ( !flags.refreshPosition || object.isPreview ) return;

  log(`refreshToken hook|original token moved.`);

  // Easiest approach is to trash the edges for the wall and re-create them.
  SCENE_GRAPH.removeToken(object.id);

  /* Debugging: None of the edges should have this token.
  if ( CONFIG[MODULE_ID].debug ) {
    const token = document.object;
    SCENE_GRAPH.edges.forEach((edge, key) => {
      if ( edge.objects.has(token) ) console.debug(`Edge ${key} has ${token.name} ${token.id} after deletion.`);
    })
  }
  */

  SCENE_GRAPH.addToken(object);

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

PATCHES.PATHFINDING_TOKENS.HOOKS = { createToken, deleteToken, refreshToken };
