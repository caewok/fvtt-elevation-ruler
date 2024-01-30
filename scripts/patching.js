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
import { PATCHES as PATCHES_ConstrainedTokenBorder } from "./ConstrainedTokenBorder.js";
import { PATCHES as PATCHES_TokenLayer } from "./TokenLayer.js";

// Pathfinding
import { PATCHES as PATCHES_Wall } from "./pathfinding/Wall.js";

// Settings
import { PATCHES as PATCHES_Settings } from "./ModuleSettingsAbstract.js";

const PATCHES = {
  BaseGrid: PATCHES_BaseGrid,
  ClientKeybindings: PATCHES_ClientKeybindings,
  ConstrainedTokenBorder: PATCHES_ConstrainedTokenBorder,
  GridLayer: PATCHES_GridLayer,
  HexagonalGrid: PATCHES_HexagonalGrid,
  Ruler: PATCHES_Ruler,
  Token: PATCHES_Token,
  TokenLayer: PATCHES_TokenLayer,
  Settings: PATCHES_Settings,
  Wall: PATCHES_Wall
};

export const PATCHER = new Patcher();
PATCHER.addPatchesFromRegistrationObject(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup("ConstrainedTokenBorder");
  PATCHER.registerGroup("PATHFINDING");
  PATCHER.registerGroup("TOKEN_RULER");
  PATCHER.registerGroup("SPEED_HIGHLIGHTING");
}

