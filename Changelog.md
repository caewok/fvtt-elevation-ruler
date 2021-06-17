## 0.1.1
Correct display of negative current elevation in ruler. 

## 0.1.0
Add terrain measurement feature. 
- Use destination token elevation to automatically change ruler elevation.
- Use Enhanced Terrain Layer to automatically change ruler elevation.
- Change ruler display to show elevation change and current elevation at each waypoint.

## 0.0.4
Add compatibility for libRuler 0.0.5.
- Address the change to physical path (Object instead of Array).

## 0.0.3
Add compatibility for Foundry 0.8.5.
- Change updating of the token elevation to use the Document class.

## 0.0.2

Incorporate previous segments change from libRuler.
- Add a flag to track when any segment has an elevation change, for labeling.
- Correct elevation measurement by switching to grid units for the elevation points.
- Label total elevation using absolute value (arrow signifies up or down).

## 0.0.1

Incorporate libRuler and various improvements.

- Add flags to each Segment to track elevation during measurement.
- Change elevation on the moved token.
- Correct issue with displaying hotkey in the preferences for Elevation Ruler. 

## 0.0.1.alpha2

Basic functionality to increment/decrement elevation using the default Foundry ruler.

- Track elevation changes in the ruler.
- Allow user to select a hotkey [DF Hotkeys module](https://foundryvtt.com/packages/lib-df-hotkeys) to add or subtract elevation.
- Display the elevation change once changed by the user
- Track and display elevation change across waypoints.
- Display elevation changes to other users.

