Hooks.on('renderItemSheet', (app, html, data) => {
  // Only target armor items
  if (app.item?.type !== 'armor') return;

  const integrity = app.item.getFlag('fbl-hb-armor', 'integrity') ?? 0;

  // Build the field HTML matching FBL's existing sheet style
  const fieldHTML = `
    <div class="form-group">
      <label>Integrity</label>
      <div class="form-fields">
        <input 
          type="number" 
          min="0"
          value="${integrity}"
          data-flag-scope="fbl-hb-armor"
          data-flag-key="integrity"
          class="hb-integrity-input"
        />
      </div>
    </div>
  `;

  // Inject after the Rating field
  const ratingGroup = html.find('input[name="system.rating"]').closest('.form-group');
  if (ratingGroup.length) {
    ratingGroup.after(fieldHTML);
  } else {
    // Fallback - inject at top of sheet body
    html.find('.sheet-body').prepend(fieldHTML);
  }

  // Handle save on change
  html.find('.hb-integrity-input').on('change', async (event) => {
    const value = parseInt(event.target.value) || 0;
    await app.item.setFlag('fbl-hb-armor', 'integrity', value);
  });
});