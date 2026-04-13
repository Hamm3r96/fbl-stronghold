Hooks.on('renderItemSheet', (app, html, data) => {
  if (app.item?.type !== 'armor') return;

  // Relabel "Rating" to "Integrity"
  html.find('label, .label').each(function () {
    if ($(this).text().trim() === 'Rating') {
      $(this).text('Integrity');
    }
  });

  // Add new "Armor Value" field below
  const armorValue = app.item.getFlag('fbl-hb-armor', 'armorValue') ?? 0;

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
    await app.item.setFlag('fbl-hb-armor', 'armorValue', value);
  });
});