Hooks.once('init', () => {

  // Register the data model as a clone of the existing armor type
  const existingModel = CONFIG.Item.dataModels["armor"];

  if (!existingModel) {
    console.warn("FBL HB Armor | Could not find base armor data model.");
    return;
  }

  class HBArmorDataModel extends existingModel {
    static defineSchema() {
      return super.defineSchema();
    }
  }

  CONFIG.Item.dataModels["hb_armor"] = HBArmorDataModel;

  // Register the type label
  game.i18n.translations["TYPES.Item.hb_armor"] = "HB Armour";

  console.log("FBL HB Armor | Data model registered.");
});

Hooks.once('setup', () => {
  const sheetClasses = CONFIG.Item.sheetClasses["armor"] ?? {};
  const FBLArmorSheet = sheetClasses["forbidden-lands.ForbiddenLandsArmorSheet"]?.cls;

  if (!FBLArmorSheet) {
    console.warn("FBL HB Armor | Could not find FBL armor sheet class.");
    return;
  }

  Items.registerSheet("fbl-hb-armor", FBLArmorSheet, {
    types: ["hb_armor"],
    makeDefault: true,
    label: "HB Armour Sheet"
  });

  console.log("FBL HB Armor | Sheet registered.");
});

// Relabel "Rating" to "Integrity" on the sheet
Hooks.on('renderItemSheet', (app, html, data) => {
  if (app.item?.type !== 'hb_armor') return;

  html.find('label, .label').each(function () {
    if ($(this).text().trim() === 'Rating') {
      $(this).text('Integrity');
    }
  });
});