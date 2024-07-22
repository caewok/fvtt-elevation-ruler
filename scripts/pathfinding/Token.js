/* globals
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { SCENE_GRAPH } from "./WallTracer.js";
import { Pathfinder } from "./pathfinding.js";
import { log } from "../util.js";
import { MODULE_ID } from "../const.js";

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
  if ( CONFIG[MODULE_ID].debug ) {
    const res = SCENE_GRAPH._checkInternalConsistency();
    if ( !res.allConsistent ) console.warn(`WallTracer|createToken ${document.id} resulted in inconsistent graph.`, SCENE_GRAPH, res);
  }
}

/**
 * Hook update token to update the scene graph and triangulation.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} changed                          Differential data that was used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateToken(document, changed, options, userId) {
  if ( !(Object.hasOwn(changed, "x")
      || Object.hasOwn(changed, "y")
      || Object.hasOwn(changed, "elevation")
      || Object.hasOwn(changed, "width")
      || Object.hasOwn(changed, "height")) ) return;

  // Token document source may not match token document b/c of token movement.
  // Temporarily change to match.
  const { x, y, elevation } = document;
  document.x = document._source.x;
  document.y = document._source.y;
  document.elevation = document._source.elevation;

  // Easiest approach is to trash the edges for the token and re-create them.
  SCENE_GRAPH.removeToken(document.id);
  SCENE_GRAPH.addToken(document.object);
  Pathfinder.dirty = true;
  if ( CONFIG[MODULE_ID].debug ) {
    const res = SCENE_GRAPH._checkInternalConsistency();
    if ( !res.allConsistent ) console.warn(`WallTracer|updateToken ${document.id} resulted in inconsistent graph.`, SCENE_GRAPH, res);
  }

  // Restore original token doc values.
  document.x = x;
  document.y = y;
  document.elevation = elevation;
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
  if ( CONFIG[MODULE_ID].debug ) {
    const res = SCENE_GRAPH._checkInternalConsistency();
    if ( !res.allConsistent ) console.warn(`WallTracer|deleteToken ${document.id} resulted in inconsistent graph.`, SCENE_GRAPH, res);
  }
}

PATCHES.PATHFINDING_TOKENS.HOOKS = { createToken, updateToken, deleteToken };
