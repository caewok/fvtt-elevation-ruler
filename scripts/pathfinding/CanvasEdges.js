/* globals
canvas,
Wall
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { SCENE_GRAPH } from "./WallTracer.js";
import { Pathfinder } from "./pathfinding.js";
import { Settings } from "../settings.js";

// Track wall creation, update, and deletion, constructing WallTracerEdges as we go.
// Use to update the pathfinding triangulation.

export const PATCHES = {};
PATCHES.PATHFINDING = {};

// ----- NOTE: Hooks ----- //

/**
 * Hook initializeEdges
 * Set up the SCENE GRAPH with all wall edges.
 */
function initializeEdges() {
  const t0 = performance.now();
  SCENE_GRAPH._reset();
  Settings.setTokenBlocksPathfinding();
  const t1 = performance.now();

  // Use the scene graph to initialize Pathfinder triangulation.
  Pathfinder.initialize();
  const t2 = performance.now();

  console.group(`${MODULE_ID}|Initialized scene graph and pathfinding.`);
  console.debug(`${MODULE_ID}|Constructed scene graph in ${t1 - t0} ms.`)
  console.debug(`${MODULE_ID}|Tracked ${SCENE_GRAPH.wallIds.size} walls.`);
  console.debug(`Tracked ${SCENE_GRAPH.tokenIds.size} tokens.`);
  console.debug(`Located ${SCENE_GRAPH.edges.size} distinct edges.`);
  console.debug(`${MODULE_ID}|Initialized pathfinding in ${t2 - t1} ms.`);
  console.groupEnd();
}

PATCHES.PATHFINDING.HOOKS = { initializeEdges };
