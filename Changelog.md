# 0.7.7
Allow GM to move tokens using the ruler regardless of obstacle. Closes issue #27.
Cancel the ruler when canceling the drag. Closes issue #28.
Add setting to treat tokens as difficult terrain. Closes issue #29.
Force the ruler to use the center of the (dragged) token. Closes issue #30.
Fix error message re setting when using Levels. Closes issue #31.

# 0.7.6
Fix incorrect `Ruler.js` import. Closes issue #26.

# 0.7.5
Fix for pause/unpause game not working due to conflict with token move using spacebar.
Add handling for unsnapping from the grid. If shift is held, unsnap ruler waypoints and destination. If measuring from a token, set the origin point of the ruler to the (possibly unsnapped) token center.
Fix incorrect case on Ruler.js. Closes issue #25.

# 0.7.4
Add option to enable a Token Ruler when dragging tokens.
Add option to use a token speed attribute to highlight in differing colors when using the ruler (from a token) or dragging tokens.

# 0.7.3
Updated lib-geometry to 0.2.12.
Refactor to use Patcher class.

# 0.7.2
Updated lib-geometry to 0.2.2.

# 0.7.1
Updated lib-geometry to 0.2.1.

# 0.7.0
Updated for Foundry v11. Updated lib-geometry to 0.2.0.

# 0.6.8
- Store the active/inactive status of the "prefer token elevation" toggle so it is consistent when switching scenes or reloading Foundry (issue #19).
- Improvements to the logic for measuring overhead tile elevations and terrain elevations when Elevated Vision module is active (issue #18).

# 0.6.7
- Fix measuring elevation with Elevated Vision enabled (issue #18).
- No longer require reload of the canvas when enabling/disabling prefer token control.
- Prefer token control now remembers its current setting (enabled/disabled) when switching back-and-forth between layers

# 0.6.6
Update geometry lib to v0.1.5. Fix for incorrect diagonal measurement in grids (issue #3). Issue with dnd5e may still result in questionable rounded values when measuring Euclidean distances and 5/10/5 measurements on hex maps. See https://github.com/foundryvtt/dnd5e/issues/2257 and https://github.com/foundryvtt/dnd5e/issues/2256.
Fix for updating ruler elevation label on gridless maps when increasing or decreasing elevation.
Fix for measuring elevation for terrains created by Enhanced Terrain Elevation (issues #8, #15).

# 0.6.5
Update geometry lib to v0.1.4.

# 0.6.4
Update geometry lib to v0.1.3.
Fix for calculating total distance in the vertical and horizontal directions (dx or dy equal 0). Possibly fixes issue #14.
Add up/down arrow for label when elevation is unchanged, and move arrow to front of label.

# 0.6.3
Update geometry lib to v0.1.1.
Add options to display Levels floor labels always/never/only when Levels UI is active. (Issue #12).
Fix for description of the key control to increase ruler increments. (Issue #13).

# 0.6.2
Use shared geometry lib git submodule.

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

