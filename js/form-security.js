// Shared delivery and abuse metadata for the public forms. No secrets in browsers.
(() => {
  const startedAt = Date.now();
  const session = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const install = root => {
    if (!root || root.querySelector('[name="website"]')) return;
    const trap = document.createElement('input');
    trap.name = 'website'; trap.type = 'text'; trap.autocomplete = 'off'; trap.tabIndex = -1;
    trap.hidden = true; trap.setAttribute('aria-hidden', 'true');
    root.appendChild(trap);
  };
  const setup = () => {
    document.querySelectorAll('#email-signup, #finance-survey, #app-feedback-form, .ux-rail').forEach(install);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup); else setup();
  window.LightningForms = {
    async send(endpoint, values, root) {
      install(root);
      const body = new URLSearchParams(values);
      body.set('website', root?.querySelector('[name="website"]')?.value || '');
      body.set('form_session', session);
      body.set('started_at', String(startedAt));
      if (Date.now() - startedAt < 800) await new Promise(resolve => setTimeout(resolve, 800 - (Date.now() - startedAt)));
      const response = await fetch(endpoint, { method: 'POST', body, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      if (!response.ok) throw new Error('Submission failed');
      const result = await response.json();
      // A duplicate has already been admitted recently; do not create another row.
      if (!result.ok && result.error !== 'duplicate_submission') throw new Error('Submission refused');
      return result;
    }
  };
})();
