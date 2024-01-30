/* globals
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// Modifications to Token Layer to better handle ruler on drag.

import { Settings } from "./settings.js";


export const PATCHES = {};
PATCHES.TOKEN_RULER = {};

/**
 * Mixed wrap of TokenLayer.prototype._onClickLeft
 * If we are dragging with Token Ruler, click left ends the measurement and moves the token.
 */
async function _onClickLeft(wrapped, event) {
  const tool = game.activeTool;
  const ruler = canvas.controls.ruler;
  if ( tool !== "select"
    || !Settings.get(Settings.KEYS.TOKEN_RULER.ENABLED)
    || !Settings.get(Settings.KEYS.TOKEN_RULER.RIGHT_CLICK_ADDS_WAYPOINT)
    || ruler._state !== Ruler.STATES.MEASURING
  ) return wrapped(event);

  // Drop the token.
  const token = ruler._getMovementToken();
  if ( !token ) return wrapped(event);
  await token._onDragLeftDrop(event);
  token._onDragEnd();
  // if ( ruler._state !== Ruler.STATES.MOVING ) canvas.controls.ruler._onMouseUp(event);
}

PATCHES.TOKEN_RULER.MIXES = { _onClickLeft };
