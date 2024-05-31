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
  SCENE_GRAPH.clear();
  let numWalls = 0;
  for ( const edge of canvas.edges.values() ) {
    if ( edge.object instanceof Wall ) {
      SCENE_GRAPH.addWall(edge.object);
      numWalls += 1;
    } else if ( edge.type === "outerBounds"
             || edge.type === "innerBounds" ) SCENE_GRAPH.addCanvasEdge(edge);
  }

  Settings.setTokenBlocksPathfinding();
  const t1 = performance.now();

  // Use the scene graph to initialize Pathfinder triangulation.
  Pathfinder.initialize();
  const t2 = performance.now();

  console.debug(`${MODULE_ID}|Tracked ${numWalls} walls in ${t1 - t0} ms.`);
  console.debug(`${MODULE_ID}|Initialized pathfinding in ${t2 - t1} ms.`);
}

PATCHES.PATHFINDING.HOOKS = { initializeEdges };
