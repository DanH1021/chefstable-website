/* ============================================
   CHEF'S TABLE — Shop JS
   Stripe + Supabase inventory + Fargo tax
   ============================================ */

const SHOP_CONFIG = {
  stripeKey: 'pk_live_dz0kXjmKLFqS9R50MxSXS3ZT',
  taxRate: 0.0775,
  // Fallback item config (used if Supabase not yet set up)
  items: {
    easter:  { name: 'Easter Brunch Meal Kit',        priceCents: 8500  },
    pickles: { name: "House-Made Pickles — Quart Jar", priceCents: 1200  },
  }
};

const stripe   = Stripe(SHOP_CONFIG.stripeKey);
const elements = stripe.elements();
const cardEl   = elements.create('card', {
  style: {
    base: { fontFamily:"'Lato',sans-serif", fontSize:'16px', color:'#111111', '::placeholder':{color:'#9AA0B0'} },
    invalid: { color:'#C0392B' }
  }
});
cardEl.on('change', e => {
  document.getElementById('card-errors').textContent = e.error ? e.error.message : '';
});

let currentItem   = null;
let inventoryData = {};

// ── INVENTORY LOAD ───────────────────────────────────────────
async function loadInventory() {
  try {
    const res  = await fetch('/.netlify/functions/shop-inventory');
    if (!res.ok) return;
    const data = await res.json();
    (data.items||[]).forEach(item => { inventoryData[item.slug] = item; });
    updateShopUI();
  } catch(e) { console.warn('Inventory offline mode:', e); }
}

function updateShopUI() {
  Object.entries(inventoryData).forEach(([slug, item]) => {
    const card = document.getElementById('item-' + slug);
    if (!card) return;
    if (!item.visible) { card.style.display='none'; return; }
    const btn = card.querySelector('button[data-order-btn]');
    if (item.sold_out && btn) {
      btn.disabled = true; btn.textContent = 'Sold Out';
    } else if (item.available <= 10 && item.available > 0) {
      const priceEl = card.querySelector('.shop-item-price');
      if (priceEl) {
        const warn = document.createElement('p');
        warn.style.cssText = 'color:#856404;font-weight:700;font-size:.85rem;margin-bottom:.5rem;';
        warn.textContent   = 'Only ' + item.available + ' remaining!';
        priceEl.parentNode.insertBefore(warn, priceEl);
      }
    }
  });
}

loadInventory();

// ── PICKUP DATE VALIDATION ───────────────────────────────────
// No weekends, 48hr minimum notice
function getMinPickupDate() {
  const now     = new Date();
  const minDate = new Date(now.getTime() + 48 * 60 * 60 * 1000); // +48hrs

  // If minDate lands on Saturday (6) push to Monday
  if (minDate.getDay() === 6) minDate.setDate(minDate.getDate() + 2);
  // If Sunday (0) push to Monday
  if (minDate.getDay() === 0) minDate.setDate(minDate.getDate() + 1);

  return minDate;
}

function setPickupDateConstraints() {
  const input = document.getElementById('order-pickup-date');
  if (!input) return;
  const min = getMinPickupDate();
  const fmt  = min.toISOString().split('T')[0];
  input.min = fmt;
  input.value = '';
  // Add listener to block weekend selection
  input.addEventListener('change', function() {
    const chosen = new Date(this.value + 'T12:00:00');
    const day    = chosen.getDay();
    if (day === 0 || day === 6) {
      this.setCustomValidity('Pickup is not available on weekends. Please choose a weekday.');
      this.reportValidity();
      this.value = '';
    } else {
      this.setCustomValidity('');
    }
  });
}

// ── ORDER FORM OPEN ──────────────────────────────────────────
function openOrderForm(itemKey) {
  const live   = inventoryData[itemKey];
  const config = SHOP_CONFIG.items[itemKey];

  if (live && live.sold_out) { alert('Sorry, this item is sold out.'); return; }

  currentItem = {
    slug:       itemKey,
    name:       live ? live.name        : (config ? config.name        : itemKey),
    priceCents: live ? live.price_cents : (config ? config.priceCents  : 0),
    supabaseId: live ? live.id          : null,
    available:  live ? live.available   : 999,
  };

  document.getElementById('order-form-title').textContent        = 'Order: ' + currentItem.name;
  document.getElementById('order-item-display').textContent      = currentItem.name + ' — $' + (currentItem.priceCents/100).toFixed(2) + ' each (+ 7.75% Fargo sales tax)';
  document.getElementById('summary-item-label').textContent      = currentItem.name;

  // Pickles callout
  const callout = document.getElementById('pickles-callout');
  if (callout) callout.style.display = itemKey === 'pickles' ? 'block' : 'none';

  const qtyInput = document.getElementById('order-qty');
  qtyInput.max   = Math.min(currentItem.available, 20);
  qtyInput.value = 1;

  setPickupDateConstraints();

  const formSection = document.getElementById('order-form-section');
  formSection.hidden = false;
  formSection.scrollIntoView({ behavior:'smooth', block:'start' });

  setTimeout(() => { try { cardEl.mount('#card-element'); } catch(e){} }, 100);
  updateSummary();
}

function closeOrderForm() {
  document.getElementById('order-form-section').hidden = true;
  currentItem = null;
}

// ── SUMMARY UPDATE ───────────────────────────────────────────
function updateSummary() {
  if (!currentItem) return;
  const qty      = parseInt(document.getElementById('order-qty').value) || 1;
  const subtotal = currentItem.priceCents * qty;
  const tax      = Math.round(subtotal * SHOP_CONFIG.taxRate);
  const total    = subtotal + tax;

  document.getElementById('summary-qty').textContent        = qty;
  document.getElementById('summary-item-price').textContent = '$' + (currentItem.priceCents/100).toFixed(2);
  document.getElementById('summary-subtotal').textContent   = '$' + (subtotal/100).toFixed(2);
  document.getElementById('summary-tax').textContent        = '$' + (tax/100).toFixed(2);
  document.getElementById('summary-total').textContent      = '$' + (total/100).toFixed(2);
  document.getElementById('order-btn-label').textContent    = 'Pay $' + (total/100).toFixed(2) + ' & Place Order';
}

document.getElementById('order-qty').addEventListener('input', updateSummary);

// ── SUBMIT ───────────────────────────────────────────────────
document.getElementById('order-submit').addEventListener('click', async function() {
  if (!currentItem) return;

  const name       = document.getElementById('order-name').value.trim();
  const email      = document.getElementById('order-email').value.trim();
  const phone      = document.getElementById('order-phone').value.trim();
  const pickupDate = document.getElementById('order-pickup-date').value;
  const notes      = document.getElementById('order-notes').value.trim();
  const qty        = parseInt(document.getElementById('order-qty').value) || 1;
  const statusEl   = document.getElementById('order-status');
  const submitBtn  = document.getElementById('order-submit');

  // Validation
  if (!name || !email || !phone || !pickupDate) {
    const missing = [];
    if (!name) missing.push('Name');
    if (!email) missing.push('Email');
    if (!phone) missing.push('Phone');
    if (!pickupDate) missing.push('Pickup Date');
    statusEl.textContent = 'Please fill in: ' + missing.join(', ');
    statusEl.className   = 'form-status error';
    statusEl.style.display = 'block';
    statusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Confirm not a weekend
  const chosen = new Date(pickupDate + 'T12:00:00');
  if (chosen.getDay() === 0 || chosen.getDay() === 6) {
    statusEl.textContent = 'Pickup is not available on weekends. Please select a weekday.';
    statusEl.className   = 'form-status error';
    statusEl.style.display = 'block';
    return;
  }

  // 48hr check — compare date strings only to avoid timezone/time issues
  const minDateStr = getMinPickupDate().toISOString().split('T')[0];
  if (pickupDate < minDateStr) {
    const friendly = new Date(minDateStr + 'T12:00:00').toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'});
    statusEl.textContent = 'Please allow at least 48 hours notice. Earliest available pickup: ' + friendly + '.';
    statusEl.className   = 'form-status error';
    statusEl.style.display = 'block';
    statusEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if (currentItem.available !== 999 && qty > currentItem.available) {
    statusEl.textContent = 'Only ' + currentItem.available + ' available. Please reduce quantity.';
    statusEl.className   = 'form-status error';
    statusEl.style.display = 'block';
    return;
  }

  submitBtn.disabled = true;
  document.getElementById('order-btn-label').textContent = 'Processing…';
  statusEl.style.display = 'none';

  const subtotalCents = currentItem.priceCents * qty;

  try {
    // 1. Create PaymentIntent (tax calculated server-side)
    const intentRes = await fetch('/.netlify/functions/create-payment-intent', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ amount: subtotalCents, item_id: currentItem.supabaseId })
    });
    if (!intentRes.ok) throw new Error('Could not initialize payment.');
    const { clientSecret, total } = await intentRes.json();

    // 2. Confirm with Stripe
    const { paymentIntent, error } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: cardEl }
    });

    if (error) {
      document.getElementById('card-errors').textContent = error.message;
      submitBtn.disabled = false; updateSummary(); return;
    }

    if (paymentIntent.status === 'succeeded') {
      // 3. Record in Supabase
      if (currentItem.supabaseId) {
        try {
          await fetch('/.netlify/functions/shop-place-order', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              payment_intent_id: paymentIntent.id,
              item_id:    currentItem.supabaseId,
              item_slug:  currentItem.slug,
              quantity:   qty,
              buyer_name: name, buyer_email: email,
              buyer_phone: phone, pickup_date: pickupDate, notes,
            })
          });
        } catch(e) { console.warn('Order record failed (payment still succeeded):', e); }
      }

      // 4. Success screen
      document.getElementById('order-form-section').hidden = true;
      const succ = document.getElementById('order-success');
      succ.hidden = false;
      document.getElementById('order-success-msg').textContent =
        'Your order of ' + qty + 'x ' + currentItem.name + ' is confirmed for pickup on ' +
        new Date(pickupDate + 'T12:00:00').toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric'}) +
        ' at 670 4th Ave N, Fargo. A confirmation will be sent to ' + email + '.';
      succ.querySelector('h2').focus();
    }

  } catch(err) {
    console.error(err);
    statusEl.textContent = 'Something went wrong. Please try again or call us at 701-566-3473.';
    statusEl.className   = 'form-status error';
    statusEl.style.display = 'block';
    submitBtn.disabled = false; updateSummary();
  }
});
