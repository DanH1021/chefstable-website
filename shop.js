/* ============================================
   CHEF'S TABLE - Shop (cart + Stripe Checkout)
   Products, prices and limits come from the shop database
   (/.netlify/functions/shop-inventory). Checkout is created
   server-side (/.netlify/functions/shop-checkout).
   ============================================ */
(function () {
  'use strict';

  var CART_KEY = 'ctc_cart_v1';
  var LAST_KEY = 'ctc_last_order_v1';

  var products = [];
  var bySlug = {};
  var cart = loadCart();          // { slug: qty }
  var pickupDate = '';
  var minPickup = '';
  var taxPercent = 7.75;
  var kitchenPickup = '';

  var productsEl = document.getElementById('shop-products');
  var cartBody   = document.getElementById('cart-body');
  var mobileBar  = document.getElementById('mobile-cart-bar');
  var mobileSum  = document.getElementById('mobile-cart-summary');

  // ---------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(cents) { return '$' + (cents / 100).toFixed(2); }
  function longDate(ymd) {
    if (!ymd) return '';
    return new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function deadlineText(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
  }
  function eventPickup(p) {
    return [longDate(p.pickup_date), p.pickup_window, p.pickup_location].filter(Boolean).join(', ');
  }
  function store(key, val) {
    try { if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function loadCart() {
    try { var c = JSON.parse(localStorage.getItem(CART_KEY) || '{}'); return (c && typeof c === 'object') ? c : {}; }
    catch (e) { return {}; }
  }
  function saveCart() { store(CART_KEY, cart); }

  // ---------------------------------------------------------- success banner
  function showSuccess() {
    var params = new URLSearchParams(location.search);
    if (params.get('order') !== 'success') return;
    var last = null;
    try { last = JSON.parse(sessionStorage.getItem(LAST_KEY) || 'null'); } catch (e) {}
    cart = {}; saveCart();
    try { sessionStorage.removeItem(LAST_KEY); } catch (e) {}

    var box = document.getElementById('order-success');
    var html = '<h2>Thank you! Your order is in.</h2>';
    if (last && last.lines && last.lines.length) {
      html += '<p><strong>' + esc(last.lines.join(', ')) + '</strong></p>';
    }
    if (last && last.pickup) html += '<p>Pickup: ' + esc(last.pickup) + '</p>';
    html += '<p>A receipt is on its way to your email from Stripe. Questions? Call <a href="tel:7015663473">701-566-3473</a>.</p>';
    box.innerHTML = html;
    box.hidden = false;
    history.replaceState(null, '', location.pathname);
    setTimeout(function () { box.focus(); }, 50);
  }

  // ---------------------------------------------------------- products
  function renderProducts() {
    if (!products.length) {
      productsEl.innerHTML = '<p class="shop-loading">No items are available right now. Check back soon!</p>';
      return;
    }
    productsEl.innerHTML = products.map(function (p) {
      var isEvent = p.pickup_mode === 'event';
      var art = p.image_url
        ? '<img src="' + esc(p.image_url) + '" alt="">'
        : '<span aria-hidden="true">' + esc(p.icon || '') + '</span>';

      var details = (p.details || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
      var detailsHtml = details.length
        ? '<ul class="product-details" aria-label="What\u2019s included">' + details.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>'
        : '';

      var meta = isEvent
        ? '<p><strong>Pickup:</strong> ' + esc(eventPickup(p)) + '</p>' +
          (p.order_deadline ? '<p><strong>Order by:</strong> ' + esc(deadlineText(p.order_deadline)) + '</p>' : '')
        : '<p><strong>Pickup:</strong> Weekdays at our kitchen, 670 4th Ave N, Fargo. 48 hours notice.</p>' +
          '<p>Ordering with a holiday kit? It comes with your kit pickup.</p>';

      var badge = '';
      if (p.status === 'closed') badge = '<span class="product-badge badge-closed">Ordering closed</span>';
      else if (p.status === 'sold_out') badge = '<span class="product-badge badge-closed">Sold out</span>';
      else if (p.limited) badge = '<span class="product-badge badge-limited">Limited quantity</span>';

      var buy;
      if (p.status === 'open') {
        var opts = '';
        for (var i = 1; i <= p.max_per_order; i++) opts += '<option value="' + i + '">' + i + '</option>';
        buy = '<label class="sr-only" for="qty-' + esc(p.slug) + '">Quantity of ' + esc(p.name) + '</label>' +
          '<select id="qty-' + esc(p.slug) + '">' + opts + '</select>' +
          '<button type="button" class="btn btn-primary" data-add="' + esc(p.slug) + '">Add to Order</button>' +
          '<span class="added-note" id="added-' + esc(p.slug) + '" aria-live="polite"></span>';
      } else {
        buy = '<button type="button" class="btn btn-primary" disabled>' + (p.status === 'closed' ? 'Ordering Closed' : 'Sold Out') + '</button>';
      }

      return '<article class="product' + (isEvent ? ' is-event' : '') + '" id="' + esc(p.slug) + '" aria-labelledby="h-' + esc(p.slug) + '">' +
        '<div class="product-art">' + art + '</div>' +
        '<div class="product-body">' +
          badge +
          '<h3 id="h-' + esc(p.slug) + '">' + esc(p.name) + '</h3>' +
          (p.description ? '<p class="product-desc">' + esc(p.description) + '</p>' : '') +
          detailsHtml +
          '<div class="product-meta">' + meta + '</div>' +
          '<div class="product-buy">' +
            '<div class="product-price">' + money(p.price_cents) + '<small>' + (p.taxable ? 'plus sales tax' : 'no sales tax') + '</small></div>' +
            buy +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  productsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-add]');
    if (!btn) return;
    var slug = btn.getAttribute('data-add');
    var p = bySlug[slug];
    if (!p) return;
    var qty = parseInt(document.getElementById('qty-' + slug).value, 10) || 1;
    cart[slug] = Math.min((cart[slug] || 0) + qty, p.max_per_order);
    saveCart();
    renderCart();
    var note = document.getElementById('added-' + slug);
    if (note) {
      note.textContent = 'Added to your order';
      setTimeout(function () { note.textContent = ''; }, 2500);
    }
  });

  // ---------------------------------------------------------- cart
  function cartLines() {
    return Object.keys(cart).filter(function (s) { return bySlug[s] && cart[s] > 0; }).map(function (s) {
      return { p: bySlug[s], qty: cart[s] };
    });
  }

  function reconcileCart() {
    Object.keys(cart).forEach(function (s) {
      var p = bySlug[s];
      if (!p || p.status !== 'open') { delete cart[s]; return; }
      cart[s] = Math.max(1, Math.min(parseInt(cart[s], 10) || 1, p.max_per_order));
    });
    saveCart();
  }

  function renderCart() {
    var lines = cartLines();
    if (!lines.length) {
      cartBody.innerHTML = '<p class="cart-empty">Your order is empty. Add an item to get started.</p>';
      mobileBar.hidden = true;
      document.body.classList.remove('has-cart-bar');
      return;
    }

    var subtotal = 0, tax = 0, count = 0;
    var html = '';
    lines.forEach(function (l) {
      var lineTotal = l.p.price_cents * l.qty;
      subtotal += lineTotal;
      count += l.qty;
      if (l.p.taxable) tax += Math.round(lineTotal * taxPercent / 100);
      html += '<div class="cart-line">' +
        '<span class="cart-line-name">' + esc(l.p.name) + '</span>' +
        '<span class="cart-line-price">' + money(lineTotal) + '</span>' +
        '<div class="cart-line-ctrl">' +
          '<button type="button" class="qty-btn" data-dec="' + esc(l.p.slug) + '" aria-label="One fewer ' + esc(l.p.name) + '"' + (l.qty <= 1 ? ' disabled' : '') + '>&minus;</button>' +
          '<span class="qty-num" aria-label="Quantity">' + l.qty + '</span>' +
          '<button type="button" class="qty-btn" data-inc="' + esc(l.p.slug) + '" aria-label="One more ' + esc(l.p.name) + '"' + (l.qty >= l.p.max_per_order ? ' disabled' : '') + '>+</button>' +
          '<span style="font-size:.8rem;color:var(--gray);">' + money(l.p.price_cents) + ' each</span>' +
          '<button type="button" class="remove-btn" data-remove="' + esc(l.p.slug) + '">Remove<span class="sr-only"> ' + esc(l.p.name) + '</span></button>' +
        '</div>' +
      '</div>';
    });

    html += '<div class="cart-sum">' +
      '<div><span>Subtotal</span><span>' + money(subtotal) + '</span></div>' +
      (tax ? '<div><span>Sales tax (' + taxPercent + '%)</span><span>' + money(tax) + '</span></div>' : '') +
      '<div class="total"><span>Total</span><span>' + money(subtotal + tax) + '</span></div>' +
    '</div>';

    // Pickup
    var events = lines.filter(function (l) { return l.p.pickup_mode === 'event'; });
    var eventTexts = events.map(function (l) { return eventPickup(l.p); }).filter(function (t, i, a) { return a.indexOf(t) === i; });
    var problem = '';
    if (eventTexts.length > 1) {
      problem = 'These items have different pickup days. Please check out with one of them, then place a second order for the other.';
    }

    html += '<div class="cart-pickup"><h3>Pickup</h3>';
    if (events.length) {
      html += '<p>' + esc(eventTexts[0]) + '</p>';
      if (lines.length > events.length) html += '<p>Everything in this order is picked up together.</p>';
    } else {
      html += '<p>Weekdays at our kitchen, ' + esc(kitchenPickup) + '. Please allow 48 hours.</p>' +
        '<label for="pickup-date">Pickup date</label>' +
        '<input type="date" id="pickup-date" min="' + esc(minPickup) + '" value="' + esc(pickupDate) + '">';
    }
    html += '</div>';

    html += '<div id="cart-error" class="cart-error" role="alert"' + (problem ? '' : ' hidden') + '>' + esc(problem) + '</div>';
    html += '<button type="button" class="btn btn-primary btn-large btn-checkout" id="checkout-btn"' + (problem ? ' disabled' : '') + '>Checkout</button>';
    html += '<p class="cart-note">Secure payment through Stripe. You&rsquo;ll enter your contact info and any special requests on the next page.</p>';

    cartBody.innerHTML = html;
    mobileSum.textContent = count + (count === 1 ? ' item' : ' items') + ' \u00b7 ' + money(subtotal + tax);
    mobileBar.hidden = false;
    document.body.classList.add('has-cart-bar');
  }

  cartBody.addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t) return;
    var s;
    if ((s = t.getAttribute('data-inc'))) { cart[s] = Math.min((cart[s] || 0) + 1, bySlug[s].max_per_order); }
    else if ((s = t.getAttribute('data-dec'))) { cart[s] = Math.max((cart[s] || 1) - 1, 1); }
    else if ((s = t.getAttribute('data-remove'))) { delete cart[s]; }
    else if (t.id === 'checkout-btn') { checkout(t); return; }
    else return;
    saveCart();
    renderCart();
  });

  cartBody.addEventListener('change', function (e) {
    if (e.target.id !== 'pickup-date') return;
    var v = e.target.value;
    var err = '';
    if (v) {
      var day = new Date(v + 'T12:00:00').getDay();
      if (day === 0 || day === 6) err = 'Pickup is weekdays only. Please choose a weekday.';
      else if (v < minPickup) err = 'Please allow 48 hours. The earliest pickup is ' + longDate(minPickup) + '.';
    }
    pickupDate = err ? '' : v;
    if (err) e.target.value = '';
    showError(err);
  });

  function showError(msg) {
    var el = document.getElementById('cart-error');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function checkout(btn) {
    var lines = cartLines();
    if (!lines.length) return;
    var hasEvent = lines.some(function (l) { return l.p.pickup_mode === 'event'; });
    if (!hasEvent && !pickupDate) {
      showError('Please choose a pickup date.');
      var input = document.getElementById('pickup-date');
      if (input) input.focus();
      return;
    }
    showError('');
    btn.disabled = true;
    btn.textContent = 'Opening secure checkout...';

    var pickupText = hasEvent
      ? eventPickup(lines.filter(function (l) { return l.p.pickup_mode === 'event'; })[0].p)
      : longDate(pickupDate) + ', ' + kitchenPickup;
    try {
      sessionStorage.setItem(LAST_KEY, JSON.stringify({
        lines: lines.map(function (l) { return l.qty + ' \u00d7 ' + l.p.name; }),
        pickup: pickupText,
      }));
    } catch (e) {}

    fetch('/.netlify/functions/shop-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: lines.map(function (l) { return { slug: l.p.slug, qty: l.qty }; }),
        pickup_date: hasEvent ? '' : pickupDate,
      }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d.url) throw new Error(res.d.error || 'Could not start checkout.');
        window.location.href = res.d.url;
      })
      .catch(function (err) {
        var msg = err.message + ' If this keeps happening, call 701-566-3473.';
        // Refresh products in case something sold out, then show the message again.
        loadProducts().then(function () { showError(msg); });
      });
  }

  // ---------------------------------------------------------- load
  function focusRequested() {
    var params = new URLSearchParams(location.search);
    var slug = params.get('item') || (location.hash ? decodeURIComponent(location.hash.slice(1)) : '');
    if (!slug || !bySlug[slug]) return;
    var el = document.getElementById(slug);
    if (!el) return;
    el.classList.add('highlight');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { el.classList.remove('highlight'); }, 4000);
  }

  function loadProducts() {
    return fetch('/.netlify/functions/shop-inventory', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (data) {
        products = data.items || [];
        bySlug = {};
        products.forEach(function (p) { bySlug[p.slug] = p; });
        minPickup = data.min_pickup_date || '';
        taxPercent = data.tax_percent || 7.75;
        kitchenPickup = data.kitchen_pickup || '670 4th Ave N, Fargo, ND';
        if (pickupDate && pickupDate < minPickup) pickupDate = '';
        reconcileCart();
        renderProducts();
        renderCart();
      })
      .catch(function () {
        productsEl.innerHTML = '<p class="shop-loading">We couldn&rsquo;t load the shop right now. Please refresh, or call <a href="tel:7015663473">701-566-3473</a> to order.</p>';
      });
  }

  showSuccess();
  loadProducts().then(focusRequested);
})();
