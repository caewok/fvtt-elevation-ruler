import { MODULE_ID, log } from "./module.js";

export function getSetting(settingName) {
  return game.settings.get(MODULE_ID, settingName);
}


export function registerSettings() {
  log("Registering measurement setting.");
  game.settings.register(MODULE_ID, 'measurement-method', {
    name: 'Measurement method',
    hint: 
`Change in elevation plus change horizontally is always considered diagonal movement. 
| CityBlock: Add full vertical distance to the full horizontal distance moved. 
| 5/10/5: Count every second unit of vertical movement as double.
| Euclidean: Add exact mathematical distance of the diagonal move, rounded.
`,
    scope: 'world',
    config: true,
    type: String,
    choices: {
      'CityBlock': 'City Block',
      'DnDAlt': '5/10/5 (Dnd5e alternative)',
      'Euclidean': 'Euclidean'
    },
    default: 'CityBlock',
  });
 
  log("Registering hotkey menu.");
  game.settings.registerMenu(MODULE_ID, {
	  name: 'Elevation Ruler Hotkeys',
	  type: Hotkeys.createConfig('Elevation Ruler Hotkeys', [`${MODULE_ID}.change-elevation-group`]),
	});

  log("Done registering settings.");

}

export function registerHotkeys() {
  // You must register the group before adding hotkeys to it
  log("Registering hotkeys group.");
	Hotkeys.registerGroup({
		name: `${MODULE_ID}.change-elevation-group`, // <- Must be unique
		label: 'Elevation Ruler',
		description: 'Keys to increase and decrease elevation while using the ruler.' // <-- Optional
	});

  log("Registering increment elevation hotkey.");
  Hotkeys.registerShortcut({
		name: `${MODULE_ID}.increment-elevation-hotkey`, // <- Must be unique
		label: 'Increment',
                repeat: true, // Let the user hold down the key to increase repeatedly.
		group: `${MODULE_ID}.change-elevation-group`,
//		get: () => game.settings.get(MODULE_ID, `increment-elevation-hotkey`),
//		set: async value => await game.settings.set(MODULE_ID, `increment-elevation-hotkey`, "ArrowUp"),
		default: () => { return { key: Hotkeys.keys.BracketLeft, alt: false, ctrl: false, shift: false }; },
		onKeyDown: self => { console.log('You hit my custom increment-elevation-hotkey!') },
	}); 
  
  log("Registering decrement elevation hotkey.");
  Hotkeys.registerShortcut({
		name: `${MODULE_ID}.decrement-elevation-hotkey`, // <- Must be unique
		label: 'Decrement',
                repeat: true,
		group: `${MODULE_ID}.change-elevation-group`,
//		get: () => game.settings.get(MODULE_ID, `${MODULE_ID}.decrement-elevation-hotkey`),
//		set: async value => await game.settings.set(MODULE_ID, `${MODULE_ID}.decrement-elevation-hotkey`, "ArrowDown"),
		default: () => { return { key: Hotkeys.keys.BracketRight, alt: false, ctrl: false, shift: false }; },
		onKeyDown: self => { console.log('You hit my custom decrement-elevation-hotkey!') },
	}); 

}
