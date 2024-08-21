/* globals
foundry,
game
*/
"use strict";

import { Patcher } from "./Patcher.js";

import { PATCHES as PATCHES_Ruler } from "./Ruler.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_ClientKeybindings } from "./ClientKeybindings.js";
import { PATCHES as PATCHES_DrawingConfig } from "./DrawingConfig.js";

// Measuring distance
import { PATCHES_GridlessGrid, PATCHES_SquareGrid, PATCHES_HexagonalGrid } from "./measurement/Grid.js";

// Pathfinding
import { PATCHES as PATCHES_Wall } from "./pathfinding/Wall.js";
import { PATCHES as PATCHES_CanvasEdges } from "./pathfinding/CanvasEdges.js";
import { PATCHES as PATCHES_TokenPF } from "./pathfinding/Token.js";

// Movement tracking
import { PATCHES as PATCHES_TokenHUD } from "./token_hud.js";
import { PATCHES as PATCHES_CombatTracker } from "./CombatTracker.js";

// Settings
import { PATCHES as PATCHES_ClientSettings } from "./ModuleSettingsAbstract.js";


const mergeObject = foundry.utils.mergeObject;
const PATCHES = {
  ClientKeybindings: PATCHES_ClientKeybindings,
  ClientSettings: PATCHES_ClientSettings,
  CombatTracker: PATCHES_CombatTracker,
  ["foundry.canvas.edges.CanvasEdges"]: PATCHES_CanvasEdges,
  DrawingConfig: PATCHES_DrawingConfig,
  ["foundry.grid.GridlessGrid"]: PATCHES_GridlessGrid,
  ["foundry.grid.HexagonalGrid"]: PATCHES_HexagonalGrid,
  ["foundry.grid.SquareGrid"]: PATCHES_SquareGrid,
  ["CONFIG.Canvas.rulerClass"]: PATCHES_Ruler,
  Token: mergeObject(mergeObject(PATCHES_Token, PATCHES_TokenPF), PATCHES_TokenHUD),
  Wall: PATCHES_Wall
};

export const PATCHER = new Patcher();


export function initializePatching() {
  PATCHER.addPatchesFromRegistrationObject(PATCHES);
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup("PATHFINDING");
  PATCHER.registerGroup("TOKEN_RULER");
  PATCHER.registerGroup("SPEED_HIGHLIGHTING");
  PATCHER.registerGroup("MOVEMENT_TRACKING");

  if ( game.system.id !== "dnd5e" ) PATCHER.registerGroup("MOVEMENT_SELECTION");
}

