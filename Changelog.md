# 0.6.1
Fix ruler calculation so the combined elevation distance and 2d distance is shown. (Closes issue #11.)

# 0.6.0
Drag Ruler compatibility! Some under-the-hood changes extending Ray to a Ray3d class to make segment distance measurements easier to accomplish.

Fix issue #1 (Ruler updating for other users)

# 0.5.0
Foundry v10 compatibility. v9 only supported in 0.4 versions.
Due to various improvements in Foundry v10 Ruler class, libRuler is now deprecated; only libWrapper is required as a dependency.

- Updated Levels module support.
- Updated code for Enhanced Terrain module but a bug with that module is preventing testing.
- Added Elevated Vision module support.

# 0.5.0-alpha
Foundry v10 testing.

# 0.4.0
Require Foundry v9; replace df-hotkeys module dependency with Foundry keybindings.

# 0.3.3
Fix issue #5 (levels_data undefined).

# 0.3.2
Fix repeated warnings when using devMode for logging.
Call the libRuler distance function when projecting on a grid, to accommodate modules that might modify the distance function.

# 0.3.1
Correct module.json link to DragonFlagon Hotkeys Library.

# 0.3.0
Move to libRuler 0.1 compatibility.
Improvements:
- Wraps libRuler RulerUtilities functions to 3d versions: `iterateGridUnderLine`, `calculateDistance`, `pointsAlmostEqual`.
- Adds user setting to prefer the starting token elevation when measuring.
- Revamps the projection from 3-D to 2-D to account for specific grid types and diagonal rules. This should more closely correspond to user expectations concerning vertical movement in a grid.

Breaking changes due to libRuler changes:
- Relies on the libRuler RulerUtilities functions

# 0.2.5
Correct "jumping token" issue where when the token is moved, it will appear to drift off the path and move twice.

For conceptual consistency, switch to projecting the origin point for the token so that the projected path goes from the token at a given height to the destination point. This was the intended approach, but the origin/destination got flipped in the projection code. May not result in a different outcome in most cases, but may be different for edge cases when measuring diagonals.

# 0.2.4
Minor update with additional checks on presence of elevation increment flag. Additional logging.

# 0.2.3
Fix #3. When a grid is present, snap the projected destination point to the center of the grid. This keeps the distances consistent for different cardinalities. Rounding still occurs with grid measurements such that adjacent squares may have the same measured 3-D distance despite appearing to be closer/further from the origin point.

## 0.2.2
Update manifest for libruler dependency to point to correct JSON URL. Fixes #2.

## 0.2.1
Catch when no Levels tiles are present under the ruler position, so that Levels floor labels do not appear unnecessarily.

## 0.2.0
Add levels measurement function
- When over a levels tile, default to the bottom elevation of that tile.
- When over a levels hole, default to the bottom elevation of that hole.
- When starting at a token, stay at the floor level for that token unless over a hole or other token.
- Optional label for the current floor level.
Switch to using `canvas.terrain.terrainsFromPixels` (requires Enhanced Terrain Layer 1.0.30+).

## 0.1.3
Catch case where game.users.isGM is undefined.

## 0.1.2
Update the module.json to use a name without special characters to conform to Foundry requirements. Update Foundry compatibility to 0.8.8.

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

