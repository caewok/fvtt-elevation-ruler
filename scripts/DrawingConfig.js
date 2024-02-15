/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for Drawing configuration rendering.

import { MODULE_ID, TEMPLATES, FLAGS } from "./const.js";
import { injectConfiguration } from "./util.js";

export const PATCHES = {};
PATCHES.BASIC = {};

async function renderDrawingConfigHook(app, html, data) {
  const template = TEMPLATES.DRAWING_CONFIG;
  const findString = "div[data-tab='text']:last";
  addDrawingConfigData(app, data);
  await injectConfiguration(app, html, data, template, findString);
}

function addDrawingConfigData(app, data) {
  data.object.flags ??= {};
  data.object.flags[MODULE_ID] ??= {};
  data.object.flags[MODULE_ID][FLAGS.MOVEMENT_PENALTY] ??= 1;
}

PATCHES.BASIC.HOOKS = {
  renderDrawingConfig: renderDrawingConfigHook
};
