// Lightning testing panel: the release ID, the version archive and the feedback buttons, in one fold-out on the right edge.
// Load with `defer` BEFORE js/ux-test.js, so the UX button exists when that script wires it up.
(() => {
  // One live landing page: Home is always index.html. Archived versions are on versions.html.
  const home = 'index.html';
  try { sessionStorage.setItem('lightning-home', home); } catch (_) {}

  document.querySelectorAll('[data-home-link]').forEach(link => { link.href = home; });

  // On lightningeg.com the tab is for testers only: open any page once with ?testing (remembered; ?testing=off hides it).
  // Previews and local copies always show it (README › Header and testing panel).
  let tester = false;
  try {
    const flag = new URLSearchParams(location.search).get('testing');
    if (flag !== null) localStorage.setItem('lightning-tester', flag === 'off' ? '0' : '1');
    tester = localStorage.getItem('lightning-tester') === '1';
  } catch (_) {}
  if (/(^|\.)lightningeg\.com$/.test(location.hostname) && !tester) return;

  const dock = document.createElement('div');
  dock.className = 'dev-dock';
  const hasUx = Boolean(document.body.dataset.uxEndpoint);
  const releaseId = document.body.dataset.uxVersion || 'Unversioned';
  dock.innerHTML = `
    <button class="dev-dock__tab" type="button" aria-expanded="false" aria-controls="dev-dock-panel">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>
      <span>Testing</span>
    </button>
    <div class="dev-dock__panel" id="dev-dock-panel" role="dialog" aria-label="Testing tools" hidden>
      <div class="dev-dock__head"><p class="dev-dock__title">Testing tools</p><button class="dev-dock__close" type="button" aria-label="Close testing tools">×</button></div>
      <p class="dev-dock__label">This page</p>
      <a class="dev-dock__release" href="versions.html#${encodeURIComponent(releaseId)}"><span>Release ID</span><b>${releaseId}</b></a>
      <p class="dev-dock__label">Feedback</p>
      ${hasUx ? '<button class="dev-dock__ux" type="button" data-ux-open>Submit UX Test <span data-ux-count>0</span></button>' : ''}
      <a class="dev-dock__app-feedback" href="app-feedback.html">Submit app feedback</a>
    </div>`;
  document.body.append(dock);

  const tab = dock.querySelector('.dev-dock__tab');
  const panel = dock.querySelector('.dev-dock__panel');
  const setOpen = open => { panel.hidden = !open; tab.setAttribute('aria-expanded', String(open)); };
  tab.addEventListener('click', () => setOpen(panel.hidden));
  dock.querySelector('.dev-dock__close').addEventListener('click', () => { setOpen(false); tab.focus(); });
  dock.querySelector('[data-ux-open]')?.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { setOpen(false); tab.focus(); } });
  document.addEventListener('click', event => { if (!panel.hidden && !dock.contains(event.target)) setOpen(false); });
})();
