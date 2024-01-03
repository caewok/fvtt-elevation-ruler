/* globals
canvas
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Patches for the Token class
export const PATCHES = {};
PATCHES.TOKEN_RULER = {}; // Assume this patch is only present if the token ruler setting is enabled.


function _onDragLeftStart(wrapped, event) {
  console.log("Placeable.prototype._onDragLeftStart");
}

PATCHES.TOKEN_RULER = { _onDragLeftStart };