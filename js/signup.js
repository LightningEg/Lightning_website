// The signup band's email form, for pages whose main script doesn't already handle it (guideline 3.20).
(() => {
  const ar = document.documentElement.lang.startsWith('ar');
  const signup = document.getElementById('email-signup');
  if (!signup || signup.dataset.bound) return;
  signup.dataset.bound = '1';
  const status = document.getElementById('signup-status');
  signup.addEventListener('submit', async event => {
    event.preventDefault();
    if (!signup.reportValidity()) return;
    const button = signup.querySelector('button[type="submit"]');
    button.disabled = true; status.classList.remove('is-error'); status.textContent = (ar ? 'بنبعت…' : 'Sending…');
    try {
      signup.querySelector('[name="page_url"]').value = window.location.href;
      await window.LightningForms.send(signup.dataset.endpoint, new URLSearchParams(new FormData(signup)), signup);
      signup.reset(); status.textContent = (ar ? 'اتسجلت معانا. هنكلمك قريب.' : 'You’re on the list. We’ll be in touch.');
    } catch (_) {
      status.classList.add('is-error'); status.textContent = (ar ? 'معرفناش نحفظ إيميلك. جرّب تاني.' : 'We could not save your email. Please try again.');
    } finally { button.disabled = false; }
  });
})();
