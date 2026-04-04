/* globals
foundry,
game,
Hooks
*/
"use strict";

export const MODULE_ID = "elevationruler";
export const PATHFINDING_ID = "pathfinding";
export const EPSILON = 1e-08;

export const TEMPLATES = {
  DRAWING_CONFIG: `modules/${MODULE_ID}/templates/drawing-config.html`,
};

export const FLAGS = {
  MOVEMENT_PENALTY: "movementPenalty",
};

// Track certain modules that complement features of this module.
export const OTHER_MODULES = {
  TERRAIN_MAPPER: { KEY: "terrainmapper" },
  LEVELS: { KEY: "levels" },
  WALL_HEIGHT: { KEY: "wall-height" },
  DAE: { KEY: "dae" }
};

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  for ( const obj of Object.values(OTHER_MODULES) ) obj.ACTIVE = game.modules.get(obj.KEY)?.active;
});

// API not necessarily available until ready hook. (Likely added at init.)
Hooks.once("ready", function() {
  const tm = OTHER_MODULES.TERRAIN_MAPPER;
  if ( tm.ACTIVE ) tm.API = game.modules.get(tm.KEY).api;
});
