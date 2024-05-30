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

Version v0.9 requires Foundry v12.

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

## Known issues (Foundry v12, Elevation Ruler v0.9.0)
- Pathfinding does not work. Error thrown at canvas start re `canvas.walls.outerBounds is not iterable` is related to pathfinding but can be ignored for now.

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

When measuring, the ruler will stay at the origin elevation (or originating token elevation) unless manually changed. But if you drag the ruler over a token that has been elevated or lowered, the ruler will reflect the elevation of that token (plus or minus manually incremented values). (This does not happen if you are dragging tokens; you must use the ruler tool.)

This is particularly useful where you have an elevated character at the origin, and want to fire or move downwards. Or vice-versa where you are aiming at an elevated token and need total distance to the elevated target.

## Elevation changes when moving the token with spacebar

As with the normal Foundry ruler, if you begin a measurement at your token, you can hit spacebar to move the token. Elevation is modified at the end of each waypoint segment move. This may allow you, for example, to jump over a wall if that wall has a maximum height under your current elevation as can be set up using the Wall Height module (or Levels + Wall Height).

# Token controls

Elevation Ruler adds two token controls. The "Use Pathfinding" control toggles pathfinding on/off. The "Prefer Token Elevation" control, when enabled, will not adjust the destination elevation when hovering over other tokens. Typically, without this enabled, the ruler will change the destination elevation to match the elevation of a token at the destination point.

# Key bindings

Elevation Ruler defines certain keybindings:
- Decrement Ruler Elevation (`[`): When measuring or dragging tokens, decrease the destination elevation by one grid unit. If you trigger a token move, its elevation will be adjusted accordingly.
- Increment Ruler Elevation (`]`): See Decrement.
- Add Token Ruler Waypoint (`=`): When dragging tokens, add a waypoint.
- Remove Token Ruler Waypoint (`-`): When dragging tokens, remove a waypoint.
- Temporarily Toggle Pathfinding (`p`): If pathfinding is enabled, temporarily disable while holding this key. If disabled, then temporarily enable it.
- Force to Ground (`g`): If you hit `g` while using the ruler, it will move the destination to use the ground elevation. You can hit `g` again to revert back. Note that the decrement and increment elevation keybindings will still change elevation accordingly. You can use this keybinding when dragging a flying token that you want to "land." Or if you are measuring with the ruler and want the measurement to not accoutn for another token's elevation at a destination point.

# Settings

- Add token elevation control: Add the "Prefer Token Elevation Control" to the Token controls.
- Tokens Block: When pathfinding, select whether none, hostile, or all tokens block the path.
- Limit Pathfinding to Explored Areas: For users, should the pathfinding stop working when they move the ruler destination into an unexplored area?
- Use Token Ruler: Display the ruler when dragging tokens.
- Use Token Speed Highlighting: Highlight grid squares under the ruler based on the token's speed. See API, below, for how to modify colors and speed categories.
- Track Combat Move: When displaying the speed highlighting during combat, count any movement already made by the token this combat round.
- Round Distance to Multiple: Round the measurement display by this multiple. For example, "10" will round 111.23 to 110.
- Token as Terrain Multiplier: How much does a token penalize movement through that token?
- Terrain Grid Measurement: When measuring movement through terrain on a gridded map, how should the terrain be accounted for?
  - Center Point: if the terrain overlaps the grid square/hex center point, that grid square/hex will have penalized movement.
  - Percent Area: if the terrain area excees some threshold coverage of the grid square/hex center point, that grid square/hex will have penalized movement.
  - Euclidean: A line moving through the terrain will be proportionally penalized based on the percentage of that line within the terrain.
- Percent Area Threshold: Defines the threshold in Terrain Grid Measurement: Percent Area.

# API

You can access defined properties used by Elevation Ruler at `CONFIG.elevationruler`. You can access some of this module's classes and advanced data at `game.modules.get("elevationruler").api`.

Elevation Ruler adds token properties to track the last movement made by the token:
- `_token.lastMoveDistance`: Movement units expended on the last move. May not be physical distance; this instead accounts for additional movement due to difficult terrain. If the token has not moved this combat round, this value will be 0.
- `_token._lastMoveDistance`: Same as above, but does not account for combat rounds.

## Setting speed colors

To change how speed highlighting works, you will need to change the array of speed categories in `CONFIG.elevationruler.SPEED.CATEGORIES`. A speed category is defined as:
```js
/**
 * @typedef {object} SpeedCategory
 *
 * Object that stores the name, multiplier, and color of a given speed category.
 * Custom properties are permitted. The SpeedCategory is passed to SPEED.maximumCategoryDistance,
 * which in turn can be defined to use custom properties to calculate the maximum distance for the category.
 *
 * @prop {Color} color          Color used with ruler highlighting
 * @prop {string} name          Unique name of the category (relative to other SpeedCategories)
 * @prop {number} [multiplier]  This times the token movement equals the distance for this category
 */
```
The default categories are as follows, although these properties may vary by system:
```js
const WalkSpeedCategory = {
  name: "Walk",
  color: Color.from(0x00ff00),
  multiplier: 1
};

const DashSpeedCategory = {
  name: "Dash",
  color: Color.from(0xffff00),
  multiplier: 2
};
```
Categories are processed in order in the `SPEED.CATEGORIES` array. Usually (unless you modify the `SPEED.maximumCategoryDistance` function per below) you would want the categories sorted from smallest to largest multiplier. For example, a token with speed 30 could walk for 30 * 1 grid units, and dash for 30 * 2 = 60 grid units. So the first 30 grid units would be highlighted for walk, the next 30 highlighted for dash, and everything byond that highlighted with the maximum color.

There is a also a "Maximum" property for when the distances for the categories above are exceeded. You can set the default color at `SPEED.MAXIMUM_COLOR`.

If you have a specific system that you would like supported by default, please open a Git issue and explain how the system measures speed and, preferably, what properties need to be changed.

## Advanced speed modifications

For more complex options, you can replace two functions that control token speed measurements. You may also want to add additional properties to the `SpeedCategory` for your use case.
```js
/**
 * Given a token, get the maximum distance the token can travel for a given type.
 * Distance measured from 0, so types overlap. E.g.
 *   WALK (x1): Token speed 25, distance = 25.
 *   DASH (x2): Token speed 25, distance = 50.
 *
 * @param {Token} token                   Token whose speed should be used
 * @param {SpeedCategory} speedCategory   Category for which the maximum distance is desired
 * @param {number} [tokenSpeed]           Optional token speed to avoid repeated lookups
 * @returns {number}
 */
SPEED.maximumCategoryDistance = function(token, speedCategory, tokenSpeed) {
  tokenSpeed ??= SPEED.tokenSpeed(token);
  return speedCategory.multiplier * tokenSpeed;
};

/**
 * Given a token, retrieve its base speed.
 * @param {Token} token                   Token whose speed is required
 * @returns {number} Distance, in grid units
 */
SPEED.tokenSpeed = function(token) {
  const speedAttribute = SPEED.ATTRIBUTES[token.movementType] ?? SPEED.ATTRIBUTES.WALK;
  return Number(foundry.utils.getProperty(token, speedAttribute));
};
```

## Controlling movement buttons

You can modify the system attributes used for walk/fly/burrow  in `CONFIG.elevationruler.SPEED.ATTRIBUTES`. You can modify the Token HUD icons in `CONFIG.elevationruler.MOVEMENT_BUTTONS`.

Elevation Ruler adds a token property to get the token movement type: `_token.movementType`. You may also want the enumerated movement types: `game.modules.get("elevationruler").api.MOVEMENT_TYPES`.

## Controlling terrain display

You can modify the icon used when hovering over difficult terrain:
- `CONFIG.elevationruler.SPEED.terrainSymbol`: You can use any text string here. Paste in a unicode symbol if you want a different symbol. For Font Awesome icons, use, e.g., "\uf0e7". (This is the code for [FA lightning bolt](https://fontawesome.com/icons/bolt?f=classic&s=solid).)
- `CONFIG.elevationruler.SPEED.useFontAwesome`: Set to true to interpet the `terrainSymbol` as FA unicode.

## Controlling pathfinding

If you set `CONFIG.elevationruler.pathfindingCheckTerrains` to `true`, it will test for Terrain Mapper terrains (including Tiles), Drawings, and Tokens for terrain penalties. This is currently a serious performance hit and so is not enabled by default. (By default, tokens can block pathfinding per user settings but advanced terrain penalties are not considered.) This may change depending on Foundry VTT v12's approach to scene regions.

You can tell the pathfinding algorithm to ignore certain tokens. By default it ignores dead tokens for dnd5e. To change this, set the string in `CONFIG.elevationruler.SPEED.tokenHPAttribute` (or set it to "" to pathfind around dead tokens). If you want default support for a system, open a git issue and preferably tell me how to find the HP value for that system's tokens.

You can also tell the pathfinding algorithm to ignore tokens with certain statuses. The default Set is at `CONFIG.elevationruler.pathfindingIgnoreStatuses`.




