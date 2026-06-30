// ============================================================
// FBL Stronghold — weather.js
// Reforged Power "Alternative Weather" + Heat system
// ============================================================
// FEATURES
//  1. On each new day (and quarter-day if Strong Winds is active),
//     prompts the GM to roll d6 + accumulated rain-risk on the
//     weather table. Resolves stacking effects, computes Temp,
//     and posts a GM chat card with the result, °C/°F, and the
//     active modifiers.
//  2. Adds a "Heat Modifier" field to gear/armor item sheets
//     (stored as a flag, like Armor Value).
//  3. Injects a per-character Heat line on the FBL character sheet
//     showing Temp + summed gear heat and the matching Heat Effect.
//     A "Check" button opens a dialog with per-roll checkboxes
//     (Soaked / Campfire / Standing guard) and an optional
//     Endurance-vs-cold roll.
//
// DEPENDENCIES
//  - A Simple Calendar API provider must be ACTIVE: either Simple
//    Calendar itself, OR Seasons & Stars + the Simple Calendar
//    Compatibility Bridge. Without one, the date-change hook never
//    fires and weather will not auto-prompt (the manual API still
//    works: game.fblStronghold.rollWeather()).
//
// INTERPRETATION CHOICES (RAW is underspecified — change freely):
//  - Base Temp = 0; Temp = base + season + (mountain −1) + clouds-on-sun.
//  - Quarter-day = floor(hour / 6); assumes a 24h SC day.
//  - rainRisk accumulates on each 6+, and RESETS to 0 once actual
//    precipitation occurs (search "INTERPRETATION: rainRisk reset").
//  - Heat = Temp + SUM of every item's heat flag (no tier logic,
//    no equip filter — per design choice). Optional filter marked
//    "INTERPRETATION: gear filter".
// ============================================================

// !!! MUST match your module.json "id". Change here if different. !!!
const MODULE_ID = 'fbl-stronghold';

const SETTINGS = {
  STATE: 'weatherState',
  SEASON: 'season',
  SEASON_AUTO: 'seasonAuto',
  TERRAIN: 'terrain',
  UNIT: 'tempUnit',
  AUTO: 'autoPrompt',
  HEAT_ITEMS: 'heatItems',
};

const SEASON_TEMP = { summer: 2, springfall: 1, winter: 0 };
const SEASON_LABEL = { summer: 'Summer', springfall: 'Spring/Fall', winter: 'Winter' };

// Chance (%) that a "Risk of rain/snow" result becomes ACTUAL precipitation,
// by hex/terrain type. Grounded in real-world patterns: orographic lift makes
// mountains very wet, maritime air keeps coasts wet, standing water and
// wetlands stay humid, open plains are middling, deserts almost never.
const TERRAIN_CHANCE = {
  mountains: 70,   // orographic lift forces moist air up → frequent precip
  coast: 85,       // maritime air, onshore moisture
  marshlands: 80,  // saturated ground, high local humidity
  quagmire: 80,
  lakes: 60,       // large water body, lake-effect moisture
  darkforest: 70,  // dense canopy, damp microclimate
  forest: 50,
  hills: 55,       // mild orographic effect
  plains: 40,      // open, average exposure
  ruins: 40,       // treat as the surrounding open ground
  desert: 5,       // arid; rain is rare even under "risk"
};
const TERRAIN_TEMP = { mountains: -1 }; // RAW: Mountains −1 Temp (others 0)
const WEATHER_LABEL = { sun: 'Sun / Moon / Stars', clouds: 'Cloudy', wind: 'Strong Winds', risk: 'Risk of Rain / Snow' };
const TERRAIN_LABEL = {
  mountains: 'Mountains (70%, −1 temp)',
  coast: 'Coast / Sea (85%)',
  marshlands: 'Marshlands (80%)',
  quagmire: 'Quagmire (80%)',
  lakes: 'Lakes (60%)',
  darkforest: 'Dark Forest (70%)',
  forest: 'Forest (50%)',
  hills: 'Hills (55%)',
  plains: 'Plains (40%)',
  ruins: 'Ruins (40%)',
  desert: 'Desert (5%)',
};

const DEFAULT_STATE = {
  rainRisk: 0,        // accumulated +N to the weather die (from 6+ results)
  lastResult: null,   // 'sun' | 'clouds' | 'wind' | 'risk'
  precip: null,       // 'rain' | 'snow' | null (today's actual precipitation)
  fog: false,
  temp: 0,
  terrain: 'plains',  // current hex; chosen by the GM at each weather roll
  windActive: false,  // Strong Winds → a quarter-day re-roll is pending
  lastDayKey: null,
  lastQuarter: null,
  lastSummary: null,  // previous roll's { label, notes, precip, fog } for carryover
};

// ----------------------------------------------------------
// Settings registration
// ----------------------------------------------------------
Hooks.once('init', () => {
  game.settings.register(MODULE_ID, SETTINGS.STATE, {
    scope: 'world', config: false, type: Object,
    default: foundry.utils.deepClone(DEFAULT_STATE),
  });

  game.settings.register(MODULE_ID, SETTINGS.SEASON_AUTO, {
    name: 'Weather: Auto-detect season from calendar',
    hint: 'Reads the current month/season name from Simple Calendar (e.g. Summerrise → Summer). Falls back to the manual season below if no calendar info is found.',
    scope: 'world', config: true, type: Boolean, default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.SEASON, {
    name: 'Weather: Season (manual fallback)',
    hint: 'Used only when auto-detect is off or the calendar exposes no season/month name.',
    scope: 'world', config: true, type: String, default: 'springfall',
    choices: { summer: 'Summer (+2)', springfall: 'Spring / Fall (+1)', winter: 'Winter (±0)' },
  });

  game.settings.register(MODULE_ID, SETTINGS.TERRAIN, {
    name: 'Weather: Default terrain (hex type)',
    hint: 'The hex pre-selected in the weather-roll prompt. The GM confirms/changes it each roll.',
    scope: 'world', config: true, type: String, default: 'plains',
    choices: TERRAIN_LABEL,
  });

  game.settings.register(MODULE_ID, SETTINGS.UNIT, {
    name: 'Weather: Temperature unit',
    scope: 'world', config: true, type: String, default: 'C',
    choices: { C: 'Celsius', F: 'Fahrenheit' },
  });

  game.settings.register(MODULE_ID, SETTINGS.AUTO, {
    name: 'Weather: Prompt to roll on a new day',
    hint: 'If off, roll manually with the macro: game.fblStronghold.rollWeather()',
    scope: 'world', config: true, type: Boolean, default: true,
  });

  game.settings.register(MODULE_ID, SETTINGS.HEAT_ITEMS, {
    name: 'Heat: Item list',
    hint: 'Comma-separated list of item names that grant heat (½ their vs-cold bonus). Use "Name:value"; the value defaults to 1 if omitted. Matched by exact name (case-insensitive). Example: Great Fur:1, Winter Cloak:1, Sleeping Fur:1',
    scope: 'world', config: true, type: String,
    default: 'Great Fur:1, Winter Cloak:1, Sleeping Fur:1',
  });
});

// ----------------------------------------------------------
// Public API
// ----------------------------------------------------------
Hooks.once('ready', () => {
  game.fblStronghold = game.fblStronghold || {};
  game.fblStronghold.rollWeather = (reason = 'Roll weather') => promptWeatherRoll(reason);
  game.fblStronghold.resetWeather = () =>
    game.settings.set(MODULE_ID, SETTINGS.STATE, foundry.utils.deepClone(DEFAULT_STATE));
});

// ----------------------------------------------------------
// State helpers
// ----------------------------------------------------------
function getState() {
  const stored = game.settings.get(MODULE_ID, SETTINGS.STATE) || {};
  return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_STATE), stored, { inplace: false });
}
async function setState(s) {
  await game.settings.set(MODULE_ID, SETTINGS.STATE, s);
}

// ----------------------------------------------------------
// Simple Calendar date helper
// (works against real SC or the Seasons & Stars compat bridge)
// ----------------------------------------------------------
function getSCDate() {
  if (typeof SimpleCalendar === 'undefined' || !SimpleCalendar.api) return null;
  try {
    const dt = SimpleCalendar.api.currentDateTime(); // { year, month, day, hour, minute, seconds }
    if (!dt) return null;
    return {
      dayKey: `${dt.year}.${dt.month}.${dt.day}`,
      quarter: Math.floor((dt.hour ?? 0) / 6), // 0 Morning, 1 Daytime, 2 Evening, 3 Night
    };
  } catch (e) {
    console.warn(`${MODULE_ID} | Could not read Simple Calendar date`, e);
    return null;
  }
}

// Full SC date object (includes monthName + currentSeason when available).
function getSCDateFull() {
  if (typeof SimpleCalendar === 'undefined' || !SimpleCalendar.api) return null;
  try {
    return SimpleCalendar.api.timestampToDate(SimpleCalendar.api.timestamp());
  } catch (e) {
    return null;
  }
}

// Detect the season key by keyword-matching the calendar's season or month
// name. e.g. "Summerrise"/"Summerwane" → summer; "Springwane" → springfall.
function detectSeason() {
  const d = getSCDateFull();
  if (!d) return null;
  const candidates = [d.currentSeason?.name, d.display?.monthName, d.monthName];
  for (const c of candidates) {
    if (!c) continue;
    const n = String(c).toLowerCase();
    if (n.includes('summer')) return 'summer';
    if (n.includes('winter')) return 'winter';
    if (n.includes('spring') || n.includes('fall') || n.includes('autumn')) return 'springfall';
  }
  return null;
}

// Auto-detected season if enabled & available, else the manual fallback.
function currentSeasonKey() {
  if (game.settings.get(MODULE_ID, SETTINGS.SEASON_AUTO)) {
    const s = detectSeason();
    if (s) return s;
  }
  return game.settings.get(MODULE_ID, SETTINGS.SEASON);
}

// ----------------------------------------------------------
// Date-change → prompt (primary GM only)
// ----------------------------------------------------------
function checkWeatherTrigger() {
  if (game.users.activeGM !== game.user) return;
  if (!game.settings.get(MODULE_ID, SETTINGS.AUTO)) return;

  const now = getSCDate();
  if (!now) return;
  const state = getState();

  const newDay = state.lastDayKey !== now.dayKey;
  const windReroll = state.windActive && state.lastQuarter !== now.quarter;

  if (newDay) {
    promptWeatherRoll('A new day dawns', now);
  } else if (windReroll) {
    promptWeatherRoll('Strong winds — the weather shifts (quarter-day re-roll)', now);
  }
}

// Primary: Simple Calendar / Simple Calendar Reborn / compat-bridge hook.
Hooks.on('simple-calendar-date-time-change', () => checkWeatherTrigger());
// Fallback: Foundry's core world-time hook, in case the fork renames the SC
// hook. The day/quarter stamp + the busy-lock make double-firing harmless.
Hooks.on('updateWorldTime', () => checkWeatherTrigger());

// ----------------------------------------------------------
// Prompt → roll
// ----------------------------------------------------------
let _weatherBusy = false;
async function promptWeatherRoll(reason = 'Roll weather', now = getSCDate()) {
  if (_weatherBusy) return; // prevent the two hooks from double-prompting
  _weatherBusy = true;
  try {
    const state = getState();
    // Stamp immediately so we don't re-prompt for the same day/quarter.
    if (now) { state.lastDayKey = now.dayKey; state.lastQuarter = now.quarter; }
    await setState(state);

    // Terrain dropdown, pre-selected to last hex (or the default setting).
    const curTerrain = state.terrain || game.settings.get(MODULE_ID, SETTINGS.TERRAIN) || 'plains';
    const terrainOptions = Object.entries(TERRAIN_LABEL)
      .map(([k, label]) => `<option value="${k}" ${k === curTerrain ? 'selected' : ''}>${label}</option>`)
      .join('');

    const chosenTerrain = await new Promise((resolve) => {
      new Dialog({
        title: 'Reforged Weather',
        content: `
          <p>${reason}.</p>
          <p>Roll for the weather? <em>(1d6 + ${state.rainRisk} accumulated rain-risk)</em></p>
          <div class="form-group">
            <label>Current terrain (hex)</label>
            <div class="form-fields"><select name="terrain">${terrainOptions}</select></div>
          </div>`,
        buttons: {
          roll: { icon: '<i class="fas fa-dice-d6"></i>', label: 'Roll Weather', callback: (h) => resolve(h.find('[name="terrain"]').val()) },
          skip: { icon: '<i class="fas fa-forward"></i>', label: 'Skip', callback: () => resolve(null) },
        },
        default: 'roll',
        close: () => resolve(null),
      }).render(true);
    });

    if (chosenTerrain) {
      const s2 = getState();
      s2.terrain = chosenTerrain;
      await setState(s2);
      await resolveWeather();
    }
  } finally {
    _weatherBusy = false;
  }
}

// ----------------------------------------------------------
// Resolve the weather roll & update state
// ----------------------------------------------------------
async function resolveWeather() {
  const state = getState();
  const roll = await new Roll('1d6').evaluate();
  const die = roll.total;
  const effective = die + (state.rainRisk || 0);
  const prev = state.lastResult;
  const prevPrecip = state.precip; // did it actually rain/snow on the last roll?
  const carry = state.lastSummary; // yesterday's result, still in effect today

  const notes = [];
  state.fog = false;
  state.precip = null;
  state.windActive = false; // cleared each roll; re-set below if winds occur

  let result;
  if (effective <= 3) {
    result = 'sun';
    notes.push('+1 to Lead the Way, +1 to Hiking in Darkness.');
    // Morning fog only after ACTUAL precipitation. Display is handled by the
    // fog line in the card, so no separate note here (avoids duplication).
    if (prevPrecip) state.fog = true;
  } else if (effective === 4) {
    result = 'clouds';
  } else if (effective === 5) {
    result = 'wind';
    state.windActive = true;
    notes.push('Strong winds: −1 to Make Camp; weather re-rolls after a Quarter-Day.');
    notes.push('At sea: −1 Lead the Way, +1 speed under sail. Rolling Strong Winds twice at sea → capsize on a mishap.');
  } else { // 6+
    result = 'risk';
    state.rainRisk = (state.rainRisk || 0) + 1;
    // Note is added after the precipitation check below (single line).
  }
  state.lastResult = result;

  // ---- Temp ----
  let temp = SEASON_TEMP[currentSeasonKey()] ?? 0;
  temp += TERRAIN_TEMP[state.terrain] ?? 0;
  if (result === 'clouds' && prev === 'sun') { temp += 1; notes.push('Clouds following Sun: +1 Temp.'); }
  state.temp = temp;

  await setState(state);

  // ---- Did it actually rain/snow? (terrain-based chance, auto-rolled) ----
  // One consolidated note for the check; the precip effects appear once via
  // the rain/snow line in the card (no duplication).
  if (result === 'risk') {
    const p = await resolvePrecip(temp);
    notes.push(
      p.rains
        ? `Risk of ${temp > 0 ? 'rain' : 'snow'} — check ${p.rolled} vs ${p.chance}% (${p.terrain}): it ${temp > 0 ? 'rains' : 'snows'}.`
        : `Risk of rain/snow — check ${p.rolled} vs ${p.chance}% (${p.terrain}): stays dry.`
    );
  }

  // Save this roll's summary so the NEXT roll can show it as "still in effect".
  const fresh = getState(); // precip may have been updated by resolvePrecip
  const summary = { label: WEATHER_LABEL[result], notes: [...notes], precip: fresh.precip, fog: fresh.fog };
  fresh.lastSummary = summary;
  await setState(fresh);

  await postWeatherCard(die, effective, result, temp, notes, carry);
}

async function resolvePrecip(temp) {
  const state0 = getState();
  const terrain = state0.terrain || 'plains';
  const chance = TERRAIN_CHANCE[terrain] ?? 45;
  const roll = await new Roll('1d100').evaluate();
  const rains = roll.total <= chance;

  const state = getState();
  if (rains) {
    // RAW keys rain vs snow on HEAT; at the environmental level we use Temp sign.
    state.precip = temp > 0 ? 'rain' : 'snow';
    state.rainRisk = 0; // INTERPRETATION: rainRisk reset — pressure releases once it precipitates.
  }
  // If it stays dry, rainRisk carries forward (+1 already applied), so the
  // next roll is harder to avoid — this is the stacking the rules describe.
  await setState(state);
  return { terrain, chance, rolled: roll.total, rains };
}

// ----------------------------------------------------------
// Degree conversion & Heat Effect lookup
// ----------------------------------------------------------
function degrees(temp) {
  const unit = game.settings.get(MODULE_ID, SETTINGS.UNIT);
  if (unit === 'F') return `${temp * 20 + 30}°F (±10)`;
  return `${temp * 10}°C (±5)`;
}

function heatEffect(h) {
  if (h >= 4) return 'Roll an extra water & hygiene die every Quarter-Day. No water → THIRSTY & SLEEPLESS. Bare ground won’t make you COLD.';
  if (h === 3) return 'Roll an extra water & hygiene die per day. Bare ground won’t make you COLD.';
  if (h === 2) return 'Bare ground won’t make you COLD.';
  if (h === 1) return 'Roll ENDURANCE each night or become COLD (unless you have a fire).';
  if (h === 0) return 'Roll ENDURANCE every Quarter-Day or become COLD.';
  if (h === -1) return 'Roll ENDURANCE every hour or become COLD.';
  return 'Roll ENDURANCE every 15 minutes or become COLD.'; // h <= -2
}

// ----------------------------------------------------------
// GM weather chat card
// ----------------------------------------------------------
// Renders the precip line, fog line, and notes for a result summary.
function effectsBlockHTML({ precip, fog, notes } = {}) {
  let precipLine = '';
  if (precip === 'rain') {
    precipLine = '<p style="margin:2px 0;">🌧️ <strong>Rain</strong> — −1 Make Camp, +1 Forage Water. −1 heat if heat is positive (does not stack). Moisture-sensitive items exposed 15+ min risk item-dice damage.</p>';
  } else if (precip === 'snow') {
    precipLine = '<p style="margin:2px 0;">❄️ <strong>Snowfall</strong> — −1 to Lead the Way and Forced March.</p>';
  }
  const fogLine = fog ? '<p style="margin:2px 0;">🌫️ <strong>Fog</strong> (first light quarter-day) — −2 to Lead the Way.</p>' : '';
  const notesList = notes?.length ? `<ul style="margin:6px 0; padding-left:18px;">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : '';
  return precipLine + fogLine + notesList;
}

async function postWeatherCard(die, effective, result, temp, notes, carry) {
  const state = getState();
  const eff = effective !== die ? ` (+${effective - die} risk → ${effective})` : '';

  const todayBlock = effectsBlockHTML({ precip: state.precip, fog: state.fog, notes });

  // "Still in effect from yesterday" — the previous roll lingers a second day.
  let carryBlock = '';
  if (carry && carry.label) {
    const inner = effectsBlockHTML(carry);
    carryBlock = `
      <hr style="margin:8px 0; opacity:.4;">
      <p style="margin:2px 0; font-size:12px; opacity:.85;"><strong>Still in effect from yesterday — ${carry.label}:</strong></p>
      ${inner || '<p style="margin:2px 0; font-size:12px; opacity:.7;">No lingering modifiers.</p>'}`;
  }

  const content = `
    <div style="border:1px solid var(--color-border-dark, #555); border-radius:6px; padding:8px;">
      <h3 style="margin:0 0 4px;">${WEATHER_LABEL[result]}</h3>
      <p style="margin:2px 0;"><strong>Die:</strong> ${die}${eff} &nbsp;·&nbsp; <strong>Temp:</strong> ${temp} (${degrees(temp)})</p>
      ${todayBlock}
      ${carryBlock}
      <p style="font-size:11px; opacity:.7; margin:6px 0 0;">Accumulated rain-risk: +${state.rainRisk}</p>
    </div>`;

  await ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients('GM'),
  });
}

// ----------------------------------------------------------
// Heat breakdown (shared by the sheet line and the report)
// ----------------------------------------------------------
function sign(n) { return n >= 0 ? `+${n}` : `${n}`; }

// Parse the heat-item list setting into { lowercasedName: value }.
// Format: "Great Fur:1, Winter Cloak:1, Sleeping Fur". Value defaults to 1.
function getHeatItemMap() {
  const raw = game.settings.get(MODULE_ID, SETTINGS.HEAT_ITEMS) || '';
  const map = {};
  for (const part of raw.split(',')) {
    if (!part.trim()) continue;
    const [name, val] = part.split(':');
    const key = (name || '').trim().toLowerCase();
    if (!key) continue;
    map[key] = (val === undefined || val.trim() === '') ? 1 : (parseInt(val.trim()) || 0);
  }
  return map;
}

function computeHeatBreakdown(actor) {
  const state = getState();
  const temp = state.temp ?? 0;

  const seasonKey = currentSeasonKey();
  const seasonMod = SEASON_TEMP[seasonKey] ?? 0;
  const seasonLabel = SEASON_LABEL[seasonKey] ?? seasonKey;
  const terrainKey = state.terrain || 'plains';
  const mountainMod = TERRAIN_TEMP[terrainKey] ?? 0;
  const weatherMod = temp - seasonMod - mountainMod; // clouds-on-sun, etc.

  // Item heat: match EQUIPPED items against the configured name list and sum
  // their values (½ the vs-cold bonus). STATUS only; not a roll modifier.
  const heatMap = getHeatItemMap();
  let gearHeat = 0;
  const gearItems = [];
  if (actor) {
    for (const it of actor.items) {
      if (it.state !== 'equipped') continue;
      const v = heatMap[(it.name || '').trim().toLowerCase()];
      if (!v) continue;
      gearHeat += v;
      gearItems.push({ name: it.name, h: v });
    }
  }

  return {
    baseHeat: temp + gearHeat,
    temp, gearHeat, gearItems,
    seasonLabel, seasonMod, mountainMod, weatherMod, terrainKey,
  };
}

// ----------------------------------------------------------
// CHARACTER SHEET: Heat line on the GEAR tab + Check button
// ----------------------------------------------------------
Hooks.on('renderForbiddenLandsCharacterSheet', (app, html) => {
  const actor = app.actor;
  if (!actor) return;

  const b = computeHeatBreakdown(actor);

  // Compact, single-line readout sized to sit in the toolbar next to the
  // encumbrance counter. Full effect text lives in the hover tooltip so the
  // element stays thin.
  const tip = heatEffect(b.baseHeat).replace(/"/g, '&quot;');
  const compactHTML = `
    <span class="hb-heat-line" title="${tip}" style="display:inline-flex; align-items:center; gap:6px; margin-left:16px; font-size:13px; white-space:nowrap;">
      <i class="fas fa-temperature-low"></i> <strong>Heat ${b.baseHeat}</strong>
      <a class="hb-heat-check" style="text-decoration:underline; cursor:pointer;">Check</a>
    </span>`;

  // Remove any prior copy so re-renders don't stack multiple readouts.
  html.find('.hb-heat-line').remove();

  const gearTab = html.find('.tab[data-tab="gear"]').last();
  let how = null;

  // The encumbrance counter is <div class="encumbrance"> inside the gear tab's
  // <div class="controls"> toolbar. Drop the readout right after it so it sits
  // in the empty space of that same row.
  if (gearTab.length) {
    const enc = gearTab.find('.encumbrance').first();
    if (enc.length) {
      enc.after(compactHTML);
      how = 'next to encumbrance';
    } else {
      gearTab.prepend(compactHTML); // visible fallback within the gear tab
      how = 'top of gear tab (.encumbrance not found)';
    }
  } else {
    const header = html.find('.sheet-header');
    (header.length ? header : html.find('.window-content').first()).prepend(compactHTML);
    how = 'fallback:header';
  }
  console.log(`${MODULE_ID} | Heat readout placed: ${how}`);

  html.find('.hb-heat-check').off('click').on('click', () => openHeatDialog(actor));
});

function openHeatDialog(actor) {
  const b = computeHeatBreakdown(actor);
  new Dialog({
    title: 'Heat Check',
    content: `
      <p>Current heat (Temp + gear): <strong>${b.baseHeat}</strong></p>
      <p style="font-size:11px; opacity:.7; margin:-4px 0 6px;">Heat sets your status only. The Endurance roll is unmodified by heat — your gear's full cold bonus already applies to it.</p>
      <div class="form-group"><label><input type="checkbox" name="soaked"/> Soaked wet (−2)</label></div>
      <div class="form-group"><label><input type="checkbox" name="bare"/> Bare minimum clothing (−1)</label></div>
      <div class="form-group"><label><input type="checkbox" name="noblanket"/> No blanket (−1)</label></div>
      <div class="form-group"><label><input type="checkbox" name="fire"/> Campfire (+2)</label></div>
    `,
    buttons: {
      show: { icon: '<i class="fas fa-eye"></i>', label: 'Show Effect', callback: (h) => reportHeat(actor, h, false) },
      roll: { icon: '<i class="fas fa-dice"></i>', label: 'Roll Endurance', callback: (h) => reportHeat(actor, h, true) },
    },
    default: 'show',
  }).render(true);
}

async function reportHeat(actor, html, doRoll) {
  const b = computeHeatBreakdown(actor);

  const soaked = html.find('[name="soaked"]').is(':checked');
  const bare = html.find('[name="bare"]').is(':checked');
  const noblanket = html.find('[name="noblanket"]').is(':checked');
  const fire = html.find('[name="fire"]').is(':checked');

  // Final heat = environmental Temp + item heat + clothing/sleeping conditions.
  // This is a STATUS value (which effect row applies); it does NOT modify the roll.
  const finalHeat = b.baseHeat + (soaked ? -2 : 0) + (bare ? -1 : 0) + (noblanket ? -1 : 0) + (fire ? 2 : 0);

  // ---- Reasons behind the status ----
  const reasons = [`${b.seasonLabel} (${sign(b.seasonMod)})`];
  if (b.mountainMod) reasons.push(`Mountains (${sign(b.mountainMod)})`);
  if (b.weatherMod) reasons.push(`Weather (${sign(b.weatherMod)})`);
  for (const gi of b.gearItems) reasons.push(`${gi.name} (${sign(gi.h)})`);
  if (soaked) reasons.push('Soaked wet (−2)');
  if (bare) reasons.push('Bare minimum clothing (−1)');
  if (noblanket) reasons.push('No blanket (−1)');
  reasons.push(fire ? 'Campfire (+2)' : 'No campfire');

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div style="border:1px solid var(--color-border-dark,#555); border-radius:6px; padding:8px;">
        <h3 style="margin:0 0 4px;">Heat ${finalHeat}</h3>
        <p style="margin:0 0 6px;">${heatEffect(finalHeat)}</p>
        <p style="margin:0; font-size:11px; opacity:.8;"><strong>Why:</strong> ${reasons.join(', ')}.</p>
      </div>`,
  });

  if (doRoll) {
    const end = actor.skills?.endurance;
    const str = actor.system?.attribute?.strength;
    if (!end || !game.fbl?.roll) {
      ui.notifications?.warn('Could not find the Endurance skill or game.fbl.roll.');
      return;
    }

    // Plain Endurance roll: Strength (attribute) + Endurance (skill). Heat does
    // NOT modify it; the worn item's full cold bonus is applied automatically
    // via the system's own roll options.
    const rollData = {
      title: 'Endurance vs Cold',
      attribute: { label: str?.label ?? 'Strength', name: 'strength', value: str?.value ?? 0 },
      skill: { label: end.label, name: 'endurance', value: end.value ?? 0 },
    };
    let rollOptions = { maxPush: '1' };
    try {
      const sheetOpts = actor.sheet?.getRollOptions?.('endurance');
      if (sheetOpts) rollOptions = { ...rollOptions, ...sheetOpts };
    } catch (e) {
      console.warn(`${MODULE_ID} | getRollOptions('endurance') failed; rolling without sheet modifiers`, e);
    }

    await game.fbl.roll(rollData, rollOptions);
  }
}