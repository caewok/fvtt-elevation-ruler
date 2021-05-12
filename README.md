![](https://img.shields.io/badge/Foundry-v0.7.9-informational)

# Elevation Ruler

This module allows the default Foundry measurement ruler to track change in elevation. When you hit the specified hot key (default: '[' to increment and ']') while using the measurement ruler, the ruler display will update to display the incremental elevation change relative to the measured starting point. If you add a waypoint, elevation will be tracked at each waypoint.

## Dependencies

- [DF Hotkeys Module ](https://github.com/flamewave000/dragonflagon-fvtt/tree/master/lib-df-hotkeys)
- [libWrapper Module](https://github.com/ruipin/fvtt-lib-wrapper)

## Details

To use, start measuring with the Foundry measurement ruler as normal. While doing so, hit '[' to increase the elevation at the destination by one step. A step is equal to the grid size (typically 5 feet). Hit ']' to decrease the elevation at the destination by one step. These hotkeys can be changed by going to the DF Hotkeys module setting.

Once elevation is changed, the ruler display will change to show three lines. First, the waypoint distance and total distance along the plane as with the default ruler. Second, the waypoint elevation and total elevation distance. Third, the total combined distance, assuming one moves diagonally in three-dimensions from origin to the elevated destination.

For dnd5e, the total distance along the diagonal will follow the chosen dnd5e measurement rule: 5-5-5, 5-10-5, or Euclidean. 

For example, here is the measurement that is displayed in DnD 5e with the 5-5-5 rule, where a diagonal move counts as 5 feet:
![Demonstrate DnD 5e 5-5-5 Measurement](https://github.com/caewok/fvtt-elevation-ruler/blob/6cc09a53f49973eb03dbf9581104a3ea7ffe9561/media/measurement_dnd_5-5-5.webm)

Compare to the DnD 5e 5-10-5 rule, where a diagonal move counts as 5 or 10 feet, alternating: 
![Demonstrate DnD 5e 5-10-5 Measurement](https://github.com/caewok/fvtt-elevation-ruler/blob/6cc09a53f49973eb03dbf9581104a3ea7ffe9561/media/measurement_dnd_5-10-5.webm)

Finally, the DnD Euclidean measurement rule, rounded to the nearest foot:
![Demonstrate DnD 5e Euclidean](https://github.com/caewok/fvtt-elevation-ruler/blob/6cc09a53f49973eb03dbf9581104a3ea7ffe9561/media/measurement_dnd_euclidian.webm)

## FAQ

### How does the underlying measurement work?

When measuring between origin point A and destination point B, incrementing elevation will move the destination to a point C 1 unit above (in the vertical direction) from B. Thus, the line between A and C is the hypotenuse of the right triangle formed by A, B, and C. That triangle is then projected back on the 2-D plane by rotating it 90 degrees, and the diagonal between A and C is measured using the underlying system measurement default. Thus, adding elevation will always cause a measurement along a diagonal.

For each additional waypoint, elevation is measured between the waypoints. Thus, if waypoint 1 moves up 10 feet, and waypoint 2 then moves down 10 feet, the measured distance will assume a move up by 10 feet, and then a second move down by 10 feet—--in other words, distances between waypoints do not "cancel out."

### What systems does it work on? 

It has been tested on dnd5e 1.2.4. Because it adds to the functionality of the underlying Foundry measurement ruler, it may work on other systems as well, unless the system overrides key Foundry measurement functions in the Ruler Class.

### Does it conflict with any modules?

Modules that overwrite or extend the Ruler Class may cause the elevation ruler module to fail to display or calculate correctly. In particular, there are known incompatibilities with [Drag Ruler](https://github.com/manuelVo/foundryvtt-drag-ruler) and will likely not work with [Terrain Ruler](https://github.com/manuelVo/foundryvtt-terrain-ruler). 


