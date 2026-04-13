Hooks.once('init', () => {

  // V13 registers item types here
  game.system.documentTypes.Item["hb_armor"] = {};

  // Register the type label
  game.i18n.translations["TYPES.Item.hb_armor"] = "HB Armour";

  console.log("FBL HB Armor | Item type registered.");
});

Hooks.once('ready', () => {
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

// Inject HB Armour into the Create Item dialog dropdown
Hooks.on('renderDialog', (dialog, html, data) => {
  const select = html.find('select[name="type"]');
  if (!select.length) return;
  
  // Check this is the item creation dialog
  if (!dialog.title?.toLowerCase().includes('item')) return;

  // Check option doesn't already exist
  if (select.find('option[value="hb_armor"]').length) return;

  // Append the new option
  select.append('<option value="hb_armor">HB Armour</option>');
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