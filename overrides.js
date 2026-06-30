// ============================================================
// FBL Stronghold (Homebrew) — overrides.js
// ============================================================
// 1. Injects custom "Armor Value" field into armour item sheets
// 2. Relabels "Rating" to "Integrity"
// 3. Overrides the armour roll on character combat tab:
//    - Base dice = sum of Armor Value (flag) across equipped armour
//    - Skill dice = Endurance or Move (player choice)
//    - Pushable, but no automatic bane consequences
// 4. Rest button restores only +1 per damaged attribute,
//    and announces the rest in chat listing what was regained
// ============================================================

const MODULE_ID = 'fbl-stronghold';

// ----------------------------------------------------------
// ITEM SHEET: Inject Armor Value field & relabel Rating
// ----------------------------------------------------------
Hooks.on('renderItemSheet', (app, html, data) => {
  if (app.item?.type !== 'armor') return;

  // Relabel "Rating" to "Integrity"
  html.find('label, .label').each(function () {
    if ($(this).text().trim() === 'Rating') {
      $(this).text('Integrity');
    }
  });

  // Add "Armor Value" field below Rating/Integrity
  const armorValue = app.item.getFlag(MODULE_ID, 'armorValue') ?? 0;

  const fieldHTML = `
    <div class="form-group">
      <label>Armor Value</label>
      <div class="form-fields">
        <input 
          type="number" 
          min="0"
          value="${armorValue}"
          class="hb-armorvalue-input"
        />
      </div>
    </div>
  `;

  const ratingGroup = html.find('input[name="system.rating"]').closest('.form-group');
  if (ratingGroup.length) {
    ratingGroup.after(fieldHTML);
  } else {
    html.find('.sheet-body').prepend(fieldHTML);
  }

  html.find('.hb-armorvalue-input').on('change', async (event) => {
    const value = parseInt(event.target.value) || 0;
    await app.item.setFlag(MODULE_ID, 'armorValue', value);
  });
});

// ----------------------------------------------------------
// CHARACTER SHEET: Override armour roll on combat tab
// ----------------------------------------------------------
Hooks.on('renderForbiddenLandsCharacterSheet', (app, html, data) => {
  // Remove existing click handler and replace with ours
  const armorBtn = html.find('.roll-armor.total');
  if (!armorBtn.length) return;

  // Strip the system's click binding
  armorBtn.off('click');

  // Bind our custom handler
  armorBtn.on('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const actor = app.actor;
    if (!actor) return;

    // -------------------------------------------------------
    // Gather total Armor Value from equipped non-shield armour
    // -------------------------------------------------------
    let totalArmorValue = 0;
    const equippedArmor = actor.itemTypes.armor.filter(
      (item) => item.state === 'equipped' && item.itemProperties.part !== 'shield'
    );

    for (const armor of equippedArmor) {
      const av = armor.getFlag(MODULE_ID, 'armorValue') ?? 0;
      totalArmorValue += av;
    }

    // -------------------------------------------------------
    // Get skill values
    // -------------------------------------------------------
    const endurance = actor.skills?.endurance;
    const move = actor.skills?.move;

    if (!totalArmorValue && !endurance?.value && !move?.value) {
      ui.notifications.warn('No armour value or applicable skills found.');
      return;
    }

    // -------------------------------------------------------
    // Skill choice dialog
    // -------------------------------------------------------
    const skillChoice = await new Promise((resolve) => {
      const d = new Dialog({
        title: 'Armour Roll — Choose Skill',
        content: `
          <div style="margin-bottom: 10px;">
            <p><strong>Base Dice (Armor Value):</strong> ${totalArmorValue}</p>
            <p>Choose which skill to add:</p>
          </div>
        `,
        buttons: {
          endurance: {
            icon: '<i class="fas fa-heart"></i>',
            label: `Endurance (${endurance?.value ?? 0})`,
            callback: () => resolve('endurance'),
          },
          move: {
            icon: '<i class="fas fa-running"></i>',
            label: `Move (${move?.value ?? 0})`,
            callback: () => resolve('move'),
          },
          none: {
            icon: '<i class="fas fa-shield-alt"></i>',
            label: 'Armor Only',
            callback: () => resolve(null),
          },
        },
        default: 'endurance',
        close: () => resolve(undefined),
      });
      d.render(true);
    });

    // User closed the dialog without choosing
    if (skillChoice === undefined) return;

    // -------------------------------------------------------
    // Build roll data
    // -------------------------------------------------------
    const chosenSkill = skillChoice ? actor.skills[skillChoice] : null;
    const skillValue = chosenSkill?.value ?? 0;
    const skillLabel = chosenSkill
      ? game.i18n.localize(chosenSkill.label)
      : null;

    const rollTitle = `${game.i18n.localize('ITEM.TypeArmor')}: ${game.i18n.localize('ARMOR.TOTAL')}`;

    const rollData = {
      title: rollTitle,
      gear: {
        label: game.i18n.localize('ITEM.TypeArmor'),
        name: game.i18n.localize('ITEM.TypeArmor'),
        value: totalArmorValue,
      },
    };

    if (chosenSkill) {
      rollData.skill = {
        label: skillLabel,
        name: skillChoice,
        value: skillValue,
      };
    }

    // -------------------------------------------------------
    // Build roll options
    // -------------------------------------------------------
    const rollOptions = {
      maxPush: '1',
      ...app.getRollOptions('armor'),
      gears: app.getGears(),
    };

    // -------------------------------------------------------
    // Execute roll via public API
    // -------------------------------------------------------
    await game.fbl.roll(rollData, rollOptions);
  });
});

// ----------------------------------------------------------
// CHARACTER SHEET: Rest button restores only +1 per attribute
// ----------------------------------------------------------
Hooks.on('renderForbiddenLandsCharacterSheet', (app, html, data) => {
  const restBtn = html.find('a.rest-up');
  if (!restBtn.length) return;

  // Strip the system's binding, then bind ours
  restBtn.off('click').on('click', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    const actor = app.actor;
    if (!actor) return;

    // Only the four attributes actually used on the sheet.
    // (health/resolve exist in data with max 0 and are deliberately excluded.)
    const ATTRS = ['strength', 'agility', 'wits', 'empathy'];
    const attrs = actor.system.attribute ?? {};
    const updates = {};
    const restored = [];

    for (const key of ATTRS) {
      const attr = attrs[key];
      if (!attr) continue;
      if (attr.value < attr.max) {
        updates[`system.attribute.${key}.value`] = Math.min(attr.value + 1, attr.max);
        // Localized attribute name for the chat message (e.g. "Wits")
        restored.push(game.i18n.localize(attr.label));
      }
    }

    if (Object.keys(updates).length) {
      await actor.update(updates);
    }

    // -------------------------------------------------------
    // Announce the rest in chat, listing what was actually
    // restored (or that nothing was, if already at full)
    // -------------------------------------------------------
    const content = restored.length
      ? `<p><strong>${actor.name}</strong> takes a rest and regains ${restored
          .map((name) => `1 ${name}`)
          .join(', ')}.</p>`
      : `<p><strong>${actor.name}</strong> takes a rest, but is already fully rested.</p>`;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content,
    });
  });
});

// ----------------------------------------------------------
// CHARACTER SHEET: Remove the Chargen button (players only)
// ----------------------------------------------------------
Hooks.on('renderForbiddenLandsCharacterSheet', (app, html, data) => {
  // GM keeps chargen for building characters/NPCs.
  // To remove it for everyone, delete the line below.
  if (game.user.isGM) return;

  html.find('a.char-gen').remove();
});
// ----------------------------------------------------------
// Default the FBL "Collapse sheet header buttons" client
// setting to ON. Per-client default only — respects any
// user who has explicitly set their own preference.
// ----------------------------------------------------------
Hooks.once('init', () => {
  const setting = game.settings.settings.get('forbidden-lands.collapseSheetHeaderButtons');
  if (setting) setting.default = true;
});
Hooks.once('init', () => {
  const key = 'window-controls-next.rememberPinnedWindows'; // ← replace with the real key from the filter
  const setting = game.settings.settings.get(key);
  if (setting) setting.default = true;
  else console.warn('[fbl-stronghold] pinned-windows setting not found');
});