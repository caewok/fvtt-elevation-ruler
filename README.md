[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-elevation-ruler)](https://github.com/caewok/fvtt-elevation-ruler/releases/latest)
[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-elevation-ruler/releases/latest/download/module.json&label=Foundry%20Version&query=$.compatibility.verified&colorB=blueviolet)](https://github.com/caewok/fvtt-elevation-ruler/releases/latest)
[![License](https://img.shields.io/github/license/caewok/fvtt-elevation-ruler)](LICENSE)

![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https://forge-vtt.com/api/bazaar/package/elevationruler&colorB=4aa94a)
![Latest Release Download Count](https://img.shields.io/github/downloads/caewok/fvtt-elevation-ruler/latest/module.zip)
![All Downloads](https://img.shields.io/github/downloads/caewok/fvtt-elevation-ruler/total)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/H2H3Y7IJW)

# ~~Elevation~~ Pathfinding Ruler

As of Foundry v13, the default system token dragging displays a ruler and the ruler is capable of measuring elevation. This obviates much of what Elevation Ruler did in the past. More elevation-specific features may appear in future versions of Elevation Ruler, but the current version of this module focuses on pathfinding when dragging tokens.

## Pathfinding

As of version 0.8.0, a button in the Token controls enables pathfinding for the ruler (or Token Ruler, when enabled). Pathfinding works on gridded (both hex and square) and gridless maps. If using the ruler, start a measurement at a token in order to start pathfinding.

Settings allow you to designate all tokens or hostile tokens as spaces to be avoided.

To enable/disable pathfinding, toggle the pathfinding icon in the token controls (upper left controls in Foundry). You can also hold the specified hotkey (default 'P').

## Module history
As of v0.7, Elevation Ruler adds a setting to display the Foundry ruler when dragging tokens.
As of v0.8, Elevation Ruler adds a toggle to enable pathfinding when using the ruler or dragging tokens with the Token Ruler enabled.
The v0.10 series is the last set to work in v12.
v13 removes parts of Elevation Ruler now native to Foundry v13, and refocuses efforts on pathfinding.

# Installation
Add this [Manifest URL](https://github.com/caewok/fvtt-elevation-ruler/releases/latest/download/module.json) in Foundry to install.

## Dependencies
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)
- Foundry VTT:
  - Elevation Ruler 0.4+: Foundry v9.
  - Elevation Ruler 0.5+: Foundry v10.
  - Elevation Ruler 0.7+: Foundry v11.
  - Elevation Ruler 13.0+: Foundry v13.

## Modules that add functionality
- [Wall Height](https://github.com/erithtotl/FVTT-Wall-Height). For defining limited-height walls.


## What systems does it work on?

It has been tested on dnd5e but is intended to work in all systems. Features related to testing for live/dead/prone tokens or token allies/enemies may require changes to the Elevation Ruler [CONFIG](#Configuration).Please submit an issue in this GitHub if you experience issues when running on your preferred system!

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

# Token controls

Elevation Ruler adds a "Use Pathfinding" control to toggle pathfinding on/off.

# Key bindings

Elevation Ruler defines certain keybindings:
- Temporarily Toggle Pathfinding (`p`): If pathfinding is enabled, temporarily disable while holding this key. If disabled, then temporarily enable it.
- Force to Ground (`g`): If you hit `g` while using the ruler, it will move the destination to use the ground elevation. You can hit `g` again to revert back. Note that the decrement and increment elevation keybindings will still change elevation accordingly. You can use this keybinding when dragging a flying token that you want to "land." Or if you are measuring with the ruler and want the measurement to not accoutn for another token's elevation at a destination point.
- Teleport (`→`): (Foundry v12) If you hit `→` (right arrow key) while the ruler is active, it will jump the token to the end destination without the full slow animation. Instead, it will quickly animate to each user-defined waypoint and then the destination. So the token is updating and "stopping" at each waypoint in turn, just very fast!

# Settings
- Pathfinding Algorithm: Select which algorithm to use.
- Tokens Block: When pathfinding, select whether none, hostile, or all tokens block the path.
- Move Multiplier: Movement speed penalty for moving through tokens, for purposes of pathfinding.
  - Friendlies: Friendly/Friendly, Hostile/Hostile, or Neutral.
  - Hostiles: Friendly/Hostile or Secret.
- Limit Pathfinding to Explored Areas: For users, should the pathfinding stop working when they move the ruler destination into an unexplored area?
- Pathfinding Snap to Grid: Should the path be snapped to grid centers if possible?


# Configuration

# API

You can access defined properties used by Elevation Ruler at `CONFIG.elevationruler`. You can access some of this module's classes and advanced data at `game.modules.get("elevationruler").api`.
