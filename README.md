
# Elevation Ruler

This module allows the default Foundry measurement ruler to track change in elevation. When you hit the specified hot key (default: ']' to increment and '[' to decrement) while using the measurement ruler, the ruler display will update to display the incremental elevation change relative to the measured starting point. If you add a waypoint, elevation will be tracked at each waypoint.

<!--- Downloads @ Latest Badge -->
[![License](https://img.shields.io/github/license/caewok/fvtt-elevation-ruler)](LICENSE)

[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-elevation-ruler)](https://github.com/caewok/fvtt-elevation-ruler/releases/latest)

[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-elevation-ruler/releases/latest/download/module.json&label=Foundry%20Version&query=$.compatibleCoreVersion&colorB=blueviolet)](https://github.com/caewok/fvtt-elevation-ruler/releases/latest)

## Dependencies

- [DF Hotkeys Module ](https://github.com/flamewave000/dragonflagon-fvtt/tree/master/lib-df-hotkeys)
- [libWrapper Module](https://github.com/ruipin/fvtt-lib-wrapper)
- [libRuler Module](https://github.com/caewok/fvtt-lib-ruler)

## Details

To use, start measuring with the Foundry measurement ruler as normal. While doing so, hit ']' to increase the elevation at the destination by one step. A step is equal to the grid size (typically 5 feet). Hit '[' to decrease the elevation at the destination by one step. These hotkeys can be changed by going to the DF Hotkeys module setting.

Once elevation is changed, the ruler display will change to display the waypoint elevation and total elevation distance. The default distance and combined distance will be updated to reflect total movement with elevation. 

For dnd5e, the total distance along the diagonal will follow the chosen dnd5e measurement rule: 5-5-5, 5-10-5, or Euclidean. Note that this means for some configurations, incrementing or decrementing elevation may not immediately change the total calculated distance, because the actual path taken is assumed to be diagonally upwards or downwards toward the destination waypoint. 

## FAQ

### How does the underlying measurement work?

When measuring between origin point A and destination point B, incrementing elevation will move the destination to a point C 1 unit above (in the vertical direction) from B. Thus, the line between A and C is the hypotenuse of the right triangle formed by A, B, and C. That triangle is then projected back on the 2-D plane by rotating it 90 degrees, and the diagonal between A and C is measured using the underlying system measurement default. Thus, adding elevation will always cause a measurement along a diagonal.

For each additional waypoint, elevation is measured between the waypoints. Thus, if waypoint 1 moves up 10 feet, and waypoint 2 then moves down 10 feet, the measured distance will assume a move up by 10 feet, and then a second move down by 10 feet—--in other words, distances between waypoints do not "cancel out."

For example, here is the measurement that is displayed in DnD 5e with the 5-5-5 rule, where a diagonal move counts as 5 feet:
![Video of DnD 5e 5-5-5 Measurement](https://raw.githubusercontent.com/caewok/fvtt-elevation-ruler/6cc09a53f49973eb03dbf9581104a3ea7ffe9561/media/measurement_dnd_5-5-5.webm). The first waypoint is 15 feet east and 15 feet up from the origin. Because under this rule, a diagonal move is only 5 feet, this first waypoint can be reached by moving diagonally east and up a total of 3 squares, or 15 feet. 

After the waypoint, the destination is another 15 feet away to the north, no further elevation change. Thus, the total distance is 15 feet from the first waypoint plus another 15 feet, for 30 feet total. 
![Screenshot DnD 5e 5-5-5 Measurement](https://raw.githubusercontent.com/caewok/fvtt-elevation-ruler/c7664c550b5da4afec07e6f7076f301513834d36/media/measurement_dnd_5-5-5.webp)

Compare to the DnD 5e 5-10-5 rule, where a diagonal move counts as 5 or 10 feet, alternating:
![Video of DnD 5e 5-10-5 Measurement](https://raw.githubusercontent.com/caewok/fvtt-elevation-ruler/6cc09a53f49973eb03dbf9581104a3ea7ffe9561/media/measurement_dnd_5-10-5.webm). The first waypoint is 15 feet east and 10 feet up. With a 5-10-5 rule, it would cost 5 feet for the first diagonal move, 10 feet for the second diagonal move (to 10 feet east, 10 feet up) and then another 5 feet for another move east. Total would be 20 feet. 

After the waypoint, the destination is another 10 feet south and 10 feet up. This can be accomplished in a diagonal move of two squares, so 5 feet for the first and 10 feet for the second, for a total of 15 feet.

Total movement along the plane is 25 feet (15 feet east plus 10 feet south). Total elevation change is 20 feet (10 feet for each waypoint). Total distance moved adds the two waypoint totals together: 20 feet plus 15 feet totals 35 feet.

![Screenshot DnD 5e 5-10-5 Measurement](https://raw.githubusercontent.com/caewok/fvtt-elevation-ruler/c7664c550b5da4afec07e6f7076f301513834d36/media/measurement_dnd_5-10-5.webp)

Finally, the DnD Euclidean measurement rule, rounded to the nearest foot:
![Video of DnD 5e Euclidean](https://raw.githubusercontent.com/caewok/fvtt-elevation-ruler/6cc09a53f49973eb03dbf9581104a3ea7ffe9561/media/measurement_dnd_euclidian.webm). Here, the diagonal move at each waypoint is measured precisely and rounded to the nearest foot. The first waypoint moves 15 feet up and 15 feet east, which can be accomplished diagonally by moving, according to Pythagorean's Theorem, sqrt(15^2 + 15^2) ≅ 21 feet. 

After the waypoint, there is a 10 foot move to the south with no additional elevation. So the total distance is 21 + 10 = 31 feet. 

![Screenshot DnD 5e Euclidean Measurement](https://raw.githubusercontent.com/caewok/fvtt-elevation-ruler/c7664c550b5da4afec07e6f7076f301513834d36/media/measurement_dnd_euclidian.webp)

### What systems does it work on? 

It has been tested on dnd5e 1.2.4. Because it adds to the functionality of the underlying Foundry measurement ruler, it may work on other systems as well, unless the system overrides key Foundry measurement functions in the Ruler Class.

### Does it conflict with any modules?

Modules that overwrite or extend the Ruler Class may cause the elevation ruler module to fail to display or calculate correctly. In particular, there are known incompatibilities with [Drag Ruler](https://github.com/manuelVo/foundryvtt-drag-ruler) and will likely not work with [Terrain Ruler](https://github.com/manuelVo/foundryvtt-terrain-ruler). 


