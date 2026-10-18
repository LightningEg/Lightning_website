(() => {
  const body = document.body;
  const endpoint = body.dataset.uxEndpoint;
  const experienceVersion = body.dataset.uxVersion;
  const content = [...document.querySelectorAll('main > header, main > section')];
  if (!endpoint || !experienceVersion || !content.length) return;

  const sessionKey = 'lightning-ux-session';
  let sessionId = sessionStorage.getItem(sessionKey);
  if (!sessionId) { sessionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; sessionStorage.setItem(sessionKey, sessionId); }
  const feedback = new Map();
  const reasons = ['Too long', 'Too short', 'Too vague', 'Too complicated', 'Hard to scan', 'Not relevant', 'Too salesy', 'Didn’t feel credible', 'Visuals distracted', 'I expected something else', 'Other'];
  const sections = content.map((element, index) => ({
    element,
    id: element.id || `section-${index + 1}`,
    title: (element.querySelector('h1,h2,h3')?.innerText || element.querySelector('h1,h2,h3')?.textContent || `Section ${index + 1}`).replace(/\s+/g, ' ').trim()
  }));
  let active = sections[0];

  const rail = document.createElement('aside');
  rail.className = 'ux-rail';
  rail.setAttribute('aria-label', 'UX feedback');
  rail.innerHTML = `<div class="ux-rail__top"><div><p class="ux-rail__eyebrow">Quick UX test</p><h2 class="ux-rail__title">Help shape this page</h2></div><div class="ux-rail__actions"><button class="ux-rail__reset" type="button">Reset</button><button class="ux-rail__close" type="button" aria-label="Close UX test">×</button></div></div><div class="ux-rail__divider"></div><p class="ux-rail__prompt">Did this section work for you?<span class="ux-rail__section"></span></p><div class="ux-rail__sections" aria-label="Choose a section"></div><div class="ux-rail__reactions"><button class="ux-rail__reaction" type="button" data-reaction="liked">Liked it</button><button class="ux-rail__reaction" type="button" data-reaction="needs-work">Needs work</button></div><div class="ux-rail__reason-wrap"><p class="ux-rail__hint">What got in the way? Pick any that fit.</p><div class="ux-rail__reasons"></div><textarea class="ux-rail__other" rows="2" maxlength="280" placeholder="Tell us what was missing"></textarea></div><p class="ux-rail__progress"></p><button class="ux-rail__submit" type="button">Submit UX test</button><p class="ux-rail__status" role="status"></p>`;
  document.body.append(rail);

  const sectionLabel = rail.querySelector('.ux-rail__section');
  const sectionPicker = rail.querySelector('.ux-rail__sections');
  const reactions = [...rail.querySelectorAll('[data-reaction]')];
  const reasonWrap = rail.querySelector('.ux-rail__reason-wrap');
  const reasonList = rail.querySelector('.ux-rail__reasons');
  const other = rail.querySelector('.ux-rail__other');
  const progress = rail.querySelector('.ux-rail__progress');
  const status = rail.querySelector('.ux-rail__status');
  const submit = rail.querySelector('.ux-rail__submit');
  const reset = rail.querySelector('.ux-rail__reset');
  sections.forEach((section, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ux-rail__section-button'; button.dataset.sectionId = section.id;
    button.textContent = index + 1; button.setAttribute('aria-label', `Go to section ${index + 1}: ${section.title}`);
    sectionPicker.append(button);
  });
  reasons.forEach(reason => { const button = document.createElement('button'); button.type = 'button'; button.className = 'ux-rail__reason'; button.dataset.reason = reason; button.textContent = reason; reasonList.append(button); });

  function currentFeedback() { return feedback.get(active.id) || { id: active.id, title: active.title, reaction: '', reasons: [], other: '' }; }
  function render() {
    const item = currentFeedback();
    sectionLabel.textContent = active.title;
    [...sectionPicker.children].forEach(button => {
      const selected = button.dataset.sectionId === active.id;
      button.classList.toggle('is-active', selected);
      button.classList.toggle('is-rated', feedback.has(button.dataset.sectionId));
      button.setAttribute('aria-current', selected ? 'step' : 'false');
    });
    reactions.forEach(button => button.classList.toggle('is-selected', button.dataset.reaction === item.reaction));
    rail.classList.toggle('is-dislike', item.reaction === 'needs-work');
    reasonWrap.hidden = item.reaction !== 'needs-work';
    [...reasonList.children].forEach(button => button.classList.toggle('is-selected', item.reasons.includes(button.dataset.reason)));
    other.classList.toggle('is-visible', item.reasons.includes('Other'));
    other.value = item.other || '';
    const count = feedback.size;
    progress.innerHTML = `<b>${count}/${sections.length}</b> sections rated${count ? ' · Nice, keep going if you have a minute.' : ' · Start with the section you are reading.'}`;
    document.querySelectorAll('[data-ux-count]').forEach(counter => { counter.textContent = count; });
  }
  function save(item) { feedback.set(active.id, item); render(); }
  reactions.forEach(button => button.addEventListener('click', () => {
    const item = currentFeedback();
    item.reaction = button.dataset.reaction;
    if (item.reaction !== 'needs-work') { item.reasons = []; item.other = ''; }
    save(item);
  }));
  reasonList.addEventListener('click', event => {
    const button = event.target.closest('[data-reason]'); if (!button) return;
    const item = currentFeedback(); const reason = button.dataset.reason;
    item.reasons = item.reasons.includes(reason) ? item.reasons.filter(value => value !== reason) : [...item.reasons, reason];
    if (!item.reasons.includes('Other')) item.other = '';
    save(item);
  });
  other.addEventListener('input', () => { const item = currentFeedback(); item.other = other.value.trim(); feedback.set(active.id, item); });
  sectionPicker.addEventListener('click', event => {
    const button = event.target.closest('[data-section-id]'); if (!button) return;
    const next = sections.find(section => section.id === button.dataset.sectionId); if (!next) return;
    active = next; active.element.scrollIntoView({ behavior: 'smooth', block: 'start' }); render();
  });
  function open() { rail.classList.add('is-open'); render(); }
  document.querySelectorAll('[data-ux-open]').forEach(trigger => trigger.addEventListener('click', open));
  rail.querySelector('.ux-rail__close').addEventListener('click', () => rail.classList.remove('is-open'));
  reset.addEventListener('click', () => { feedback.clear(); status.textContent = 'Ratings cleared. You can start again.'; render(); });

  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    const next = sections.find(section => section.element === visible.target);
    if (next && next !== active) { active = next; render(); }
  }, { rootMargin: '-26% 0px -48% 0px', threshold: [0.05, 0.2, 0.5] });
  sections.forEach(section => observer.observe(section.element));

  submit.addEventListener('click', async () => {
    const rows = [...feedback.values()].filter(item => item.reaction).map(item => ({ ...item, reasons: item.reasons.map(reason => reason === 'Other' && item.other ? `Other: ${item.other}` : reason) }));
    if (!rows.length) { status.textContent = 'Rate at least one section before you submit.'; return; }
    submit.disabled = true; status.textContent = 'Sending your feedback…';
    try {
      const payload = new URLSearchParams({ form_type: 'ux_test', experience_version: experienceVersion, page_url: location.href, session_id: sessionId, device: matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop', feedback_json: JSON.stringify(rows) });
      await window.LightningForms.send(endpoint, payload, rail);
      feedback.clear(); render(); status.textContent = 'Thank you — your feedback has been saved.';
    } catch (_) { status.textContent = 'We could not save that just now. Please try again.'; }
    finally { submit.disabled = false; }
  });
  render();
})();
