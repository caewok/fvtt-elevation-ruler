/* globals
*/
"use strict";

import { Patcher } from "./Patcher.js";
import { MODULES_ACTIVE } from "./const.js";

import { PATCHES as PATCHES_Ruler } from "./Ruler.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_GridLayer } from "./GridLayer.js";
import { PATCHES as PATCHES_PlaceableObject } from "./PlaceableObject.js";

// Settings
import { PATCHES as PATCHES_Settings } from "./ModuleSettingsAbstract.js";


const PATCHES = {
  GridLayer: PATCHES_GridLayer,
  Ruler: PATCHES_Ruler,
  PlaceableObject: PATCHES_PlaceableObject,
  Token: PATCHES_Token,
  Settings: PATCHES_Settings
};

export const PATCHER = new Patcher();
PATCHER.addPatchesFromRegistrationObject(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
}

export function registerDragRuler() {
  if ( MODULES_ACTIVE.DRAG_RULER ) PATCHER.registerGroup("DRAG_RULER");
}

