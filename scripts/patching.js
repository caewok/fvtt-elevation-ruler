/* globals
CONFIG,
libWrapper
*/
"use strict";

import { Patcher } from "./Patcher.js";
import { MODULES_ACTIVE } from "./const.js";

import { PATCHES as PATCHES.Ruler } from "./Ruler.js";
import { PATCHES as PATCHES.Token } from "./Token.js";
import { PATCHES as PATCHES.GridLayer } from "./GridLayer.js";

const PATCHES = {
  GridLayer: PATCHES_GridLayer,
  Ruler: PATCHES_Ruler,
  Token: PATCHES_Token
};

export const PATCHER = new Patcher();
PATCHER.addPatchesFromRegistrationObject(PATCHES);

export function initializePatching() {
  PATCHER.registerGroup("BASIC");
  if ( MODULES_ACTIVE.DRAG_RULER ) PATCHER.registerGroup("DRAG_RULER");
}
