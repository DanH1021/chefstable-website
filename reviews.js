/* reviews.js — fetches Google reviews via Netlify serverless function */
(function () {
  const grid     = document.getElementById('reviews-grid');
  const loading  = document.getElementById('reviews-loading');
  const fallback = document.getElementById('reviews-fallback');

  function stars(rating) {
    const full  = Math.round(rating);
    let s = '';
    for (let i = 1; i <= 5; i++) {
      s += i <= full ? '★' : '☆';
    }
    return s;
  }

  function renderReviews(reviews) {
    loading.hidden = true;
    if (!reviews || reviews.length === 0) {
      fallback.hidden = false;
      return;
    }
    reviews.forEach(function (r) {
      const card = document.createElement('article');
      card.className = 'testimonial-card';
      card.innerHTML = `
        <div aria-label="Rating: ${r.rating} out of 5 stars" style="color:var(--gold);font-size:1.2rem;margin-bottom:0.75rem;" role="img">${stars(r.rating)}</div>
        <p class="testimonial-quote">${escapeHtml(r.text)}</p>
        <p class="testimonial-author">— ${escapeHtml(r.author_name)}${r.relative_time_description ? ', ' + escapeHtml(r.relative_time_description) : ''}</p>
      `;
      grid.appendChild(card);
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  fetch('/.netlify/functions/google-reviews')
    .then(function (res) {
      if (!res.ok) throw new Error('fetch failed');
      return res.json();
    })
    .then(function (data) {
      renderReviews(data.reviews);
    })
    .catch(function () {
      loading.hidden = true;
      fallback.hidden = false;
    });
})();
