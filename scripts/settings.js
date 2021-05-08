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

}
