/* globals
*/
"use strict";

import { Patcher } from "./Patcher.js";
import { MODULES_ACTIVE } from "./const.js";

import { PATCHES as PATCHES_Ruler } from "./Ruler.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_GridLayer } from "./GridLayer.js";
import { PATCHES as PATCHES_PlaceableObject } from "./PlaceableObject.js";
import { PATCHES as PATCHES_ClientKeybindings } from "./ClientKeybindings.js";
import { PATCHES as PATCHES_BaseGrid } from "./BaseGrid.js";
import { PATCHES as PATCHES_HexagonalGrid } from "./HexagonalGrid.js";

// Settings
import { PATCHES as PATCHES_Settings } from "./ModuleSettingsAbstract.js";

const PATCHES = {
  BaseGrid: PATCHES_BaseGrid,
  ClientKeybindings: PATCHES_ClientKeybindings,
  GridLayer: PATCHES_GridLayer,
  HexagonalGrid: PATCHES_HexagonalGrid,
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

