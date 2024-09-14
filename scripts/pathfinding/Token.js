/* globals
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

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
function createToken(_document, _options, _userId) {
  Pathfinder.dirty = true;
}

/**
 * Hook update token to update the scene graph and triangulation.
 * @param {Document} document                       The existing Document which was updated
 * @param {object} changed                          Differential data that was used to update the document
 * @param {Partial<DatabaseUpdateOperation>} options Additional options which modified the update request
 * @param {string} userId                           The ID of the User who triggered the update workflow
 */
function updateToken(document, changed, _options, _userId) {
  if ( !(Object.hasOwn(changed, "x")
      || Object.hasOwn(changed, "y")
      || Object.hasOwn(changed, "elevation")
      || Object.hasOwn(changed, "width")
      || Object.hasOwn(changed, "height")) ) return;
  Pathfinder.dirty = true;
}

/**
 * Hook deleteToken to update the scene graph and triangulation.
 * @param {Document} document                       The existing Document which was deleted
 * @param {DocumentModificationContext} options     Additional options which modified the deletion request
 * @param {string} userId                           The ID of the User who triggered the deletion workflow
 */
function deleteToken(_document, _options, _userId) {
  Pathfinder.dirty = true;
}

PATCHES.PATHFINDING_TOKENS.HOOKS = { createToken, updateToken, deleteToken };
