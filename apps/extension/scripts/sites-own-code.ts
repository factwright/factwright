// What applicant systems' own code does on their forms, which the forms saved as fixtures don't
// have, as the end-to-end runs act it out in a real browser: Lever's location box looking up the
// places it suggests, and Ashby's Yes and No staying pressed. Each goes in a form's page before
// its </body>. The places are made up.

/**
 * Lever's own code for its location box, as it works: as you type, it looks the city up, saying
 * it's loading, then lists the places it found, or says it found none, and a click on one keeps
 * it, in the box and in a hidden field, which is what Lever takes.
 */
export const LEVER_LOOKS_UP = `<script>
(() => {
  const PLACES = ['Denver City, Texas, United States', 'Denver, Colorado, United States', 'Boulder, Colorado, United States'];
  const box = document.getElementById('location-input');
  const kept = document.getElementById('selected-location');
  const results = document.querySelector('.dropdown-results');
  const none = document.querySelector('.dropdown-no-results');
  const loading = document.querySelector('.dropdown-loading-results');
  const plain = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  none.style.display = 'none';
  loading.style.display = 'none';
  let timer = 0;
  let looked = '';
  // It looks a place up once the box's words change, not on any key, as Tab.
  box.addEventListener('keyup', () => {
    if (box.value === looked) return;
    looked = box.value;
    clearTimeout(timer);
    kept.value = '';
    results.replaceChildren();
    none.style.display = 'none';
    loading.style.display = box.value.trim() ? '' : 'none';
    if (!box.value.trim()) return;
    timer = setTimeout(() => {
      loading.style.display = 'none';
      const city = plain(box.value.split(',')[0] || '');
      const found = PLACES.filter((place) => city && plain(place).includes(city));
      if (found.length === 0) none.style.display = '';
      for (const place of found) {
        const option = document.createElement('div');
        option.className = 'dropdown-location';
        option.textContent = place;
        option.addEventListener('click', () => {
          box.value = place;
          looked = place;
          kept.value = JSON.stringify({ name: place });
          results.replaceChildren();
        });
        results.append(option);
      }
    }, 150);
  });
})();
</script>`;

/** Ashby's own code for its Yes and No: a click presses the one, and lets the other go. */
export const ASHBY_PRESSES = `<script>
for (const button of document.querySelectorAll('button[aria-pressed]')) {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    for (const each of button.parentElement.querySelectorAll('button[aria-pressed]')) {
      each.setAttribute('aria-pressed', String(each === button));
    }
  });
}
</script>`;

/** A form's page with what its site's own code does in it. */
export const withOwnCode = (page: string, code: string) =>
  page.replace('</body>', `${code}</body>`);
