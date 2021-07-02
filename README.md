[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-elevation-ruler)](https://github.com/caewok/fvtt-elevation-ruler/releases/latest)
[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-elevation-ruler/releases/latest/download/module.json&label=Foundry%20Version&query=$.compatibleCoreVersion&colorB=blueviolet)](https://github.com/caewok/fvtt-elevation-ruler/releases/latest)
[![License](https://img.shields.io/github/license/caewok/fvtt-elevation-ruler)](LICENSE)

# Elevation Ruler

This module allows the default Foundry measurement ruler to track change in elevation. Elevation can be changed while using the ruler in three ways:
1. Manually. Hit the specified hot key (default: '[' to increment and ']' to decrement).
2. Token. When hovering over a token with the ruler, the origin or destination elevation (as applicable) will update. 
3. Enhanced Terrain Layer. If a terrain layer is present with a finite max elevation, that max elevation will be used for the elevation.

The distance calculation updates based on the distance measured, assuming a straight line in three dimensions between origin and destination, taking into account elevation change.

If you add a waypoint, elevation will be tracked at each waypoint.

If you choose to move the origin token (by hitting spacebar) after measuring, the token elevation will be updated along each waypoint. 

# Installation
Add this [Manifest URL](https://github.com/caewok/fvtt-elevation-ruler/releases/latest/download/module.json) in Foundry to install.

## Dependencies
- [DF Hotkeys ](https://github.com/flamewave000/dragonflagon-fvtt/tree/master/lib-df-hotkeys)
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)
- [libRuler](https://github.com/caewok/fvtt-lib-ruler)

## Modules that add functionality
- [Enhanced Terrain Layer](https://github.com/ironmonk88/enhanced-terrain-layer)

## Known conflicts
- [Terrain Ruler](https://github.com/manuelVo/foundryvtt-terrain-ruler)
- [Drag Ruler](https://github.com/manuelVo/foundryvtt-drag-ruler)

I hope to have a future compatibility fix, based in libRuler, that allows Terrain Ruler and Drag Ruler to play nicely with Elevation Ruler.

In general, modules that overwrite or extend the Ruler Class may cause the elevation ruler module to fail to display or calculate correctly. 

## What systems does it work on? 

It has been tested on dnd5e 1.3.3 to 1.3.6. Because it adds to the functionality of the underlying Foundry measurement ruler, it may work on other systems as well, unless the system overrides key Foundry measurement functions in the Ruler Class.

# Details

To use, start measuring with the Foundry measurement ruler as normal. While doing so, hit '[' to increase the elevation at the destination by one step. A step is equal to the grid size (typically 5 feet). Hit ']' to decrease the elevation at the destination by one step. 

## Settings
- Change the elevation increment hotkeys
- Toggle using terrain for elevation measurement. Requires Enhanced Terrain Layer.

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

## Terrain measurement  

To use terrain measurement, first set up one or more terrains using Enhanced Terrain Layer. Set a maximum value for the terrain layer. 

![Screenshot Terrain Setup](https://raw.githubusercontent.com/caewok/fvtt-elevation-ruler/feature/media/media/terrain-setup.jpg)

Now when you drag the ruler over a terrain area, the ruler will automatically adjust the elevation based on the terrain maximum height. Note that this is based on the center-point of the current ruler position. You can still increment the values up or down manually, and those values will persist as you move the ruler around. 

![Screenshot Terrain Measurement](https://raw.githubusercontent.com/caewok/fvtt-elevation-ruler/feature/media/media/terrain-measure.jpg)

## Token measurement 

Similarly, as you can see in the previous screenshot, if you drag the ruler over a token that has been elevated or lowered, the ruler will reflect the elevation of that token (plus or minus manually incremented values).

This is particularly useful where you have an elevated character at the origin, and want to fire or move downwards. Or vice-versa where you are aiming at an elevated token and need total distance to the elevated target.

This video shows both terrain and token measurement in action.

![Video Terrain Measurement](https://github.com/caewok/fvtt-elevation-ruler/raw/feature/media/media/terrain-measure.mov)







