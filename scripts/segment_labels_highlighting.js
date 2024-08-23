/* globals
canvas,
CONFIG,
game,
PIXI,
PreciseText
*/
"use strict";

import { MODULE_ID, MODULES_ACTIVE } from "./const.js";
import { Settings } from "./settings.js";
import { perpendicularPoints, roundMultiple } from "./util.js";

/**
 * Highlight a rectangular shaped portion of the line.
 * For use on gridless maps where ruler does not highlight.
 * @param {RulerMeasurementSegment} segment
 * @param {Color} color   Color to use
 * @param {string} name   Name of the ruler for tracking the highlight graphics
 */
export function highlightLineRectangle(segment, color, name) {
  const { A, B } = segment.ray;
  const width = Math.floor(canvas.scene.dimensions.size * (CONFIG[MODULE_ID].gridlessHighlightWidthMultiplier ?? 0.2));
  const ptsA = perpendicularPoints(A, B, width * 0.5);
  const ptsB = perpendicularPoints(B, A, width * 0.5);
  const shape = new PIXI.Polygon([
    ptsA[0],
    ptsA[1],
    ptsB[0],
    ptsB[1]
  ]);
  canvas.interface.grid.highlightPosition(name, { x: A.x, y: A.y, color, shape});
}

/**
 * Should Levels floor labels be used?
 * @returns {boolean}
 */
function useLevelsLabels() {
  if ( !MODULES_ACTIVE.LEVELS ) return false;
  const labelOpt = Settings.get(Settings.KEYS.LABELING.USE_LEVELS_LABEL);
  return labelOpt === Settings.KEYS.LABELING.LEVELS_LABELS.ALWAYS
    || (labelOpt === Settings.KEYS.LABELING.LEVELS_LABELS.UI_ONLY && CONFIG.Levels.UI.rendered);
}

/**
 * Find the name of the level, if any, at a given elevation.
 * @param {number} e    Elevation to use.
 * @returns First elevation found that is named and has e within its range.
 */
export function levelNameAtElevation(e) {
  if ( !useLevelsLabels() ) return undefined;
  const sceneLevels = canvas.scene.getFlag("levels", "sceneLevels"); // Array with [0]: bottom; [1]: top; [2]: name
  if ( !sceneLevels ) return undefined;

  // Just get the first labeled
  const lvl = sceneLevels.find(arr => arr[2] !== "" && e >= arr[0] && e <= arr[1]);
  return lvl ? lvl[2] : undefined;
}

/*
 * Construct a label to represent elevation changes in the ruler.
 * Waypoint version: @10 ft
 * Total version: @10 ft [↑10 ft] (Bracketed is the total elevation)
 * Total version for Token Ruler: none
 * Display current elevation if there was a previous change in elevation or not a token measurement
 * and the current elevation is nonzero.
 * @param {Ruler} ruler
 * @param {RulerSegment} segment
 * @return {string}
 */
export function segmentElevationLabel(ruler, segment) {
  // Arrows: ↑ ↓ ↕
  // Token ruler uses the preview token for elevation.
  if ( segment.last && ruler.isTokenRuler ) return "";

  // If this is the last segment, show the total elevation change if any.
  const { elevation, elevationDelta, elevationChanged } = elevationForRulerLabel(ruler, segment);
  const displayTotalChange = Boolean(elevationDelta) && segment.last;

  // For basic ruler measurements, it is not obvious what the elevation is at start.
  // So display any nonzero elevation at that point.
  const displayCurrentElevation = elevationChanged || (!ruler.token && elevation) || (elevation && segment.history);

  // Put together the two parts of the label: current elevation and total elevation.
  const labelParts = [];
  const units = canvas.scene.grid.units;
  if ( displayCurrentElevation ) {
    let elevLabel = `@${distanceLabel(elevation)}`;
    if ( units ) elevLabel += ` ${units}`;
    labelParts.push(elevLabel);
  }
  if ( displayTotalChange ) {
    const segmentArrow = (elevationDelta > 0) ? "↑" :"↓";
    let totalChange = `[${segmentArrow}${Math.abs(distanceLabel(elevationDelta))}`;
    totalChange += (units ? ` ${units}]` : `]`);
    labelParts.push(totalChange);
  }
  segment.label.style.align = segment.last ? "center" : "right";
  return labelParts.join(" ");
}

/**
 * Determine the elevation change for the ruler label
 * @param {Ruler} ruler
 * @param {RulerSegment} segment
 * @returns {object}
 *   - @prop {number} elevation           Final elevation in grid units
 *   - @prop {number} elevationDelta      Change in elevation from the origin
 *   - @prop {boolean} elevationChanged   Did elevation change at 1+ waypoints
 */
function elevationForRulerLabel(ruler, segment) {
  // If this is the last segment, show the total elevation change if any.
  const elevation = CONFIG.GeometryLib.utils.pixelsToGridUnits(segment.ray.B.z);
  const elevationDelta = elevation - ruler.originElevation;

  // Determine if any previous waypoint had an elevation change.
  let elevationChanged = false;
  let currE = elevation;
  for ( let i = segment.waypoint.idx; i > -1; i -= 1 ) {
    const prevE = ruler.waypoints[i].elevation;
    if ( currE !== prevE ) {
      elevationChanged = true;
      break;
    }
    currE = prevE;
  }
  return { elevation, elevationDelta, elevationChanged };
}

/**
 * Construct a label to represent difficult terrain in the ruler.
 * Difficult terrain is signified by a difference in the segment distance versus its move distance.
 * @param {object} s    Ruler segment
 * @returns {string} The label or "" if none.
 */
export function segmentTerrainLabel(s) {
  if ( s.waypoint.cost.almostEqual(s.waypoint.offsetDistance) ) return "";
  const units = (canvas.scene.grid.units) ? ` ${canvas.scene.grid.units}` : "";
  const moveDistance = distanceLabel(s.waypoint.cost);
  if ( CONFIG[MODULE_ID].SPEED.useFontAwesome ) {
    const style = s.label.style;
    if ( !style.fontFamily.includes("fontAwesome") ) style.fontFamily += ",fontAwesome";
    return `\n${CONFIG[MODULE_ID].SPEED.terrainSymbol} ${moveDistance}${units}`;
  }
  return `\n${CONFIG[MODULE_ID].SPEED.terrainSymbol} ${moveDistance}${units}`;
}


export function getPriorDistance(token) {
  if ( game.combat?.started && Settings.get(Settings.KEYS.MEASURING.COMBAT_HISTORY) ) {
    return distanceLabel(token?.lastMoveDistance) || 0;
  }
  return 0;
}

/**
 * Construct the basic ruler label, in which there is a single style with multiple lines.
 * @param {RulerSegment} segment
 * @param {string} [origLabel = ""]     The default label returned by Foundry's _getSegmentLabel
 */
export function basicTextLabel(ruler, segment, origLabel = "") {
  // Label for elevation changes.
  let elevLabel = Settings.get(Settings.KEYS.LABELING.HIDE_ELEVATION) ? "" : segmentElevationLabel(ruler, segment);

  // Label for Levels floors.
  const levelName = levelNameAtElevation(CONFIG.GeometryLib.utils.pixelsToGridUnits(segment.ray.B.z));
  if ( levelName ) elevLabel += `\n${levelName}`;

  // Label for difficult terrain (variation in move distance vs distance).
  const terrainLabel = segment.history ? "" : segmentTerrainLabel(segment);

  // Put it all together.
  let label = `${origLabel}`;
  if ( elevLabel !== "" ) label += `\n${elevLabel}`;
  if ( terrainLabel !== "" ) label += `${terrainLabel}`;
  return label;
}

/**
 * Use customized text styles for the ruler labels.
 * @param {RulerSegment} segment
 * @param {string} [origLabel = ""]     The default label returned by Foundry's _getSegmentLabel
 * @returns {string} Text for the top label.
 */
export function customizedTextLabel(ruler, segment, origLabel = "") {
  if ( !segment.label ) return "";

  /* Format:
  40 ft               (1) <-- total distance, large font
  Extra text          (2)
  • 10 ft waypoint    (3)
  • 20 ft up          (4)
  • 10 ft added       (5)
  */

  /* Waypoint format:
    20 ft             (1) <-- total distance to that point
  @ 10 ft             (2) <-- elevation at that point
  */
  const labelIcons = CONFIG[MODULE_ID].labeling.icons;
  const childLabels = {};

  // (1) Total Distance
  let totalDistLabel = segment.last ? `${distanceLabel(ruler.totalDistance)}` : `${labelIcons.waypoint} ${distanceLabel(segment.waypoint.distance)}`;

  // (2) Extra text
  // Strip out any custom text from the original label.
  // Format for Foundry Default: '0 ft [0 ft]'
  origLabel = origLabel.replace(getDefaultLabel(segment), "");

  // (3) Waypoint
  if ( segment.last && segment.waypoint.idx > 0 ) childLabels.waypoint = {
    icon: `${labelIcons.waypoint}`,
    value: segment.waypoint.distance,
    descriptor: game.i18n.localize(`${MODULE_ID}.waypoint`)
  };


  // (4) Elevation
  const displayElevation = !Settings.get(Settings.KEYS.LABELING.HIDE_ELEVATION)
    && !(segment.last && ruler.isTokenRuler);
  if ( displayElevation ) {
    const { elevation, elevationDelta, elevationChanged } = elevationForRulerLabel(ruler, segment);
    if ( elevationChanged || (!ruler.token && elevation) || (elevation && segment.history) ) {
      if ( !segment.last ) childLabels.elevation = {
        icon: `${labelIcons.elevationAt}`,
        value: elevation };
      else if ( elevationDelta ) childLabels.elevation = {
        icon: elevationDelta > 0 ? labelIcons.elevationUp : labelIcons.elevationDown,
        value: Math.abs(elevationDelta),
        descriptor: game.i18n.localize(elevationDelta > 0 ? `${MODULE_ID}.up` : `${MODULE_ID}.down`)};
    }
  }

  // (5) Terrain
  if ( segment.last && !segment.waypoint.cost.almostEqual(segment.waypoint.offsetDistance) ) childLabels.terrain = {
    icon: `${CONFIG[MODULE_ID].SPEED.terrainSymbol}`,
    value: segment.waypoint.cost - segment.waypoint.offsetDistance,
    descriptor: game.i18n.localize(`${MODULE_ID}.added`)
  };

  // Align so that the icon is left justified and the value is right justified. This aligns the units label or descriptor.
  alignLeftAndRight(childLabels);

  // Build the string for each.
  // icon value unit description
  const units = canvas.grid.units;
  Object.values(childLabels).forEach(obj => {
    obj.label = `${obj.iconValueStr}`;
    if ( units ) obj.label += ` ${units}`;
    if ( obj.descriptor ) obj.label += ` ${obj.descriptor}`;
  });
  if ( units ) totalDistLabel += ` ${units}`;

  // Construct a label style for each.
  const childTextContainers = [];
  if ( origLabel !== "" ) {
    const textLabel = constructSecondaryLabel(segment, origLabel, "other");
    alignChildTextLeft(segment.label, textLabel, childTextContainers);
    childTextContainers.push(textLabel);
  } else {
    const textLabel = segment.label.getChildByName("other");
    if ( textLabel ) textLabel.visible = false;
  }

  for ( const name of ["waypoint", "elevation", "terrain"] ) {
    const obj = childLabels[name];
    if ( obj ) {
      const textLabel = constructSecondaryLabel(segment, obj.label, name);
      alignChildTextLeft(segment.label, textLabel, childTextContainers);
      childTextContainers.push(textLabel);
    } else {
      const textLabel = segment.label.getChildByName(name);
      if ( textLabel ) textLabel.visible = false;
    }
  }
  return totalDistLabel;
}

function constructSecondaryLabel(segment, text, name) {
  const labelStyles = CONFIG[MODULE_ID].labeling.styles;
  const textScale = CONFIG[MODULE_ID].labeling.secondaryTextScale;

  let textLabel = segment.label.getChildByName(name);
  if ( !textLabel ) {
    const style = labelStyles[name] ?? labelStyles.waypoint;
    textLabel = new PreciseText("", style);
    textLabel.name = name;
    segment.label.addChild(textLabel);
    if ( !textLabel.style.fontFamily.includes("fontAwesome") ) textLabel.style.fontFamily += ",fontAwesome";
  }
  textLabel.visible = true;
  textLabel.text = text;
  textLabel.style.fontSize = Math.round(segment.label.style.fontSize * textScale);
  textLabel.anchor = { x: 0.5, y: 0.5 };
  return textLabel;
}

function getDefaultLabel(segment) {
  // Label based on Foundry default _getSegmentLabel.
  if ( segment.teleport ) return "";
  const units = canvas.grid.units;
  let label = `${Math.round(distanceLabel(segment.waypoint.distance) * 100) / 100}`;
  if ( units ) label += ` ${units}`;
  if ( segment.last ) {
    label += ` [${Math.round(canvas.controls.ruler.totalDistance * 100) / 100}`;
    if ( units ) label += ` ${units}`;
    label += "]";
  }
  return label;
}

function alignChildTextLeft(parent, child, priorChildren = []) {
  parent.anchor = { x: 0.5, y: 0.5 };
  child.anchor = { x: 0.5, y: 0.5 }

  /* Align relative to center of parent and child.
  -----•----- 11
-------•-------  15 --> shift over by (15 / 11) / 2. Add half height for each.
  */

  const otherHeights = priorChildren.reduce((acc, curr) => {
    if ( !curr.visible ) return acc;
    return acc + curr.height;
  }, 0);
  child.position.x = (child.width - parent.width) * 0.5;
  child.position.y = (parent.height * 0.5) + (child.height * 0.5) + otherHeights;
}

/**
 * Align the labels by adding narrow spacing.
 * Align so that each label can be left justified but the units align
 * Add spaces between the icon and the value.
 * • 10 ft
 * +  5 ft
 */
const SPACER = "\u200A"; // See https://unicode-explorer.com/articles/space-characters.
function alignLeftAndRight(childLabels) {
  const labelStyles =  CONFIG[MODULE_ID].labeling.styles;
  let targetWidth = 0;
  Object.entries(childLabels).forEach(([name, obj]) => {
    obj.iconValueStr = `${obj.icon} ${distanceLabel(obj.value)}`;
    const tm = PIXI.TextMetrics.measureText(obj.iconValueStr, labelStyles[name]);
    obj.iconValueWidth = tm.width;
    targetWidth = Math.max(targetWidth, tm.width);
  });

  Object.entries(childLabels).forEach(([name, obj]) => {
    if ( obj.iconValueWidth.almostEqual(targetWidth) || obj.iconValueWidth > targetWidth ) return;
    const tm = PIXI.TextMetrics.measureText(`${SPACER}`, labelStyles[name]);
    const numSpaces = Math.floor(targetWidth - obj.iconValueWidth) / tm.width;
    if ( numSpaces <= 0 ) return;
    obj.iconValueStr = [`${obj.icon}`, ...Array.fromRange(numSpaces).map(_elem => SPACER), ` ${distanceLabel(obj.value)}`].join("");
  });
}
