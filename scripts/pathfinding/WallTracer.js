/* globals
CONFIG,
CONST,
foundry,
game
*/
"use strict";

/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */

// WallTracer3

import { Settings } from "../settings.js";
import { MODULE_ID, OTHER_MODULES } from "../const.js";
import { SceneGraph } from "../geometry/WallTracer.js";

export class ERSceneGraph extends SceneGraph {

  /**
   * Does this edge wall block from an origin somewhere?
   * Tested "live" and not cached so door or wall orientation changes need not be tracked.
   * @param {Wall} wall         Wall to test
   * @param {Point} origin      Measure wall blocking from perspective of this origin point.
   * @param {number} [elevation=0]  Elevation of the point or origin to test.
   * @returns {boolean}
   */
  static wallBlocks(wall, origin, moveToken, elevation = 0) {
    if ( !SceneGraph.wallBlocks(wall, origin, elevation) ) return false;

    // If Wall Height vaulting is enabled, walls less than token vision height do not block.
    const wh = OTHER_MODULES.WALL_HEIGHT;
    if ( wh.ACTIVE && game.settings.get(wh.KEY, wh.FLAGS.VAULTING) && moveToken.visionZ >= wall.topZ ) return false;
    return true;
  }


  /**
   * Could edges of this token block the moving token?
   * @param {Token} token             Token whose edges will be tested
   * @param {Token} moveToken         Token doing the move
   * @param {number} [elevation=0]  Elevation of the point or origin to test.
   * @param {string} tokenBlockType   What test to use for comparing token dispositions for blocking
   * @returns {boolean}
   */
  static tokenEdgeBlocks(token, moveToken, elevation = 0, tokenBlockType) {
    if ( !SceneGraph.tokenEdgeBlocks(token, moveToken, elevation) ) return false;

    // Don't block dead tokens (HP <= 0).
    const { tokenHPAttribute, pathfindingIgnoreStatuses } = CONFIG[MODULE_ID];
    const tokenHP = Number(foundry.utils.getProperty(token, tokenHPAttribute));
    if ( Number.isFinite(tokenHP) && tokenHP <= 0 ) return false;

    // Don't block tokens with certain status.
    if ( token.actor?.statuses && token.actor.statuses.intersects(pathfindingIgnoreStatuses) ) return false;

    // Don't block tokens that share specific disposition with the moving token.
    tokenBlockType ??= Settings._tokenBlockType();
    const D = CONST.TOKEN_DISPOSITIONS;
    const moveTokenD = moveToken.document.disposition;
    const edgeTokenD = token.document.disposition;
    switch ( tokenBlockType ) {
      case D.NEUTRAL: return false;
      case D.SECRET: return true;

      // Hostile: Block if dispositions are different
      case D.HOSTILE: return ( edgeTokenD === D.SECRET
        || moveTokenD === D.SECRET
        || edgeTokenD !== moveTokenD );

      // Friendly: Block if dispositions are the same
      case D.FRIENDLY: return ( edgeTokenD === D.SECRET
        || moveTokenD === D.SECRET
        || edgeTokenD === moveTokenD );

      default: return true;
    }
  }

}
