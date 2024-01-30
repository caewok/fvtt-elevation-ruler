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
  const destination = event.interactionData.destination;

  // Ensure the cursor destination is within bounds
  if ( !canvas.dimensions.rect.contains(destination.x, destination.y) ) {
    ruler._onMouseUp(event);
    return false;
  }
  ruler._state = Ruler.STATES.MOVING; // Do this before the await.
  await ruler.moveToken();
  ruler._onMouseUp(event);
}

PATCHES.TOKEN_RULER.MIXES = { _onClickLeft };