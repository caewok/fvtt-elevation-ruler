/* globals
canvas,
CONFIG,
game,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Settings } from "../settings.js";
import { GEOMETRY_LIB_ID } from "../geometry/const.js";
import { PixelCache } from "../geometry/PixelCache.js";

/**
 * Utility functions for terrain evaluation that can be shared between pathfinding classes
 * to avoid circular dependencies.
 */

export const TERRAIN_FEATURES = {
  CLEAR: 0,
  NORMAL: 1,        // Basic cost to move 1 grid space.
  IMPASSABLE: 3     // Considered infinite cost: 2^8 -1
};

/**
 * Get the terrain value for a token relative to another token.
 * @param {Token} token           The token to evaluate
 * @param {Token} subjectToken    The token doing the pathfinding
 * @returns {TERRAIN_FEATURES}
 */
export function tokenTerrainValue(token, subjectToken) {
  // If the token does not affect the subject, should return NORMAL (not 0, although that could work).
  if ( token === subjectToken ) return TERRAIN_FEATURES.NORMAL;

  // TODO: Add setting to change this.
  if ( token.isProne ) return TERRAIN_FEATURES.NORMAL;
  if ( CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsDead(token) ) return TERRAIN_FEATURES.NORMAL;

  const PATHFINDING = Settings.KEYS.PATHFINDING;
  const blocking = Settings.get(PATHFINDING.TOKENS_BLOCK);
  if ( blocking === PATHFINDING.TOKENS_BLOCK_CHOICES.ALL ) return TERRAIN_FEATURES.IMPASSABLE;

  const isEnemy = CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsEnemy(subjectToken, token);
  if ( isEnemy && blocking === PATHFINDING.TOKENS_BLOCK_CHOICES.HOSTILE ) return TERRAIN_FEATURES.IMPASSABLE;

  // No token blocking; check for token difficulties.
  const hostileDifficulty = Settings.get(PATHFINDING.TOKEN_DIFFICULTY.HOSTILE);
  if ( isEnemy ) return hostileDifficulty * TERRAIN_FEATURES.NORMAL;

  const isAlly = CONFIG[GEOMETRY_LIB_ID].CONFIG.tokenIsAlly(subjectToken, token);
  const allyDifficulty = Settings.get(PATHFINDING.TOKEN_DIFFICULTY.FRIENDLY);
  if ( isAlly ) return allyDifficulty * TERRAIN_FEATURES.NORMAL;

  return TERRAIN_FEATURES.NORMAL;
}

/**
 * Get the terrain value for a region relative to a token.
 * @param {Region} region           The region to evaluate
 * @param {Token} subjectToken      The token doing the pathfinding
 * @returns {TERRAIN_FEATURES}
 */
export function regionTerrainValue(region, subjectToken) {
  let value = TERRAIN_FEATURES.NORMAL;
  if ( game.system.id === "dnd5e" ) {
    // Treat multiple difficult behaviors as multiplicative.
    const DIFFICULTY_MULTIPLIER = 2;
    behaviorLoop: for ( const behavior of region.document.behaviors ) {
      if ( !behavior.type === "dnd5e.difficultTerrain" ) continue behaviorLoop;
      for ( const ignoredDisposition of behavior.system.ignoredDispositions ) {
        if ( ignoredDisposition === subjectToken.document.disposition ) continue behaviorLoop;
      }
      value *= DIFFICULTY_MULTIPLIER;
    }
  }
  return value;
}
