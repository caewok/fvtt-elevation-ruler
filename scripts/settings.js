import { MODULE_ID } from "./module.js";

export function getSetting(settingName) {
  return game.settings.get(MODULE_ID, settingName);
}


export function registerSettings() {
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
  
  game.settings.registerMenu(MODULE_ID, {
	  name: 'Elevation Ruler Hotkeys'
	  type: Hotkeys.createConfig('Elevation Ruler Hotkeys', [`${MODULE_ID}.change-elevation-group`]),
	});

}

export function registerHotkeys() {
  // You must register the group before adding hotkeys to it
	hotkeys.registerGroup({
		name: `${MODULE_ID}.change-elevation-group`, // <- Must be unique
		label: 'Elevation Ruler Change Elevation Keys',
		description: 'Keys to increment and decrement elevation while using the ruler.' // <-- Optional
	});

  hotkeys.registerShortcut({
		name: `${MODULE_ID}.increment-elevation-hotkey`, // <- Must be unique
		label: 'Increment Elevation for Ruler',
		group: `${MODULE_ID}.change-elevation-group`,
		get: () => game.settings.get(MODULE_ID, 'increment-elevation-hotkey'),
		set: async value => await game.settings.set(MODULE_ID, 'increment-elevation-hotkey', value),
		default: () => { return { key: hotkeys.keys.KeyQ, alt: false, ctrl: false, shift: false }; },
		onKeyDown: self => { console.log('You hit my custom increment-elevation-hotkey!') },
	}); 

  hotkeys.registerShortcut({
		name: `${MODULE_ID}.decrement-elevation-hotkey`, // <- Must be unique
		label: 'Increment Elevation for Ruler',
		group: `${MODULE_ID}.change-elevation-group`,
		get: () => game.settings.get(MODULE_ID, 'decrement-elevation-hotkey'),
		set: async value => await game.settings.set(MODULE_ID, 'decrement-elevation-hotkey', value),
		default: () => { return { key: hotkeys.keys.KeyQ, alt: false, ctrl: false, shift: false }; },
		onKeyDown: self => { console.log('You hit my custom decrement-elevation-hotkey!') },
	}); 

}
