# 0.10.13
Use a cached map to track move penalties for different region combinations. Improves compatibility with DAE. Addresses #209.


# 0.10.12
Fixes for calculating movement penalty in drawings.
Avoid displaying the default ruler label in some situations when using the custom label. Closes issue #212.
Fix for PF2e speed not displaying correctly. Closes issue #211.
Fix for user seeing the GM ruler when moving hidden tokens. Closes issue #207.
Add support for Shadow of the Demon Lord. Thanks @sasquach45932!

# 0.10.11
When snapping pathfinding to grid, avoid two waypoints within the same space when snapping is possible.
Fix for ray undefined in cost measurement.
Add invisibility to the default ignored statuses for pathfinding. Closes #202.
Don't show movement penalty in the ruler labels if token has certain statuses, like hidden. Closes #200.
Faster measurement of movement penalty through regions in conjunction with improvements added in Terrain Mapper v0.4.6.
Fix for ruler not functioning in sfrpg. Closes #206.
Update libGeometry to v0.3.14.

# 0.10.10
Improve how the pathfinding path is cleaned when snapping to grids to avoid weird backstepping issues. Should be a bit more aggressive in finding a viable grid-center path.
Don't pathfind around hidden tokens. Closes #200.
Fix for error re clone function not found when tracking combat move history. Closes #201.

# 0.10.9
Additional fix for 5-10-5 using 10-5-10 (the offset distance was not fixed previously). Closes #195, #196.
If the movement cost is rounded to 0, don't display the label. Closes #196.
Update Polish translation. Closes #199. Thanks @Lioheart!
Fix for movement penalty getting inverted for grid measurement option. Closes #198.
Fix right-click to add waypoints. Closes #197, #192.

# 0.10.8
Fix for 5-10-5 using 10-5-10 and vice versa. Closes #195.
Update libGeometry to v0.3.12.

# 0.10.7
Switch to using Bresenham 3d algorithm to determine 3d grid path for square grids. Use Bresenham 4d algorithm to determine 3d grid path for hex grids (hex-cube dimensions + elevation dimension). Closes #194.
For pathfinding, don't consider walls blocking if the wall top elevation equals the token elevation (but still blocks if wall bottom elevation equals token elevation).
If Wall Height module is active and vaulting is enabled, ignore walls within the vaulting height.
Update Italian localization. Thanks @GregoryWarn!
Update Brazilian Portugese translation. Thanks @Kharmans!
Update libGeometry to v0.3.11.

# 0.10.6
## New Features
Setting to apply movement penalties per-grid-space. Defaults to enabled. For gridded scenes, this will (1) count regions/tokens/drawings as imposing movement penalty only if the region/token/drawing overlaps the center point of the grid space and (2) impose the penalty at a grid-space level. If disabled, this will proportionally apply the penalty based on the precise movement path. Closes #181.

Setting to add (or subtract) a flat amount when moving into a grid space with a token penalty. E.g. +5 per grid square. Add parallel setting to drawing configuration. (May add a similar toggle to regions in Terrain Mapper if this cannot be easily handled using active effects.) Closes #125.

## Bug fixes and other updates
Correct NaN distance when using hex grids. Closes #188.
Don't treat walls as blocking if the top elevation equals the token elevation. Closes #189.
Update Italian localization. Thanks @GregoryWarn!

# 0.10.5
Fix for `_fromPoint3d` not a function. Closes #186.

# 0.10.4
Compatibility with Terrain Mapper 0.4.1.
Update Polish translation. Thanks @Lioheart! Closes #184. Update Brazilian Portugese translation. Thanks @Kharmans!
Fix for terrain cost measuring in pixel units instead of grid units for gridless maps.
Fix pathfinding failing for users once the preview token stops moving. Closes #138.

# 0.10.3
Fix for the ruler label blowing up the font size on gridless and hex scenes.
Fix for gridless measuring in pixel units instead of grid units.

# 0.10.2

## New Features
Ruler history (faded ruler markings) is used to represent prior movement of a combatant in its combat turn. Arrow-key movement is added to the ruler history as well.

New setting to scale the ruler labels based on zoom. Thanks @Aedif for advice on this.

New setting to force strictly Euclidean measurement for diagonals. Foundry's "Exact" core "Square Grid Diagonals" setting actually measures diagonals in number of hexes or number of squares, which in some cases can vary (slightly) from Euclidean measurement.

New setting and `CONFIG` options to display the ruler labels using configurable styles. Thanks @Ichabod for the idea and layout suggestions! You can control the styles, icons, and scaling using `CONFIG.elevationruler.labeling`. Generally modifications to these should affect the next ruler movement; no reload required.

## Bug fixes and other updates
Reworked the measurement system to directly measure the 3d movement instead of projecting to a 2d plane. This matters a lot for hex movement, as projecting assumed a geometrically impossible 3d hex grid whereas now hex elevation movement assumes the 3d hex grid has stacked 2d hexes (square shapes in the z-direction). This means that the core "Square Grid Diagonals" setting is now used to modify how elevation diagonal movement is calculated for 3d hexes. Also now accounts for "double-diagonal" moves in 3d square grids in a more consistent manner. Reworked the movement penalty class to more closely mimic the cost function expected by Foundry ruler. Closes #163 and probably other measurement bugs. Creates unknown number of new measurement bugs!

Use the existing cost approach in Foundry ruler to measure difficult movement.

Fix for rounding happening even when "Rounding Distance to Multiple" is set to 0. Closes #173. Fix for Levels / Wall Height always dropping to ground. Closes issue #174. Thanks @Larkinabout for PRs on both!

Fix for GURPS modifying the Ruler waypoints without using the `Ruler#_addWaypoint` method. Closes #166. Submitted [PR #1959](https://github.com/crnormand/gurps/pull/1959).

Update Polish translation. Thanks @Lioheart! Closes #180. Update Brazilian Portugese translation. Thanks @Kharmans!

# 0.10.1

## New Features
Add toggle in settings to snap pathfinding to the grid when possible.
Add toggle in setting to combine prior movement with total movement in the same line. Thanks @Larkinabout!

## Bug fixes and other updates
Fix display of terrain region penalty measurement.
Update Polish, Italian, and Brazilian Portugese translations. Closes #171. Thanks @GregoryWarn, @Kharmans, and @Lioheart!
Fixes for the scene graph used for pathfinding. Address graph errors when the token overlaps walls. Address graph errors with overlapping walls.

# 0.10.0
Support Terrain Mapper v0.4.0 elevated regions and tiles.
Better support for difficult terrain using Terrain Mapper or drawings.
Now incrementing elevation at the end of the waypoint move, to better function with Terrain Mapper.
Rewrite and simplify the movement penalty calculation. Measure penalties through regions and drawings using 2d cutaway intersections through the 3d shape for a given 3d line segment.
Adjustments to how fly and burrow are handled.
Use `actor.system.currentmove` for GURPS so it accounts for encumbrance, etc. Closes #164.
Potential fix for token document lock (#145) thanks to @aburley1234!
Update lancer speed attribute for Lancer 2.0. Thanks @BoltsJ!

# 0.9.12
Correct counting of elevation diagonals. Closes #161.
Don't modify elevation based on movement type if autodetect movement is disabled. Closes #155.
Add basic GURPS token speed attributes. Closes #160.
Correct error re undefined `values.filter` method that occurred on some browsers that do not support most recent Javascript.
Update Polish, Italian, and Brazilian Portugese translations. Closes #153. Thanks @GregoryWarn, @Kharmans, and @Lioheart!
Fix for dragonbane token speed. Thanks @xdy!

# 0.9.11
Prevent the scene graph from adding 0-length edges. Closes #101.
Add check to ensure PIXI.Points are used in `CenteredRectangle#toCartesianCoords` to avoid error re rotate not being a function. Closes #108.
Update libGeometry to v0.3.5.
Remove the pathfinding toggle button if pathfinding is disabled. Closes #151.
Track diagonal moves when moving in combat so that 5-10-5 does not reset during multiple moves in a single turn. Closes #87.
Switch to using `canvas.visibility` instead of `canvas.effects.visibility`.

# 0.9.10
Fix for "log not defined" error on load. Closes #150.
Merge PR from @SyraLessThanThree to hide elevation display in ruler. Thanks!
Italian, Spanish, and Polish language updates. Thanks @GregoryWarn, @Kharmans, and @Lioheart!
Update readme re Das Schwarze Auge 5 (The Dark Eye 5) support. Thanks @Rapunzel77!
Addressed issues with the pathfinding scene graph not correctly updating on token movement. Switched to using token update instead of token refresh hook, which may improve performance during token animations. Added some internal consistency checks to the scene graph and the ability to rebuild the graph if errors are found. May address #137 and #101.
Patching and using the Ruler class now uses `CONFIG.Canvas.rulerClass`. Addresses issues with using the ruler in pf2e and possibly other systems that extend the Ruler class. Closes #147.

## New Features
Added pf2e token speed handling, from the archived PF2E Elevation Ruler module. Thanks @7H3LaughingMan! Closes #136.
Added toggle to disable pathfinding entirely. Closes #151.

# 0.9.9
Moved token movement history to a flag, which now takes advantage of the Foundry undo system so that when undoing token movement during combat, the token's movement history is reset accordingly.
Added a button in the Combat Tracker that GMs can use to reset the current combatant movement history during combat. Closes #89.

Fix for ruler display ghosting on other users' displays. Closes #124, #134.
Fix for elevation changing too much when using hotkeys. Closes #126.

# 0.9.8
Fix for `FLAGS` not defined error.
Round prior movement label.

# 0.9.7
Added Italian translation. Thanks @GregoryWarn!
Added TheWitcherTRPG integration. Thanks @pedroaugustobt!
Updates to Brazilian Portugese and Italian translations.
Add support for Warhammer 4e run speed calculation. Closes #113.

Fix for calculating distance on a hex grid. Thanks @InjustFr!
Address error blocking the ruler from working when Terrain Mapper module was not present. Closes #120, #115.
Address elevation calculation not accounting for user elevation changes. Closes #119.
Address elevation calculation for standard ruler not accounting for token elevation when hovering over a token. Closes #118.


# 0.9.6
Added `CONFIG.elevationruler.tokenPathfindingBuffer`. This defaults to -1, allowing movement diagonally when at the corner of a large token and "Tokens Block" is set. For pathfinding, more negative numbers shrink the token border; positive numbers increase it. Note that if you change this, you will need to reload the scene or at least move the tokens before their pathfinding borders will be changed. Closes #88.
Move calculation of speed colors to `Ruler#_highlightMeasurementSegment`. As a result, Ruler segments are not split at movement speed category changes, so there are no longer extra waypoints added.
Remove settings related to determining when a terrain affects a token. Currently, Foundry regions only checks the center point.
For dnd5e, remove the Token HUD control to select movement, because dnd5e now uses status effects to signify when tokens are flying or burrowing. Added a setting to automatically determine token movement for dnd5e.
Updated Polish translation. Thanks @Lioheart! Closes #105.
Added `SCENE.BACKGROUND` to flags (imported from Terrain Mapper). Closes #107.
Don't broadcast the Token Ruler if the token being dragged is secret, invisible, or hidden. Closes #112.
Consolidate speed attributes to a single file.
Add ARS speed definitions. Closes #111.
Add sfrpg speed definitions.
Add a5e speed definitions.

# 0.9.5
Added Brazilian translation. Thanks @Kharmans!
Added Russian translation. Thanks @VirusNik21! Closes #96.
Added Polish translation. Thanks @Lioheart! Closes #94.
Added setting to hide the GM ruler. Thanks @Mystler! Closes #86.

Fix snapping of small tokens when using Token Ruler. Closes #70, #95.
Fix error re invalid elevation when adjusting elevation with the ruler. Closes #84, #92.
Add separate add/remove waypoint keybindings for regular ruler vs token ruler. Handle right-clicking to add a waypoint (hold control to remove). Closes #99, #80
Fix compatibility with Terrain Mapper. Refactor how elevation changes work. Now incrementing/decrementing elevation changes the elevation from the last waypoint. Allows tokens to maneuver over/under regions. Closes #100. Requires Terrain Mapper v0.3.2.

# 0.9.4
Remove custom unsnap code now that v12's `Ruler` allows unsnapping properly.
Fix for displaying colors to other users (from v0.8.13).
Fix definitions of the add/remove waypoint key modifiers.
Improve placement of tokens when dragging with the Token Ruler.
Fix for tracking arrow-key movement of tokens for combat history. Issue #74.
Set pathfinding to default to "on." Issue #73.
Fix error when broadcasting ruler elevation changes.
Round elevation to nearest multiple.

## New Features
Add setting for hiding speed highlighting for hostiles (from v0.8.13).
Add setting for using speed highlighting only during combat (from v0.8.13).

# 0.9.3
Fix for speed color error.

# 0.9.2
Fix pathfinding.
Change the keybind for teleport to "F" (fast-forward) to avoid collision with arrow-key usage on the canvas. Switch to requiring "F" to be held when the user triggers the move to get teleport, to avoid weirdness with the drag still being active when using a separate trigger key.
Catch error if waypoint is not added in `_addWaypoint`.
Correct error when sending ruler data from one user to another.
Move Maximum speed category to `CONFIG.elevationruler.SPEED.CATEGORIES`. Should now be possible to define specific colors per user in the CONFIG, so long as category names are same.

# 0.9.1
Fix errors when using the ruler on gridless scenes.
Correct speed highlighting on gridless scenes.

## New features
Add a configuration option (`CONFIG.elevationruler.gridlessHighlightWidthMultiplier`) to adjust the width of the gridless highlight.

Add a "teleport" keybind and associated `Ruler.prototype.method`. If a ruler is active, this will set all segments to "teleport" and will jump to any user-set waypoints and then the destination, very quickly.

# 0.9.0
Initial support for Foundry v12.

## KNOWN ISSUES
Pathfinding does not work. Error at startup `canvas.walls.outerBounds is not iterable` is related to pathfinding but can be otherwise ignored.

# 0.8.13
Add support from dragonbane and twodsix systems from v12 branch.
Update speed category handling to match v12 branch.
Fix for speed colors not properly displaying between users.
Change setting for using speed highlighting to allow it to display only during combat.

# 0.8.12
Fix for speed highlighting not working if the Token HUD has not been used. Closes #65.

# 0.8.11

## New features
Add a keybinding ("g") to force the ruler to measure from ground terrain. Replaces "Prefer Token Elevation," which was removed. Closes #63, #64.

## Bug fixes
Catch when a segment color is not defined, to avoid throwing an error.
Fix for incorrect combat speed movement highlighting after the first move. Closes #62.

# 0.8.10
## New features
Add indicator of past combat movement in the ruler.
Allow for unlimited number of speed categories, colors, along with custom speed functions in the CONFIG. Closes issue #58.
More aggressive path straightening using a reverse Ramer-Douglas-Peucker algorithm based on collision checking. Closes issue #48.
Add CONFIG settings to ignore tokens for pathfinding based on HP attribute or set of token statuses. Closes issue #55.
Add a keybind ("p") to temporarily toggle pathfinding.
Add `rulerSegmentOrigin` and `rulerSegmentDestination` to options passed to token update.

## Bug fixes
Refactor physical and move distance measurement in anticipation of Foundry v12. Closes issue #59 (measurement near waypoints).
Refactor how segments are split for purposes of speed highlighting.
Fix for counting alternating diagonals across ruler segments/waypoints.
Fix for token stopping prematurely if the mouse is released after space bar pressed when using the Ruler.
Fix for "drunken token movement" in which a token would wander off the path when moving through several fake waypoints that were not centered on the grid.
Allow large tokens to move through triangle edge unless both vertices of the edge shares a blocking edge. This allows pathfinding to work for large tokens in more situations, while still not taking paths through narrow spaces constrained on both sides by walls.

## BREAKING
Options for `CONFIG.elevationruler.SPEED` have changed. To change the speed highlighting, you will need to change the array of speed categories in `CONFIG.elevationruler.SPEED.CATEGORIES`. A speed category is defined as:
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

For more complex options, you can now replace two functions that control token speed measurements. You may also want to add additional properties to the `SpeedCategory` for your use case.
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

