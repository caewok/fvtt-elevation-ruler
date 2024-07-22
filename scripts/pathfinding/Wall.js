/* globals
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

import { SCENE_GRAPH } from "./WallTracer.js";
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
  SCENE_GRAPH.addWall(document.object);
  Pathfinder.dirty = true;
  const res = SCENE_GRAPH._checkInternalConsistency();
  if ( !res.allConsistent ) {
    log(`WallTracer|createWall ${document.id} resulted in inconsistent graph.`, SCENE_GRAPH, res);
    SCENE_GRAPH.reset();
  }
}

/**
 * Hook updateWall to update the scene graph and triangulation.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} change                           Differential data that was used to update the document
 * @param {DocumentModificationContext} options     Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateWall(document, changes, _options, _userId) {
  // Only update the edges if the coordinates have changed.
  if ( !Object.hasOwn(changes, "c") ) return;

  // Easiest approach is to trash the edges for the wall and re-create them.
  SCENE_GRAPH.removeWall(document.id);
  SCENE_GRAPH.addWall(document.object);
  Pathfinder.dirty = true;
  const res = SCENE_GRAPH._checkInternalConsistency();
  if ( !res.allConsistent ) {
    log(`WallTracer|updateWall ${document.id} resulted in inconsistent graph.`, SCENE_GRAPH, res);
    SCENE_GRAPH.reset();
  }
}

/**
 * Hook deleteWall to update the scene graph and triangulation.
 * @param {Document} document                       The existing Document which was deleted
 * @param {DocumentModificationContext} options     Additional options which modified the deletion request
 * @param {string} userId                           The ID of the User who triggered the deletion workflow
 */
function deleteWall(document, _options, _userId) {
  SCENE_GRAPH.removeWall(document.id); // The document.object is now null; use the id to remove the wall.
  Pathfinder.dirty = true;
  const res = SCENE_GRAPH._checkInternalConsistency();
  if ( !res.allConsistent ) {
    log(`WallTracer|deleteWall ${document.id} resulted in inconsistent graph.`, SCENE_GRAPH, res);
    SCENE_GRAPH.reset();
  }
}

PATCHES.PATHFINDING.HOOKS = { createWall, updateWall, deleteWall };
