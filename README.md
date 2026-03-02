[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-elevation-ruler)](https://github.com/caewok/fvtt-elevation-ruler/releases/latest)
[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-elevation-ruler/releases/latest/download/module.json&label=Foundry%20Version&query=$.compatibility.verified&colorB=blueviolet)](https://github.com/caewok/fvtt-elevation-ruler/releases/latest)
[![License](https://img.shields.io/github/license/caewok/fvtt-elevation-ruler)](LICENSE)

![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https://forge-vtt.com/api/bazaar/package/elevationruler&colorB=4aa94a)
![Latest Release Download Count](https://img.shields.io/github/downloads/caewok/fvtt-elevation-ruler/latest/module.zip)
![All Downloads](https://img.shields.io/github/downloads/caewok/fvtt-elevation-ruler/total)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/H2H3Y7IJW)

# ~~Elevation~~ Pathfinding Ruler

As of Foundry v13, token dragging displays a ruler and the ruler is capable of measuring elevation. More elevation-specific features may appear in future versions, but the current version of this module focuses on pathfinding when dragging tokens.

## Pathfinding

As of version 0.8.0, a button in the Token controls enables pathfinding for the ruler (or Token Ruler, when enabled). Pathfinding works on gridded (both hex and square) and gridless maps. If using the ruler, start a measurement at a token in order to start pathfinding.

Settings allow you to designate all tokens or hostile tokens as spaces to be avoided.

To enable/disable pathfinding, toggle the pathfinding icon in the token controls (upper left controls in Foundry). You can also hold the specified hotkey (default 'P').

## Module history
As of v0.7, Elevation Ruler adds a setting to display the Foundry ruler when dragging tokens.
As of v0.8, Elevation Ruler adds a toggle to enable pathfinding when using the ruler or dragging tokens with the Token Ruler enabled.
The v0.9 series is the last set to work in v12.

(Versioning jumps to v13, intended to parallel Foundry versioning.)
v13 removes parts of Elevation Ruler now native to Foundry v13, and refocuses efforts on pathfinding.

# Installation
Add this [Manifest URL](https://github.com/caewok/fvtt-elevation-ruler/releases/latest/download/module.json) in Foundry to install.

## Dependencies
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)

(Elevation Ruler 0.4+ requires Foundry v9 because it replaces the DF Hotkeys dependency with the Foundry keybindings introduced in v9.)
(Elevation Ruler 0.5+ requires Foundry v10 due to improvements in the Foundry Ruler API.)
(Elevation Ruler 0.7+ requires Foundry v11.)
(Elevation Ruler 0.10+ requires Foundry v13.)

## Modules that add functionality
- [Wall Height](https://github.com/erithtotl/FVTT-Wall-Height). For defining limited-height walls.


## What systems does it work on?

It has been tested on dnd5e but is intended to work in all systems. Features related to testing for live/dead/prone tokens or token allies/enemies may require changes to the Elevation Ruler [CONFIG](#Configuration).Please submit an issue in this GitHub if you experience issues when running on your preferred system!

# How to Use



# Pathfinding Algorithms

## Gridded Collision

Breaks the scene into a grid and measures cost and obstacle collisions when moving between the grid points. Measurement can be handled using native Foundry tools, which helps with compatibility across systems. Uses A^*^ to find best path between grid points.

Currently, gridded collision runs on the main thread, not a worker. That will likely change in the future, but it is non-trivial to interact with Foundry canvas objects in a web worker. Performance can be an issue for large scenes or gridless scenes (which require a smaller grid overlay for this algorithm to work).

Performance is dependent on the number of grid squares for a given canvas. For gridless, it is tied directly to canvas size. Performance also depends on the number of walls and path length.

While post-processing can turn gridded movement into straight-line paths, you may want to try Clockwise Sweep for that use case.

*Best for:*
- Gridded scenes.
- Optimal pathfinding with difficult terrain

*Not great for:*
- Gridless scenes
- Large scenes or open areas

**Implemented features**:
- [] Square grids
- [x] Hex grids
- [ ] Gridless
- [ ] Snap-to-grid
- [ ] All tokens block
- [ ] Enemies-only tokens block
- [ ] Tokens as difficult terrain
- [ ] Difficult terrain regions
- [ ] Token shapes:
  - [ ] Rectangular
  - [ ] Hexagonal
  - [ ] Elliptical cylinder
  - [ ] Sphere
  - [ ] Ellipsoid



## Clockwise Sweep

Clockwise sweep is the algorithm FoundryVTT uses to measure line-of-sight for tokens and lights. Here, the algorithm is re-purposed for pathfinding. Essentially, corners at the edge of the line-of-sight are considered neighbors. Uses A^*^ to find best path between these neighbors, building the line-of-sight at each neighbor.

Beginning at the path start, line-of-sight is measured and the LOS polygon is created. If the end point is in this LOS polygon, we are done. During the LOS sweep, points are marked when a wall blocks the sight and thus creates an open gap area. These are potential "corners" leading to unseen areas. Both a point close to the corner and one halfway along the gap edge are treated as potential neighbors. This effectively allows the line-of-sight to progressively "peek" around corners into unexplored areas.

The end result is an algorithm that works very quickly in large open areas, and is not grid-dependent. Path endpoints tucked away in hard-to-reach corners can sometimes pose a challenge. The algorithm also does not explore all the spaces, so while it will account for terrain cost, it will not always find the optimal path.

Performance decreases as the number of walls increase, but performance is not dependent on canvas size. Performance is not dependent on path length, but is dependent on the number of turns required.

While post-processing can change the straight paths of this algorithm into gridded paths, that is suboptimal. Recommend using another algorithm if gridded movement is essential.

*Best for:*
- Gridless scenes
- Performance without using WebGPU
- Large open areas

*Not great for:*
- Optimal pathfinding
- Gridded movement or snap-to-grid

**Implemented features**:
- [] Square grids
- [ ] Hex grids
- [] Gridless
- [] Snap-to-grid
- [ ] All tokens block
- [ ] Enemies-only tokens block
- [ ] Tokens as difficult terrain
- [ ] Difficult terrain regions
- [ ] Token shapes:
  - [ ] Rectangular
  - [ ] Hexagonal
  - [ ] Elliptical cylinder
  - [ ] Sphere
  - [ ] Ellipsoid



## WebGPU (Flood-fill or Wavefront propagation)

This algorithm works in two stages. When a token drag starts, a model of the scene, with blocking edges and difficult terrain, is sent to the GPU. The GPU measures, for every pixel, the least cost to get back to the starting point. (Resolution here may be less than 1-to-1 compared to the scene canvas to improve performance.) This is the "distance map." Creating the map is somewhat slow; performance depends almost entirely on scene size.

Once the distance map is created, a path is found by simply "rolling downhill" from the end point back to the start.

Creation of the distance map is handled in a web worker to avoid locking the initial token drag. Creation of the path is also handled by the web worker. This is currently the only algorithm that uses a web worker.

Performance of the initial distance map creation depends almost entirely on scene size, although a large number of tokens in the scene will increase the time needed to transfer data to the web worker. Once the distance map is created, performance is very fast and is only lightly influenced by the path length.

*Best for:*
- Gridless scenes
- Gridded scenes
- Complex scenes
- Performance

*Not great for:*
- System compatibility
- Large open areas (See Clockwise Sweep)
- Snap-to-grid
- Straight-line movement instead of gridded movement (See Clockwise Sweep)

**Implemented features**:
- [] Square grids
- [ ] Hex grids
- [ ] Gridless
- [ ] Snap-to-grid
- [ ] All tokens block
- [ ] Enemies-only tokens block
- [ ] Tokens as difficult terrain
- [ ] Difficult terrain regions
- [ ] Token shapes:
  - [ ] Rectangular
  - [ ] Hexagonal
  - [ ] Elliptical cylinder
  - [ ] Sphere
  - [ ] Ellipsoid


# Token controls

Elevation Ruler adds a "Use Pathfinding" control to toggle pathfinding on/off.

# Key bindings

Elevation Ruler defines certain keybindings:
- Decrement Ruler Elevation (`[`): When measuring or dragging tokens, decrease the destination elevation by one grid unit. If you trigger a token move, its elevation will be adjusted accordingly.
- Increment Ruler Elevation (`]`): See Decrement.
- Add Token Ruler Waypoint (`=`): When dragging tokens, add a waypoint.
- Remove Token Ruler Waypoint (`-`): When dragging tokens, remove a waypoint.
- Temporarily Toggle Pathfinding (`p`): If pathfinding is enabled, temporarily disable while holding this key. If disabled, then temporarily enable it.
- Force to Ground (`g`): If you hit `g` while using the ruler, it will move the destination to use the ground elevation. You can hit `g` again to revert back. Note that the decrement and increment elevation keybindings will still change elevation accordingly. You can use this keybinding when dragging a flying token that you want to "land." Or if you are measuring with the ruler and want the measurement to not accoutn for another token's elevation at a destination point.
- Teleport (`→`): (Foundry v12) If you hit `→` (right arrow key) while the ruler is active, it will jump the token to the end destination without the full slow animation. Instead, it will quickly animate to each user-defined waypoint and then the destination. So the token is updating and "stopping" at each waypoint in turn, just very fast!

# Settings

- Add token elevation control: Add the "Prefer Token Elevation Control" to the Token controls.
- Tokens Block: When pathfinding, select whether none, hostile, or all tokens block the path.
- Limit Pathfinding to Explored Areas: For users, should the pathfinding stop working when they move the ruler destination into an unexplored area?
- Use Token Ruler: Display the ruler when dragging tokens.
- Use Token Speed Highlighting: Highlight grid squares under the ruler based on the token's speed. See API, below, for how to modify colors and speed categories.
- Track Combat Move: When displaying the speed highlighting during combat, count any movement already made by the token this combat round.
- Combine Prior Movement with Total Movement: When Track Combat Move is enabled, combine the token's prior movement in the round with the total movement. Otherwise, place the prior movement on a separate line.
- Round Distance to Multiple: Round the measurement display by this multiple. For example, "10" will round 111.23 to 110.
- Token as Terrain Multiplier: How much does a token penalize movement through that token?
- Terrain Grid Measurement: When measuring movement through terrain on a gridded map, how should the terrain be accounted for?
  - Center Point: if the terrain overlaps the grid square/hex center point, that grid square/hex will have penalized movement.
  - Percent Area: if the terrain area excees some threshold coverage of the grid square/hex center point, that grid square/hex will have penalized movement.
  - Euclidean: A line moving through the terrain will be proportionally penalized based on the percentage of that line within the terrain.
- Percent Area Threshold: Defines the threshold in Terrain Grid Measurement: Percent Area.

# Configuration

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

const MaximumSpeedCategory = {
  name: "Maximum",
  color: Color.from(0xff0000),
  multiplier: Number.POSITIVE_INFINITY
};
```
Categories are processed in order in the `SPEED.CATEGORIES` array. Usually (unless you modify the `SPEED.maximumCategoryDistance` function per below) you would want the categories sorted from smallest to largest multiplier. For example, a token with speed 30 could walk for 30 * 1 grid units, and dash for 30 * 2 = 60 grid units. So the first 30 grid units would be highlighted for walk, the next 30 highlighted for dash, and everything beyond that highlighted with the maximum color.

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




