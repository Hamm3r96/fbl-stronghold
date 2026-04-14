// ============================================================
// FBL Homebrew Armour — overrides.js
// ============================================================
// 1. Injects custom "Armor Value" field into armour item sheets
// 2. Relabels "Rating" to "Integrity"
// 3. Overrides the armour roll on character combat tab:
//    - Base dice = sum of Armor Value (flag) across equipped armour
//    - Skill dice = Endurance or Move (player choice)
//    - Pushable, but no automatic bane consequences
// ============================================================

const MODULE_ID = 'fbl-hb-armor';

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