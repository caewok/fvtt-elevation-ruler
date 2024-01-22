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
PATCHES.PATHFINDING = {};


// When canvas is ready, the existing walls are not created, so must re-do here.
Hooks.on("canvasReady", async function() {
  const t0 = performance.now();
  SCENE_GRAPH.clear();
  const walls = [
    ...canvas.walls.placeables,
    ...canvas.walls.outerBounds,
    ...canvas.walls.innerBounds
  ];
  for ( const wall of walls ) SCENE_GRAPH.addWall(wall);
  const t1 = performance.now();

  // Use the scene graph to initialize Pathfinder triangulation.
  Pathfinder.initialize();
  const t2 = performance.now();

  console.debug(`${MODULE_ID}|Tracked ${walls.length} walls in ${t1 - t0} ms.`);
  console.debug(`${MODULE_ID}|Initialized pathfinding in ${t2 - t1} ms.`);
});


/**
 * Hook createWall to update the scene graph and triangulation.
 * @param {Document} document                       The new Document instance which has been created
 * @param {DocumentModificationContext} options     Additional options which modified the creation request
 * @param {string} userId                           The ID of the User who triggered the creation workflow
 */
function createWall(document, _options, _userId) {
  SCENE_GRAPH.addWall(document.object);
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
  // Only update the edges if the coordinates have changed.
  if ( !Object.hasOwn(changes, "c") ) return;

  // Easiest approach is to trash the edges for the wall and re-create them.
  SCENE_GRAPH.removeWall(document.id);
  SCENE_GRAPH.addWall(document.object);

  // Need to re-do the triangulation because the change to the wall could have added edges if intersected.
  Pathfinder.dirty = true;
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
}

PATCHES.PATHFINDING.HOOKS = { createWall, updateWall, deleteWall };
