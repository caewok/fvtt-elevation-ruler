# 0.9.0
### New features
Add indicator of past combat movement in the ruler.
Allow for unlimited number of speed categories, colors, along with custom speed functions in the CONFIG. Closes issue #58.
More aggressive path straightening using a reverse Ramer-Douglas-Peucker algorithm based on collision checking. Closes issue #48.
Add CONFIG settings to ignore tokens for pathfinding based on HP attribute or set of token statuses. Closes issue #55.
Add a keybind ("p") to temporarily toggle pathfinding.
Add `rulerSegmentOrigin` and `rulerSegmentDestination` to options passed to token update.

### Bug fixes
Refactor physical and move distance measurement in anticipation of Foundry v12. Closes issue #59 (measurement near waypoints).
Refactor how segments are split for purposes of speed highlighting.
Fix for counting alternating diagonals across ruler segments/waypoints.
Fix for token stopping prematurely if the mouse is released after space bar pressed when using the Ruler.
Fix for "drunken token movement" in which a token would wander off the path when moving through several fake waypoints that were not centered on the grid.

# 0.8.9
### New features
Track combat moves on a per-combat basis. Add settings toggle to have movement speed highlighting reflect sum of moves for that combat round.

### Bug fixes
Fix errors thrown when using the ruler without a movement token with either Terrain Mapper or Elevated Vision modules active. Closes issue #51.
Display speed colors to other users who have the speed color setting enabled. Closes issue #53.
Add CONFIG options to set additional movement types to the token hud. Closes issue #50.
```js
// Example: Add a swim movement to the api.
CONFIG.elevationruler.MOVEMENT_TYPES.SWIM = 3; // Increment by 1 from the highest-valued movement type
CONFIG.elevationruler.MOVEMENT_BUTTONS[CONFIG.elevationruler.MOVEMENT_TYPES.SWIM] = "person-swimming"; // From Font Awesome
CONFIG.elevationruler.SPEED.ATTRIBUTES.SWIM = "actor.system.attributes.movement.swim"; // dnd5e
```

# 0.8.8
Improvements to updating the scene graph. Avoid leaving unneeded vertices and split edges when a token or wall is removed. Fixes to handling overlapping edges to correctly reflect what objects make up the edge.

Update lib geometry to v0.2.18.

# 0.8.7

## New Features
GM can now set whether pathfinding should be limited for users to areas within the fog of war. FYI, testing fog of war in Foundry for canvas positions is a performance hit. Closes issue #47.

## Bug fixes
Take the starting elevation of the path when testing whether tokens or walls block the path. Allows tokens or limited height walls to be ignored if no collision at the given elevation.

Fix for measuring elevation when Elevated Vision module is enabled. Closes issue #45.

# 0.8.6
Fix for pathfinding slipping through small cracks between walls. Unless the wall is a door, the path should be limited to half the token min(width, height).

# 0.8.5

## New Features
Added settings for selecting how terrain and other tokens are measured for grid squares. GM can choose to count difficult terrain if it covers the grid center, covers a fixed percentage of a grid square/hex, or by the percent for which it overlaps a line between the previous grid shape center to the current grid shape center ("euclidean").

Added selection in Drawings to treat a drawing as imposing a move bonus/penalty. May be changed or dropped to accommodate Foundry v12 scene regions in the future.

## Bug fixes
Fix for the token apparent position disconnecting from actual token position when dragging or moving token with the ruler.
Fix for undefined `constrainedTokenBounds.contains`. Closes issue #46.
Fix for highlighting incorrect squares with high elevation changes.
Refactor (again!) measurement of distances and move distances. Addresses issues with movement measurement calculating incorrectly when speed highlighting adds temporary waypoints.
Update lib geometry to v0.2.17.

# 0.8.4
Improve path cleaning algorithm to remove multiple straight-line points. Closes issue #40.
Refactor measurement of distances and move distances to better account for 3d distance. Closes issue #41.
Remove animation easing for intermediate segments while keeping easing-in for the first segment and easing-out for the last segment.
Add `CONFIG` settings to change the unicode symbol displayed when the ruler is over terrain (or tokens, if tokens count as difficult terrain).
- `CONFIG.elevationruler.SPEED.terrainSymbol`: You can use any text string here. Paste in a unicode symbol if you want a different symbol. For Font Awesome icons, use, e.g., "\uf0e7".
- `CONFIG.elevationruler.SPEED.useFontAwesome`: Set to true to interpet the `terrainSymbol` as FA unicode.
Update lib geometry to v0.2.15.

## Breaking changes
The added methods `Ruler.measureDistance` and `Ruler.measureMoveDistance` were refactored and now take different parameters.

# 0.8.3
Add setting for pathfinder to avoid all tokens or hostile tokens. Closes issue #37.
Misc. fixes to pathfinding to reduce likelihood of it failing to find a path or finding an incorrect path.
Fix for waypoint elevations not finite. Closes issue #38.
Refactor of elevation handling to account for Token Ruler tokens versus primary ruler.

Add selector to Token HUD to choose between walk/fly/burrow movement types. Default is to automatically choose based on elevation. Closes issue #33.

Move settings related to speed properties to `CONFIG.elevationruler.SPEED`.

Add getter `Token.prototype.lastMoveDistance` that tracks the last token move. If combat is active, this returns 0 if the token has not yet moved this round. Use `Token.prototype._lastMoveDistance` to find the actual last distance moved regardless of combat.

Add setting to round ruler measurements, for use with gridless scenes. Thanks @Larkinabout for the PR!

# 0.8.2
Improvements to calculating distance on a grid. Improvements to splitting ruler segments when highlighting based on token speed. Closes issue #35. Improvements to treating tokens as difficult terrain for purposes of token speed highlighting.

Added a "hiking boot" displaying token movement distance in the ruler when difficult terrain is encountered (tokens or from Terrain Mapper module).

# 0.8.1
Fix toggling pathfinding between waypoints.
Various fixes to display of ruler for other users.
Fixes for display of distance calculations between waypoints.
Possible fix for issue #33 (undefined `token.bounds`).

# 0.8.0
Added pathfinding toggle. Pathfinding works on gridded (both hex and square) and gridless maps. Works when dragging tokens, if Token Ruler is enabled, or when using the Ruler control and you start at a token.

To benchmark pathfinding in a scene:
```js
api = game.modules.get("elevationruler").api;
api.pathfinding.benchPathfinding()
```

Refactored movement highlighting to work better with pathfinding.

# 0.7.8
More tweaks to how token origin and destination are set when dragging so that the token movement follows the position of the cloned dragged token. Revisits issue #30.
Fix issue where token dragging cannot move to the adjacent space. Closes issue #32.

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

