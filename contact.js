/* ============================================
   CHEF'S TABLE — Contact Form
   Submits leads directly to Supabase CRM
   ============================================ */

// ============================================================
// CONFIGURATION
// Update SUPABASE_URL and SUPABASE_ANON_KEY when ready
// These should match your GPH Catering CRM Supabase project
// shaqvvvuqxgtkldnzpoh.supabase.co
// ============================================================
const CRM_CONFIG = {
  supabaseUrl:  'https://shaqvvvuqxgtkldnzpoh.supabase.co',
  supabaseKey:  'REPLACE_WITH_SUPABASE_ANON_KEY',  // add your anon key here
  leadsTable:   'leads',   // adjust if your CRM uses a different table name
  company:      'chefs',
};
// ============================================================

document.addEventListener('DOMContentLoaded', function () {
  const form      = document.getElementById('contact-form');
  const statusEl  = document.getElementById('form-status');
  const submitBtn = document.getElementById('submit-btn');
  if (!form) return;

  function showStatus(msg, type) {
    statusEl.textContent = msg;
    statusEl.className   = 'form-status ' + type;
    statusEl.style.display = 'block';
    statusEl.focus();
  }

  function clearErrors() {
    ['first-name', 'last-name', 'email', 'event-type', 'message'].forEach(function (id) {
      const el = document.getElementById(id + '-error');
      if (el) el.textContent = '';
      const input = document.getElementById(id);
      if (input) input.removeAttribute('aria-invalid');
    });
  }

  function setError(id, msg) {
    const errEl = document.getElementById(id + '-error');
    const input = document.getElementById(id);
    if (errEl) errEl.textContent = msg;
    if (input) input.setAttribute('aria-invalid', 'true');
  }

  function validate() {
    let valid = true;
    clearErrors();

    if (!document.getElementById('first-name').value.trim()) {
      setError('first-name', 'Please enter your first name.'); valid = false;
    }
    if (!document.getElementById('last-name').value.trim()) {
      setError('last-name', 'Please enter your last name.'); valid = false;
    }
    const email = document.getElementById('email').value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('email', 'Please enter a valid email address.'); valid = false;
    }
    if (!document.getElementById('event-type').value) {
      setError('event-type', 'Please select an event type.'); valid = false;
    }
    if (!document.getElementById('message').value.trim()) {
      setError('message', 'Please tell us a bit about your event.'); valid = false;
    }
    return valid;
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!validate()) {
      const firstInvalid = form.querySelector('[aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    statusEl.style.display = 'none';

    const eventDate = document.getElementById('event-date').value;

    const leadData = {
      company:      CRM_CONFIG.company,
      first_name:   document.getElementById('first-name').value.trim(),
      last_name:    document.getElementById('last-name').value.trim(),
      email:        document.getElementById('email').value.trim(),
      phone:        document.getElementById('phone').value.trim() || null,
      event_type:   document.getElementById('event-type').value,
      event_date:   eventDate || null,
      guest_count:  parseInt(document.getElementById('guest-count').value) || null,
      venue:        document.getElementById('venue').value.trim() || null,
      notes:        document.getElementById('message').value.trim(),
      lead_source:  'Website Contact Form',
      status:       'new',
      created_at:   new Date().toISOString(),
    };

    try {
      // Submit to Supabase CRM leads table
      const res = await fetch(
        CRM_CONFIG.supabaseUrl + '/rest/v1/' + CRM_CONFIG.leadsTable,
        {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'apikey':        CRM_CONFIG.supabaseKey,
            'Authorization': 'Bearer ' + CRM_CONFIG.supabaseKey,
            'Prefer':        'return=minimal',
          },
          body: JSON.stringify(leadData),
        }
      );

      if (res.ok || res.status === 201) {
        showStatus(
          'Thank you! We received your inquiry and will be in touch within one business day.',
          'success'
        );
        form.reset();
      } else {
        const err = await res.json().catch(() => ({}));
        console.error('Supabase error:', err);
        throw new Error('Submission failed');
      }

    } catch (err) {
      console.error(err);
      showStatus(
        'Something went wrong. Please email us directly at sales@chefstablefargo.com.',
        'error'
      );
    }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Send My Inquiry';
  });
});
