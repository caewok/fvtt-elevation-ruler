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

// WebGPU Pathfinding
import { PATCHES as PATCHES_Wall_WebGPU } from "./Wall.js";
import { PATCHES as PATCHES_Region_WebGPU } from "./Region.js";

// Settings
import { PATCHES as PATCHES_ClientSettings } from "./ModuleSettingsAbstract.js";

const mergeObject = foundry.utils.mergeObject;
const PATCHES = {
  ClientSettings: PATCHES_ClientSettings,
  "foundry.canvas.geometry.edges.CanvasEdges": PATCHES_CanvasEdges,
  DrawingConfig: PATCHES_DrawingConfig,
//  "CONFIG.Canvas.rulerClass": PATCHES_Ruler,
  "foundry.canvas.placeables.Token": mergeObject(PATCHES_Token, PATCHES_TokenPF),
  "foundry.canvas.placeables.Wall": mergeObject(PATCHES_Wall, PATCHES_Wall_WebGPU),
  "foundry.canvas.placeables.Region": PATCHES_Region_WebGPU,
};

export const PATCHER = new Patcher();


export function initializePatching() {
  PATCHER.addPatchesFromRegistrationObject(PATCHES);
  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup("PATHFINDING");
}
