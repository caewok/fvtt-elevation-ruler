[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-elevation-ruler)](https://github.com/caewok/fvtt-elevation-ruler/releases/latest)
[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-elevation-ruler/releases/latest/download/module.json&label=Foundry%20Version&query=$.minimumCoreVersion&colorB=blueviolet)](https://github.com/caewok/fvtt-elevation-ruler/releases/latest)
[![License](https://img.shields.io/github/license/caewok/fvtt-elevation-ruler)](LICENSE)

![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https://forge-vtt.com/api/bazaar/package/elevationruler&colorB=4aa94a)
![Latest Release Download Count](https://img.shields.io/github/downloads/caewok/fvtt-elevation-ruler/latest/module.zip)
![All Downloads](https://img.shields.io/github/downloads/caewok/fvtt-elevation-ruler/total)

# Elevation Ruler

This module allows the default Foundry measurement ruler to track change in elevation. Elevation can be changed while using the ruler :
1. Manually. Hit the specified hot key (default: '[' to increment and ']' to decrement).
2. Token. When hovering over a token with the ruler, the origin or destination elevation (as applicable) will update.
3. Elevated Vision. If the Elevated Vision module is present, it will use that elevation information. (Elevation Ruler v0.5+)
4. Levels. If the Levels module is present, the ruler will look for Levels-enabled tiles  and default to the bottom elevation of that tile. In Elevation Ruler v0.5+, it will also originate elevation at the bottom of the active layer if the Levels layers UI is active.

The distance calculation updates based on the distance measured, assuming a straight line in three dimensions between origin and destination, taking into account elevation change.

If you add a waypoint, elevation will be tracked at each waypoint.

If you choose to move the origin token (by hitting spacebar) after measuring, the token elevation will be updated along each waypoint.

As of v0.7, Elevation Ruler adds a setting to display the Foundry ruler when dragging tokens.
As of v0.8, Elevation Ruler adds a toggle to enable pathfinding when using the ruler or dragging tokens with the Token Ruler enabled.

# Installation
Add this [Manifest URL](https://github.com/caewok/fvtt-elevation-ruler/releases/latest/download/module.json) in Foundry to install.

## Dependencies
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)
- [libRuler](https://github.com/caewok/fvtt-lib-ruler) (deprecated as of Foundry v10; no longer required)

(Elevation Ruler 0.4+ requires Foundry v9 because it replaces the DF Hotkeys dependency with the Foundry keybindings introduced in v9.)
(Elevation Ruler 0.5+ requires Foundry v10 due to improvements in the Foundry Ruler API.)
(Elevation Ruler 0.7+ requires Foundry v11.)

## Modules that add functionality
- [Elevated Vision](https://github.com/caewok/fvtt-elevated-vision)
- [Wall Height](https://github.com/erithtotl/FVTT-Wall-Height)

## Known conflicts
- [Terrain Ruler](https://github.com/manuelVo/foundryvtt-terrain-ruler)
- [Enhanced Terrain Layer](https://github.com/ironmonk88/enhanced-terrain-layer)
- [Drag Ruler](https://github.com/manuelVo/foundryvtt-drag-ruler). Elevation ruler v0.6 series worked with Drag Ruler, but v0.7+ no longer supports Drag Ruler.

In general, modules that overwrite or extend the Ruler Class may cause the elevation ruler module to fail to display or calculate correctly.

## What systems does it work on?

It has been tested on dnd5e. Because it adds to the functionality of the underlying Foundry measurement ruler, it may work on other systems as well, unless the system overrides key Foundry measurement functions in the Ruler Class. Please submit an issue in this GitHub if you experience issues when running on your preferred system!

# How to Use

To use, start measuring with the Foundry measurement ruler as normal. While doing so, hit '[' to increase the elevation at the destination by one step. A step is equal to the grid size (typically 5 feet). Hit ']' to decrease the elevation at the destination by one step.

If you enable the Token Ruler in settings, dragging tokens will also display the ruler.

If you enable Token Speed Highlighting in settings, token speed will be estimated using different colors. Use the Token HUD (right-click on a token on the canvas) if you want to switch from automatic guess of whether the token is walking/flying/burrowing to manual. If the token does not have movement speed for the given movement type (or if Elevation Ruler does not know how to find that movement attribute for the system) the speed highlighter will not change colors.

You can modify the system attributes used for walk/fly/burrow as well as the colors used in `CONFIG.elevationruler.SPEED`.

# Details

## Measuring diagonals
Nearly every elevation measurement creates a diagonal path from the origin to the elevated or decremented altitude. Elevation Ruler attempts to use the default system measurement to measure these diagonals. For dnd5e, the total distance along the diagonal will follow the chosen dnd5e measurement rule: 5-5-5, 5-10-5, or Euclidean.

For example, here is the measurement that is displayed in DnD 5e with the 5-5-5 rule, where a diagonal move counts as 5 feet:

![Screenshot DnD 5e 5-5-5 Measurement](https://raw.githubusercontent.com/caewok/fvtt-elevation-ruler/feature/media/media/measurement_dnd_5-5-5.jpg)

The token would move two squares left and two squares "up".  This first move can be accomplished by moving diagonally up and to the left twice. This totals 10 feet under the DnD 5e 5-5-5 rule (same as if moving two squares left). Moving down two squares then adds a

The token would then moves two squares down in 2-D and down one square in elevation. Similarly to the first move, the second can be accomplished by moving diagonally down 1 square and then down one more square in 2-D, or 10 feet total.

In contrast, using the 5-10-5 rule, the first move incurs an extra 5-foot penalty because moving twice diagonally costs 15 feet.

![Screenshot DnD 5e 5-10-5 Measurement](https://github.com/caewok/fvtt-elevation-ruler/raw/feature/media/media/measurement_dnd_5-10-5.jpg)

Finally, the DnD Euclidean rule relies on Pythagorean's Theorem, rounded to the nearsest foot. Here the token is first elevated 10 feet (14 feet of movement total along the diagonal in 3-D) and then lowered 5 feet (11 feet of movement total).

![Screenshot DnD 5e Euclidean Measurement](https://raw.githubusercontent.com/caewok/fvtt-elevation-ruler/feature/media/media/measurement_dnd_euclidean.jpg)


## Token measurement

If you drag the ruler over a token that has been elevated or lowered, the ruler will reflect the elevation of that token (plus or minus manually incremented values). (This does not happen if you are dragging tokens; you must use the ruler tool.)

This is particularly useful where you have an elevated character at the origin, and want to fire or move downwards. Or vice-versa where you are aiming at an elevated token and need total distance to the elevated target.

## Elevation changes when moving the token with spacebar

As with the normal Foundry ruler, if you begin a measurement at your token, you can hit spacebar to move the token. Elevation is modified at the end of each waypoint segment move. This may allow you, for example, to jump over a wall if that wall has a maximum height under your current elevation as can be set up using the Wall Height module (or Levels + Wall Height).

# API

You can modify the system attributes used for walk/fly/burrow as well as the colors used in `CONFIG.elevationruler.SPEED`. You can modify the Token HUD icons in `CONFIG.elevationruler.MOVEMENT_BUTTONS`.

Elevation Ruler adds a token property to get the token movement type: `_token.movementType`. You may also want the enumerated movement types: `game.modules.get("elevationruler").api.MOVEMENT_TYPES`.

Elevation Ruler adds token properties to track the last movement made by the token:
- `_token.lastMoveDistance`: Movement units expended on the last move. May not be physical distance; this instead accounts for additional movement due to difficult terrain. If the token has not moved this combat round, this value will be 0.
- `_token._lastMoveDistance`: Same as above, but does not account for combat rounds.
