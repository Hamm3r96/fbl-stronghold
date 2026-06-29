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
  TERRAIN: 'terrain',
  UNIT: 'tempUnit',
  AUTO: 'autoPrompt',
};

const SEASON_TEMP = { summer: 2, springfall: 1, winter: 0 };
const TERRAIN_RAIN_DEFAULT = { normal: 'ask', mountain: 'yes', coast: 'yes', desert: 'no' };

const DEFAULT_STATE = {
  rainRisk: 0,        // accumulated +N to the weather die (from 6+ results)
  lastResult: null,   // 'sun' | 'clouds' | 'wind' | 'risk'
  precip: null,       // 'rain' | 'snow' | null (today's actual precipitation)
  fog: false,
  temp: 0,
  windActive: false,  // Strong Winds → a quarter-day re-roll is pending
  lastDayKey: null,
  lastQuarter: null,
};

// ----------------------------------------------------------
// Settings registration
// ----------------------------------------------------------
Hooks.once('init', () => {
  game.settings.register(MODULE_ID, SETTINGS.STATE, {
    scope: 'world', config: false, type: Object,
    default: foundry.utils.deepClone(DEFAULT_STATE),
  });

  game.settings.register(MODULE_ID, SETTINGS.SEASON, {
    name: 'Weather: Current Season',
    hint: 'Sets the base Temp modifier (Summer +2, Spring/Fall +1, Winter ±0).',
    scope: 'world', config: true, type: String, default: 'springfall',
    choices: { summer: 'Summer (+2)', springfall: 'Spring / Fall (+1)', winter: 'Winter (±0)' },
  });

  game.settings.register(MODULE_ID, SETTINGS.TERRAIN, {
    name: 'Weather: Default Terrain',
    hint: 'Mountains apply −1 Temp and pre-fill the rain prompt on a Risk of rain/snow result.',
    scope: 'world', config: true, type: String, default: 'normal',
    choices: { normal: 'Normal (ask on rain)', mountain: 'Mountain (−1 temp, rain likely)', coast: 'Coast (rain likely)', desert: 'Desert (no rain)' },
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

    const proceed = await new Promise((resolve) => {
      new Dialog({
        title: 'Reforged Weather',
        content: `<p>${reason}.</p><p>Roll for the weather? <em>(1d6 + ${state.rainRisk} accumulated rain-risk)</em></p>`,
        buttons: {
          roll: { icon: '<i class="fas fa-dice-d6"></i>', label: 'Roll Weather', callback: () => resolve(true) },
          skip: { icon: '<i class="fas fa-forward"></i>', label: 'Skip', callback: () => resolve(false) },
        },
        default: 'roll',
        close: () => resolve(false),
      }).render(true);
    });

    if (proceed) await resolveWeather();
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

  const notes = [];
  state.fog = false;
  state.precip = null;
  state.windActive = false; // cleared each roll; re-set below if winds occur

  let result;
  if (effective <= 3) {
    result = 'sun';
    notes.push('+1 to Lead the Way, +1 to Hiking in Darkness.');
    if (prev === 'risk' && (state.precip === 'rain' || state.precip === 'snow')) {
      state.fog = true;
    }
    // Fog also if this Sun directly follows precipitation:
    if (prev === 'risk') {
      state.fog = true;
      notes.push('Fog during the first light quarter-day: −2 to Lead the Way.');
    }
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
    notes.push(`Risk for rain/snowfall — rain-risk now +${state.rainRisk}. Actual precipitation depends on terrain.`);
  }
  state.lastResult = result;

  // ---- Temp ----
  let temp = SEASON_TEMP[game.settings.get(MODULE_ID, SETTINGS.SEASON)] ?? 0;
  if (game.settings.get(MODULE_ID, SETTINGS.TERRAIN) === 'mountain') temp -= 1;
  if (result === 'clouds' && prev === 'sun') { temp += 1; notes.push('Clouds following Sun: +1 Temp.'); }
  state.temp = temp;

  await setState(state);

  // ---- Did it actually rain/snow? (GM call, terrain-driven) ----
  if (result === 'risk') await resolvePrecip(temp);

  await postWeatherCard(die, effective, result, temp, notes);
}

async function resolvePrecip(temp) {
  const terrain = game.settings.get(MODULE_ID, SETTINGS.TERRAIN);
  const def = TERRAIN_RAIN_DEFAULT[terrain] ?? 'ask';

  const rains = await new Promise((resolve) => {
    new Dialog({
      title: 'Risk of Rain / Snow',
      content: `<p>Terrain: <strong>${terrain}</strong>. Does it actually rain/snow now?</p>`,
      buttons: {
        yes: { icon: '<i class="fas fa-cloud-rain"></i>', label: 'Yes', callback: () => resolve(true) },
        no: { icon: '<i class="fas fa-sun"></i>', label: 'No', callback: () => resolve(false) },
      },
      default: def === 'no' ? 'no' : 'yes',
      close: () => resolve(false),
    }).render(true);
  });

  if (!rains) return;

  const state = getState();
  state.precip = temp > 0 ? 'rain' : 'snow';
  state.rainRisk = 0; // INTERPRETATION: rainRisk reset — pressure releases once it precipitates.
  await setState(state);
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
async function postWeatherCard(die, effective, result, temp, notes) {
  const labels = { sun: 'Sun / Moon / Stars', clouds: 'Cloudy', wind: 'Strong Winds', risk: 'Risk of Rain / Snow' };
  const state = getState();

  let precipLine = '';
  if (state.precip === 'rain') {
    precipLine = '<p>🌧️ <strong>Rain</strong> — −1 Make Camp, +1 Forage Water. −1 heat if heat is positive (does not stack). Moisture-sensitive items exposed 15+ min risk item-dice damage.</p>';
  } else if (state.precip === 'snow') {
    precipLine = '<p>❄️ <strong>Snowfall</strong> — −1 to Lead the Way and Forced March.</p>';
  }
  const fogLine = state.fog ? '<p>🌫️ <strong>Fog</strong> (first light quarter-day) — −2 to Lead the Way.</p>' : '';
  const eff = effective !== die ? ` (+${effective - die} risk → ${effective})` : '';

  const content = `
    <div style="border:1px solid var(--color-border-dark, #555); border-radius:6px; padding:8px;">
      <h3 style="margin:0 0 4px;">${labels[result]}</h3>
      <p style="margin:2px 0;"><strong>Die:</strong> ${die}${eff} &nbsp;·&nbsp; <strong>Temp:</strong> ${temp} (${degrees(temp)})</p>
      ${precipLine}${fogLine}
      <ul style="margin:6px 0; padding-left:18px;">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
      <p style="font-size:11px; opacity:.7; margin:2px 0 0;">Accumulated rain-risk: +${state.rainRisk}</p>
    </div>`;

  await ChatMessage.create({
    content,
    whisper: ChatMessage.getWhisperRecipients('GM'),
  });
}

// ----------------------------------------------------------
// ITEM SHEET: Heat Modifier field (gear & armor)
// ----------------------------------------------------------
Hooks.on('renderItemSheet', (app, html) => {
  const t = app.item?.type;
  if (t !== 'gear' && t !== 'armor') return;

  const heat = app.item.getFlag(MODULE_ID, 'heat') ?? 0;
  const cat = app.item.getFlag(MODULE_ID, 'heatCat') ?? 'gear';
  const sel = (v) => (cat === v ? 'selected' : '');
  const fieldHTML = `
    <div class="form-group">
      <label>Heat Modifier</label>
      <div class="form-fields">
        <input type="number" value="${heat}" class="hb-heat-input" style="flex:0 0 60px;"/>
        <select class="hb-heatcat-input" title="Clothing: only the single best worn item counts (you can't wear several at once). Gear: stacks — fur, blanket, etc.">
          <option value="gear" ${sel('gear')}>Gear (stacks)</option>
          <option value="clothing" ${sel('clothing')}>Clothing (best only)</option>
        </select>
      </div>
    </div>`;

  const body = html.find('.sheet-body');
  if (body.length) body.prepend(fieldHTML);
  else html.append(fieldHTML);

  html.find('.hb-heat-input').off('change').on('change', async (ev) => {
    await app.item.setFlag(MODULE_ID, 'heat', parseInt(ev.target.value) || 0);
  });
  html.find('.hb-heatcat-input').off('change').on('change', async (ev) => {
    await app.item.setFlag(MODULE_ID, 'heatCat', ev.target.value);
  });
});

// ----------------------------------------------------------
// CHARACTER SHEET: Heat line + Check button
// ----------------------------------------------------------
Hooks.on('renderForbiddenLandsCharacterSheet', (app, html) => {
  const actor = app.actor;
  if (!actor) return;

  const state = getState();
  const temp = state.temp ?? 0;

  // Clothing = only the single best garment counts (can't wear several at once).
  // Gear (fur, blanket, etc.) stacks. Clothing + gear stack with each other.
  let gearHeat = 0;
  let clothingHeat = 0;
  let hasClothing = false;
  for (const it of actor.items) {
    const h = it.getFlag(MODULE_ID, 'heat');
    if (!h) continue;
    // INTERPRETATION: gear filter — uncomment to ignore stored items:
    // if (it.state === 'stored' || it.state === 'backpack') continue;
    const cat = it.getFlag(MODULE_ID, 'heatCat') ?? 'gear';
    if (cat === 'clothing') {
      clothingHeat = hasClothing ? Math.max(clothingHeat, h) : h;
      hasClothing = true;
    } else {
      gearHeat += h;
    }
  }
  const baseHeat = temp + clothingHeat + gearHeat;

  const lineHTML = `
    <div class="hb-heat-line" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:4px 8px; margin:4px 0; border:1px solid var(--color-border-dark, #555); border-radius:4px;">
      <span><strong>Heat ${baseHeat}</strong> <small style="opacity:.7;">(Temp ${temp} + clothing ${clothingHeat} + gear ${gearHeat})</small></span>
      <a class="hb-heat-check" title="Check heat / roll vs cold"><i class="fas fa-temperature-low"></i> Check</a>
      <span class="hb-heat-effect" style="flex-basis:100%; font-size:11px; opacity:.85;">${heatEffect(baseHeat)}</span>
    </div>`;

  const header = html.find('.sheet-header');
  if (header.length) header.append(lineHTML);
  else html.find('.window-content').prepend(lineHTML);

  html.find('.hb-heat-check').off('click').on('click', () => openHeatDialog(actor, baseHeat));
});

function openHeatDialog(actor, baseHeat) {
  new Dialog({
    title: 'Heat Check',
    content: `
      <p>Base heat (Temp + gear): <strong>${baseHeat}</strong></p>
      <div class="form-group"><label><input type="checkbox" name="soaked"/> Soaked wet (−2)</label></div>
      <div class="form-group"><label><input type="checkbox" name="fire"/> Campfire (+2)</label></div>
      <div class="form-group"><label><input type="checkbox" name="guard"/> Someone standing guard <small style="opacity:.7;">(fire won’t go out)</small></label></div>
    `,
    buttons: {
      show: { icon: '<i class="fas fa-eye"></i>', label: 'Show Effect', callback: (h) => reportHeat(actor, baseHeat, h, false) },
      roll: { icon: '<i class="fas fa-dice"></i>', label: 'Roll Endurance', callback: (h) => reportHeat(actor, baseHeat, h, true) },
    },
    default: 'show',
  }).render(true);
}

async function reportHeat(actor, baseHeat, html, doRoll) {
  const soaked = html.find('[name="soaked"]').is(':checked') ? -2 : 0;
  const fire = html.find('[name="fire"]').is(':checked') ? 2 : 0;
  const finalHeat = baseHeat + soaked + fire;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div style="border:1px solid var(--color-border-dark,#555); border-radius:6px; padding:8px;">
        <h3 style="margin:0 0 4px;">Heat ${finalHeat}</h3>
        <p style="margin:0;">${heatEffect(finalHeat)}</p>
      </div>`,
  });

  if (doRoll) {
    const end = actor.skills?.endurance;
    if (end && game.fbl?.roll) {
      // skill slot only — avoids the FBL push handler attribute-slot bug.
      await game.fbl.roll(
        { title: 'Endurance vs Cold', skill: { label: end.label, name: 'endurance', value: end.value ?? 0 } },
        { maxPush: '1' }
      );
    } else {
      ui.notifications?.warn('Could not find the Endurance skill or game.fbl.roll.');
    }
  }
}
