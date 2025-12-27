/* globals
foundry,
*/
"use strict";

import { Patcher } from "./Patcher.js";

// import { PATCHES as PATCHES_Ruler } from "./Ruler.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_DrawingConfig } from "./DrawingConfig.js";

// Pathfinding
import { PATCHES as PATCHES_Wall } from "./pathfinding/Wall.js";
import { PATCHES as PATCHES_CanvasEdges } from "./pathfinding/CanvasEdges.js";
import { PATCHES as PATCHES_TokenPF } from "./pathfinding/Token.js";

// Settings
import { PATCHES as PATCHES_ClientSettings } from "./ModuleSettingsAbstract.js";

const mergeObject = foundry.utils.mergeObject;
const PATCHES = {
  ClientSettings: PATCHES_ClientSettings,
  "foundry.canvas.geometry.edges.CanvasEdges": PATCHES_CanvasEdges,
  DrawingConfig: PATCHES_DrawingConfig,
//  "CONFIG.Canvas.rulerClass": PATCHES_Ruler,
  Token: mergeObject(PATCHES_Token, PATCHES_TokenPF),
  Wall: PATCHES_Wall
};

export const PATCHER = new Patcher();


export function initializePatching() {
  PATCHER.addPatchesFromRegistrationObject(PATCHES);
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup("PATHFINDING");
}
