# FBL Stronghold

A personal homebrew module for the **Forbidden Lands** system on **Foundry VTT v13**. It layers custom mechanics on top of the core system without modifying system files — armour and rest tweaks, plus a full implementation of the *Reforged Power* **Alternative Weather** and **Heat** rules.

- **Module ID:** `fbl-stronghold`
- **Foundry compatibility:** v13 (verified)
- **Game system:** Forbidden Lands (v13.x)

---

## Requirements

- Foundry VTT v13+
- Forbidden Lands system installed and active
- **For the weather system only:** a Simple Calendar API provider must be active — either **Simple Calendar Reborn**, or **Seasons & Stars** together with the **Simple Calendar Compatibility Bridge**. Without one, the weather prompt won't fire automatically on a date change (the manual roll still works).

The module degrades gracefully: the armour and rest features work with no calendar present.

---

## Installation

Install via manifest URL in Foundry's **Add-on Modules → Install Module**:

```
https://github.com/Hamm3r96/fbl-stronghold/releases/latest/download/module.json
```

Then enable **FBL Stronghold** in your world's **Manage Modules**.

> On The Forge, deploy by publishing a GitHub Release with a zip whose files sit at the zip root (not nested), and point the manifest's `download` at the release asset. Branch (`/archive/`) zips are unreliable there.

---

## Features

### Armour & character sheet (`overrides.js`)

- **Armor Value field** added to armour item sheets, stored as a module flag.
- **"Rating" relabelled to "Integrity"** on armour sheets.
- **Custom armour roll** on the combat tab: rolls the summed Armor Value of equipped non-shield armour as base dice, plus a skill of your choice (Endurance, Move, or Armor Only). Pushable, with no automatic bane/degradation side effects.
- **Rest button** restores only **+1 to each damaged attribute** (Strength, Agility, Wits, Empathy) and announces in chat what was regained.
- **Character generator button** hidden for non-GM users.

### Alternative Weather (`weather.js`)

Implements the *Reforged Power* weather system (Players Booklet pp. 78–80).

- **Daily weather prompt.** On each new day — and after a quarter-day while Strong Winds are active — the GM is prompted to roll `1d6 + accumulated rain-risk` on the weather table. Driven by the Simple Calendar API, with Foundry's core `updateWorldTime` as a fallback. Only the primary GM is prompted.
- **Terrain prompt.** At each roll the GM picks the current hex type. This drives both the rain chance and the Mountains −1 temperature modifier.
- **Stacking rain-risk.** A "Risk of rain/snow" result adds +1 to future weather rolls and accumulates until precipitation actually occurs, then resets.
- **Auto-rolled precipitation.** Whether a risk result becomes actual rain/snow is rolled against a terrain-based percentage chance (see below), not asked.
- **Automatic season.** The season modifier is detected from the calendar's season/month name (e.g. *Summerrise* / *Summerwane* → Summer), with a manual fallback.
- **GM weather card.** Each roll posts a GM-whispered chat card showing the result, temperature (with °C/°F), active modifiers, fog, precipitation, and accumulated rain-risk.

### Heat (`weather.js`)

- **Per-character Heat readout** shown as a compact line in the Gear tab's encumbrance toolbar, reflecting the current environmental temperature and the matching Heat Effect (full effect text on hover).
- **Heat Check dialog** with per-roll toggles: Soaked (−2), Bare minimum (−1), Campfire (+2), and Tent (shelter).
- **Show Effect** posts a chat card listing the reasons behind the result (season, terrain, weather, conditions).
- **Roll Endurance** performs a standard Strength + Endurance roll — so worn items' own Endurance modifiers apply automatically — with a single "Temperature & conditions" modifier added for the environmental temp and the toggles.

#### Terrain rain chances

Chance that a "Risk of rain/snow" result becomes actual precipitation, by hex type:

| Terrain | Chance | | Terrain | Chance |
|---|---|---|---|---|
| Mountains (−1 temp) | 90% | | Forest | 60% |
| Coast / Sea | 85% | | Hills | 55% |
| Marshlands | 80% | | Plains | 45% |
| Quagmire | 80% | | Ruins | 45% |
| Lakes | 75% | | Desert | 5% |
| Rivers | 75% | | Dark Forest | 70% |

These values live in the `TERRAIN_CHANCE` map at the top of `weather.js` and can be tuned freely.

---

## Settings

Found under **Configure Settings → Module Settings → FBL Stronghold**:

- **Auto-detect season from calendar** — read the season from the calendar (default on).
- **Season (manual fallback)** — used when auto-detect is off or the calendar exposes no season name.
- **Default terrain (hex type)** — pre-selected in the weather-roll prompt.
- **Temperature unit** — Celsius or Fahrenheit.
- **Prompt to roll on a new day** — toggle the automatic prompt.

---

## Usage

### Manual weather roll

Create a Script macro with:

```js
game.fblStronghold.rollWeather();
```

To clear accumulated weather state (rain-risk, last result, etc.):

```js
game.fblStronghold.resetWeather();
```

### Heat

Open a character's **Gear** tab and use the **Heat / Check** readout next to the encumbrance counter to open the Heat Check dialog, tick the relevant conditions, and either show the effect or roll Endurance vs cold.

---

## Design notes & interpretations

Where the rules are underspecified, the module makes explicit, tunable choices (all marked in code comments):

- **Base temperature = 0**; temperature is season + terrain (Mountains −1) + weather effects. °C ≈ temp × 10 (±5); °F ≈ temp × 20 + 30 (±10).
- **Quarter-day = hour ÷ 6**, assuming a 24-hour calendar day.
- **Rain-risk resets** to zero once precipitation actually occurs.
- **Heat is environmental only.** Worn gear contributes via its own Endurance modifiers on the roll, not via the Heat number, to avoid double-counting.
- **Tent** provides shelter only and contributes 0 to Heat by default.
- **Rain vs snow** is decided by the sign of the environmental temperature.

---

## Known limitations

- Display-and-advise, not full automation: the module surfaces weather, temperature, and the Heat Effect, but does not auto-enforce the periodic cold/resource rolls — the GM adjudicates.
- The Heat readout finds the encumbrance row by its `current / max` text; if a future system update splits that across elements, the readout falls back to the top of the Gear tab (logged to console).
- The weather hook relies on the Simple Calendar API surface; a calendar fork that renames the API/hook may require a small adjustment.

---

## Credits & disclaimer

Weather and Heat mechanics are based on the **Alternative Weather** rules from the *Reforged Power* supplement for Forbidden Lands. This is an unofficial, personal homebrew module and is not affiliated with or endorsed by Free League Publishing. You must own the relevant rules to use this content at your table.

Author: **Hamm3r96**
