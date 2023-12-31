/* globals
game,
Hooks
*/
"use strict";

export const MODULE_ID = "elevationruler";
export const EPSILON = 1e-08;

export const MODULES_ACTIVE = {
  DRAG_RULER: false,
  ELEVATED_VISION: false,
  ENHANCED_TERRAIN_LAYER: false,
  LEVELS: false
};

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function() {
  MODULES_ACTIVE.DRAG_RULER = game.modules.get("drag-ruler")?.active;
  MODULES_ACTIVE.ENHANCED_TERRAIN_LAYER = game.modules.get("enhanced-terrain-layer")?.active;
  MODULES_ACTIVE.LEVELS = game.modules.get("levels")?.active;
  MODULES_ACTIVE.ELEVATED_VISION = game.modules.get("elevatedvision")?.active;
});
