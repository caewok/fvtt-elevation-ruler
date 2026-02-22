/* globals
foundry,
*/
"use strict";

import { Patcher } from "./Patcher.js";

import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_DrawingConfig } from "./DrawingConfig.js";

// WebGPU Pathfinding
import { PATCHES as PATCHES_Wall_WebGPU } from "./Wall.js";
import { PATCHES as PATCHES_Region_WebGPU } from "./Region.js";

// Settings
import { PATCHES as PATCHES_ClientSettings } from "./ModuleSettingsAbstract.js";

const mergeObject = foundry.utils.mergeObject;
const PATCHES = {
  "foundry.helpers.ClientSettings": PATCHES_ClientSettings,
  DrawingConfig: PATCHES_DrawingConfig,
  //  "CONFIG.Canvas.rulerClass": PATCHES_Ruler,
  "foundry.canvas.placeables.Token": PATCHES_Token,
  "foundry.canvas.placeables.Wall": PATCHES_Wall_WebGPU,
  "foundry.canvas.placeables.Region": PATCHES_Region_WebGPU,
};

export const PATCHER = new Patcher();


export function initializePatching() {
  PATCHER.addPatchesFromRegistrationObject(PATCHES);
  PATCHER.registerGroup("BASIC");
}
