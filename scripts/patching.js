/* globals
*/
"use strict";

import { Patcher } from "./Patcher.js";
import { MODULES_ACTIVE } from "./const.js";

import { PATCHES as PATCHES_Ruler } from "./Ruler.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_GridLayer } from "./GridLayer.js";
import { PATCHES as PATCHES_ClientKeybindings } from "./ClientKeybindings.js";
import { PATCHES as PATCHES_BaseGrid } from "./BaseGrid.js";
import { PATCHES as PATCHES_HexagonalGrid } from "./HexagonalGrid.js";
import { PATCHES as PATCHES_TokenPF } from "./pathfinding/Token.js";
import { PATCHES as PATCHES_DrawingConfig } from "./DrawingConfig.js";

// Pathfinding
import { PATCHES as PATCHES_Wall } from "./pathfinding/Wall.js";

// Movement tracking
import { PATCHES as PATCHES_TokenHUD } from "./token_hud.js";

// Settings
import { PATCHES as PATCHES_ClientSettings } from "./ModuleSettingsAbstract.js";


const mergeObject = foundry.utils.mergeObject;
const PATCHES = {
  BaseGrid: PATCHES_BaseGrid,
  ClientKeybindings: PATCHES_ClientKeybindings,
  ClientSettings: PATCHES_ClientSettings,
  DrawingConfig: PATCHES_DrawingConfig,
  GridLayer: PATCHES_GridLayer,
  HexagonalGrid: PATCHES_HexagonalGrid,
  Ruler: PATCHES_Ruler,
  Token: mergeObject(mergeObject(PATCHES_Token, PATCHES_TokenPF), PATCHES_TokenHUD),
  Wall: PATCHES_Wall
};

export const PATCHER = new Patcher();
PATCHER.addPatchesFromRegistrationObject(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup("PATHFINDING");
  PATCHER.registerGroup("TOKEN_RULER");
  PATCHER.registerGroup("SPEED_HIGHLIGHTING");
  PATCHER.registerGroup("MOVEMENT_TRACKING");
  PATCHER.registerGroup("MOVEMENT_SELECTION");
}

