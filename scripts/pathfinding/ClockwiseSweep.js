/* globals
canvas,
CONST,
foundry,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID } from "../const.js";
import { AABB2d } from "../geometry/AABB.js";
import { Settings } from "../settings.js";
import { ObstacleOcclusionTest } from "../geometry/ObstacleOcclusionTest.js";

// Extensions to Clockwise Sweep

/**
 * Extend Clockwise Sweep to add additional edges (e.g., token borders) via config.
 */
export class ObstacleSweep extends foundry.canvas.geometry.ClockwiseSweepPolygon {
  /**
   * Add to the edge set any added edges from the config that are within bounds for this sweep.
   */
  _identifyEdges() {
    super._identifyEdges();
    if ( !this.config.addedEdges ) return;
    const aabb = AABB2d.fromRectangle(this.config.boundingBox);
    for ( const edge of this.config.addedEdges ) {
      if ( !aabb.overlapsEdge(edge) ) continue;
      this.edges.add(edge);
    }
  }

  static identifyBlockingTokenEdges(subjectToken) {
    // Add token edges. Must be temporary wall edges.
    const PATHFINDING = Settings.KEYS.PATHFINDING;
    const blocking = Settings.get(PATHFINDING.TOKENS_BLOCK);
    const blockingCfg = {
      dead: false,
      live: blocking !== PATHFINDING.TOKENS_BLOCK_CHOICES.NO,
      prone: false,
      enemies: blocking !== PATHFINDING.TOKENS_BLOCK_CHOICES.NO,
      allies: blocking === PATHFINDING.TOKENS_BLOCK_CHOICES.ALL,
    };
    const occlusionCfg = { blockingCfg, subjectToken };
    const Edge = foundry.canvas.geometry.edges.Edge;
    const edges = [];
    for ( const token of canvas.tokens.placeables ) {
      if ( !ObstacleOcclusionTest.includeToken(token, occlusionCfg) ) continue;
      for ( const edge of token.constrainedTokenBorder.iterateEdges({ closed: false }) ) {
        edges.push(new Edge(edge.a, edge.b, {
          object: { flags: {
            "wall-height": {
              top: token.topZ,
              bottom: token.bottomZ,
            }
          }},
          type: `${MODULE_ID}.ObstacleSweep`,
          id: token.id,
          move: CONST.WALL_SENSE_TYPES.NORMAL,
        }));
      }
    }
    return edges;
  }
}

/**
 * Extend Clockwise Sweep to track when the sweep hits wall corners.
 */
export class ClockwisePathfindingSweep extends ObstacleSweep {
  /**
   * Corners are when the sweep hits a non-limited wall
   * and must extend the sweep beyond that point.
   * In addition, corners where the walls simply continue are ignored
   * @type {Point[]}
   */
  cornersEncountered = new Set();

  /**
   * "Edges" or walls encountered. Added if the wall forms part of the polygon.
   * @type {Set<Wall>}
   */
  edgesEncountered = new Set();

  /** @type {object} */
  sweepOpts = {};

  /** @inheritdoc */
  _compute() {
    this.cornersEncountered.clear();
    super._compute();
  }

  _switchEdge(result, activeEdges) {
    this.cornersEncountered.add(result.target.key);
    super._switchEdge(result, activeEdges);
  }

  addPoint(point) {
    super.addPoint(point);
    if ( !Object.hasOwn(point, "cwEdges") ) return; // If calling simply "addPoint", ignore the rest.

    // Super will skip repeated points, which really should not happen in sweep.
    // const l = this.points.length;
    // if ( (x === this.points[l-2]) && (y === this.points[l-1]) ) return this;
    point.cwEdges.forEach(edge => this.edgesEncountered.add(edge));
  }

}
