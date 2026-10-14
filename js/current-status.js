(() => {
  const form = document.getElementById('app-feedback-form');
  const template = document.getElementById('ticket-template');
  const list = document.querySelector('[data-ticket-list]');
  const add = document.querySelector('[data-add-ticket]');
  const status = document.querySelector('.status-feedback__status');
  const endpoint = document.body.dataset.appFeedbackEndpoint;
  if (!form || !template || !list || !add || !endpoint) return;

  const AR = document.documentElement.lang.startsWith('ar');
  let sending = 0;
  const AR_TEXT = {"Preparing image…": "بنجهّز الصورة…", "Remove": "احذف", "A ticket can have up to five images.": "البلاغ الواحد ممكن يحتوي على ٥ صور بالكتير.", "A submission can include up to ten images in total.": "الإرسال الواحد ممكن يحتوي على ١٠ صور بالكتير.", "Choose a PNG, JPEG or WebP image.": "اختار صورة PNG أو JPEG أو WebP.", "Still preparing; you can keep filling in the form.": "لسه بنجهّز الصورة، كمّل ملا النموذج عادي.", "This image is over 5 MB and cannot be made smaller without losing quality. Crop the screenshot to the relevant area, then try again.": "الصورة أكبر من ٥ ميجا ومينفعش نصغّرها من غير ما الجودة تقل. اقتطع الجزء المهم من الصورة وجرّب تاني.", "The images in one submission must total 12 MB or less.": "مجموع الصور في الإرسال الواحد لازم يكون ١٢ ميجا أو أقل.", "This image could not be prepared. Try another image.": "معرفناش نجهّز الصورة دي. جرّب صورة تانية.", "Wait for the images to finish preparing before you submit.": "استنى لحد ما الصور تخلّص تجهيز قبل ما تبعت.", "Remove or replace the image that could not be prepared before you submit.": "احذف الصورة اللي معرفناش نجهّزها أو بدّلها قبل ما تبعت.", "Sending your ticket and images…": "بنبعت البلاغ والصور…", "Thank you — your feedback and images have been sent.": "شكرًا ليك، ملاحظاتك وصورك وصلتنا.", "We could not send that just now. Your ticket and images are still here; please try again.": "معرفناش نبعت دلوقتي. البلاغ والصور لسه قدامك، جرّب تاني.", "ready to send": "جاهزة للإرسال", "Sending in the background. You can write the next ticket; keep this page open until it says sent.": "بنبعت في الخلفية. تقدر تكتب البلاغ اللي بعده؛ سيب الصفحة مفتوحة لحد ما تقول إنه اتبعت.", "Sending your ticket…": "بنبعت البلاغ…"};
  const t = text => (AR && AR_TEXT[text]) || text;
  const arNum = n => AR ? new Intl.NumberFormat('ar-EG').format(n) : String(n);

  const MAX_PER_TICKET = 5;
  const MAX_TOTAL_ATTACHMENTS = 10;
  const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
  const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
  const MAX_DECODED_PNG_BYTES = 64 * 1024 * 1024;
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
  const ticketAttachments = new WeakMap();
  const pngCrcTable = Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    return crc >>> 0;
  });
  const experiences = { 'index.html': 'UX-2026.10.05.01' };
  let sourcePage = 'index.html';
  try { sourcePage = sessionStorage.getItem('lightning-home') || sourcePage; } catch (_) {}
  const sessionKey = 'lightning-app-feedback-session';
  let sessionId = '';
  try { sessionId = sessionStorage.getItem(sessionKey) || ''; if (!sessionId) { sessionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; sessionStorage.setItem(sessionKey, sessionId); } } catch (_) { sessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

  function allAttachments() { return [...list.children].flatMap(ticket => ticketAttachments.get(ticket) || []); }
  function cleanupTicket(ticket) {
    (ticketAttachments.get(ticket) || []).forEach(item => { item.cancelled = true; clearTimeout(item.slowTimer); URL.revokeObjectURL(item.previewUrl); });
    ticketAttachments.delete(ticket);
  }
  function addTicket() {
    const node = template.content.firstElementChild.cloneNode(true);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    node.querySelectorAll('[name="type"]').forEach(input => { input.name = `type-${id}`; });
    node.querySelectorAll('[name="area"]').forEach(input => { input.name = `area-${id}`; });
    ticketAttachments.set(node, []);
    list.append(node);
    numberTickets();
  }
  function numberTickets() {
    [...list.children].forEach((ticket, index) => {
      ticket.querySelector('[data-ticket-number]').textContent = AR ? new Intl.NumberFormat('ar-EG',{useGrouping:false}).format(index + 1) : index + 1;
      ticket.querySelector('[data-remove-ticket]').hidden = list.children.length === 1;
    });
  }
  function readTickets() {
    return [...list.children].map(ticket => ({
      section: ticket.querySelector('[name="section"]').value,
      type: ticket.querySelector('input[name^="type-"]:checked')?.value || '',
      area: ticket.querySelector('input[name^="area-"]:checked')?.value || '',
      description: ticket.querySelector('[name="description"]').value.trim(),
      attachments: (ticketAttachments.get(ticket) || []).map(item => item.payload)
    }));
  }
  function renderAttachments(ticket) {
    const host = ticket.querySelector('[data-attachment-list]');
    host.replaceChildren();
    (ticketAttachments.get(ticket) || []).forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'status-attachment';
      const image = document.createElement('img');
      image.src = item.previewUrl;
      image.alt = '';
      const meta = document.createElement('span');
      meta.className = 'status-attachment__meta';
      const name = document.createElement('span');
      name.className = 'status-attachment__name';
      name.textContent = item.file.name;
      const state = document.createElement('span');
      state.className = 'status-attachment__state';
      state.dataset.state = item.state;
      state.textContent = item.message || (item.state === 'ready' ? `${formatSize(item.file.size)} · ${t('ready to send')}` : t('Preparing image…'));
      meta.append(name, state);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'status-attachment__remove';
      remove.dataset.removeAttachment = String(index);
      remove.setAttribute('aria-label', `${t('Remove')} ${item.file.name}`);
      remove.textContent = t('Remove');
      row.append(image, meta, remove);
      host.append(row);
    });
  }
  function formatSize(bytes) { return bytes < 1024 * 1024 ? `${arNum(Math.max(1, Math.round(bytes / 1024)))} ${AR ? 'ك.ب' : 'KB'}` : `${arNum(+(bytes / (1024 * 1024)).toFixed(1))} ${AR ? 'م.ب' : 'MB'}`; }
  function totalBytes() { return allAttachments().reduce((sum, item) => sum + (item.state !== 'error' ? item.preparedSize || 0 : 0), 0); }
  function pngChunk(type, data) {
    const typeBytes = new TextEncoder().encode(type);
    const chunk = new Uint8Array(12 + data.length);
    new DataView(chunk.buffer).setUint32(0, data.length);
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);
    let crc = 0xffffffff;
    for (let index = 4; index < 8 + data.length; index++) {
      crc = pngCrcTable[(crc ^ chunk[index]) & 255] ^ (crc >>> 8);
    }
    new DataView(chunk.buffer).setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
    return chunk;
  }
  async function recompressPng(file) {
    if (file.size < 512 * 1024 || typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') return file;
    const source = new Uint8Array(await file.arrayBuffer());
    const signature = source.subarray(0, 8);
    if (signature.join(',') !== '137,80,78,71,13,10,26,10') return file;
    const pieces = [];
    const idatParts = [];
    const idatMarker = {};
    let idatBytes = 0;
    let idatAdded = false;
    let offset = 8;
    let hasEnd = false;
    while (offset + 12 <= source.length) {
      const length = new DataView(source.buffer, source.byteOffset + offset, 4).getUint32(0);
      const end = offset + 12 + length;
      if (end > source.length) return file;
      const type = String.fromCharCode(...source.subarray(offset + 4, offset + 8));
      if (type === 'IDAT') {
        if (!idatAdded) { pieces.push(idatMarker); idatAdded = true; }
        const part = source.slice(offset + 8, offset + 8 + length);
        idatParts.push(part);
        idatBytes += part.length;
      } else {
        pieces.push(source.slice(offset, end));
      }
      offset = end;
      if (type === 'IEND') { hasEnd = true; break; }
    }
    if (!hasEnd || offset !== source.length || !idatAdded) return file;
    const compressedImage = new Uint8Array(idatBytes);
    let cursor = 0;
    idatParts.forEach(part => { compressedImage.set(part, cursor); cursor += part.length; });
    const transform = async (bytes, Stream, limit) => {
      const reader = new Blob([bytes]).stream().pipeThrough(new Stream('deflate')).getReader();
      const parts = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) { await reader.cancel(); return null; }
        parts.push(value);
      }
      const output = new Uint8Array(length);
      let position = 0;
      parts.forEach(part => { output.set(part, position); position += part.length; });
      return output;
    };
    let optimized;
    try {
      const pixels = await transform(compressedImage, DecompressionStream, MAX_DECODED_PNG_BYTES);
      if (!pixels) return file;
      optimized = await transform(pixels, CompressionStream, MAX_DECODED_PNG_BYTES);
      if (!optimized) return file;
    } catch (_) { return file; }
    if (optimized.length >= idatBytes) return file;
    const idat = pngChunk('IDAT', optimized);
    const output = [signature, ...pieces.map(piece => piece === idatMarker ? idat : piece)];
    const blob = new Blob(output, { type: 'image/png' });
    return blob.size < file.size ? new File([blob], file.name, { type: 'image/png', lastModified: file.lastModified }) : file;
  }
  async function optimize(file) {
    if (file.type === 'image/png') return recompressPng(file);
    return file;
  }
  async function fileAsBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  }
  async function addFiles(ticket, files) {
    const picked = [...files].filter(Boolean);
    if (!picked.length) return;
    const items = ticketAttachments.get(ticket) || [];
    if (items.length + picked.length > MAX_PER_TICKET) { status.textContent = t('A ticket can have up to five images.'); return; }
    if (allAttachments().length + picked.length > MAX_TOTAL_ATTACHMENTS) { status.textContent = t('A submission can include up to ten images in total.'); return; }
    const pending = [];
    for (const file of picked) {
      if (!allowedTypes.has(file.type)) { status.textContent = t('Choose a PNG, JPEG or WebP image.'); continue; }
      if (file.size > MAX_SOURCE_BYTES) { status.textContent = `${file.name} is too large to process here. Choose an image under 10 MB.`; continue; }
      const item = { file, state: 'processing', previewUrl: URL.createObjectURL(file), message: '', payload: null, preparedSize: 0, slowTimer: 0, cancelled: false };
      items.push(item);
      pending.push(item);
    }
    ticketAttachments.set(ticket, items);
    renderAttachments(ticket);
    async function prepareItem(item) {
      if (item.cancelled) return;
      item.slowTimer = setTimeout(() => { if (item.state === 'processing') { item.message = t('Still preparing; you can keep filling in the form.'); renderAttachments(ticket); } }, 10000);
      try {
        const optimized = await optimize(item.file);
        if (item.cancelled) return;
        item.preparedSize = optimized.size;
        if (optimized.size > MAX_ATTACHMENT_BYTES) throw new Error(t('This image is over 5 MB and cannot be made smaller without losing quality. Crop the screenshot to the relevant area, then try again.'));
        if (totalBytes() > MAX_TOTAL_BYTES) throw new Error(t('The images in one submission must total 12 MB or less.'));
        item.file = optimized;
        item.payload = { name: optimized.name, mime: optimized.type, base64: await fileAsBase64(optimized) };
        if (item.cancelled) return;
        item.state = 'ready';
      } catch (error) {
        if (item.cancelled) return;
        item.state = 'error';
        item.message = error.message || t('This image could not be prepared. Try another image.');
      } finally {
        clearTimeout(item.slowTimer);
        if (!item.cancelled) renderAttachments(ticket);
      }
    }
    for (let offset = 0; offset < pending.length; offset += 2) await Promise.all(pending.slice(offset, offset + 2).map(prepareItem));
  }
  add.addEventListener('click', addTicket);
  list.addEventListener('click', event => {
    const ticket = event.target.closest('.status-ticket');
    if (!ticket) return;
    if (event.target.closest('[data-remove-ticket]')) { cleanupTicket(ticket); ticket.remove(); numberTickets(); }
    if (event.target.closest('[data-attach-trigger]')) ticket.querySelector('[data-attachment-input]').click();
    const remove = event.target.closest('[data-remove-attachment]');
    if (remove) {
      const items = ticketAttachments.get(ticket) || [];
      const index = Number(remove.dataset.removeAttachment);
      const [item] = items.splice(index, 1);
      if (item) { item.cancelled = true; clearTimeout(item.slowTimer); URL.revokeObjectURL(item.previewUrl); }
      renderAttachments(ticket);
    }
  });
  list.addEventListener('change', event => {
    if (event.target.matches('[data-attachment-input]')) {
      const ticket = event.target.closest('.status-ticket');
      addFiles(ticket, event.target.files);
      event.target.value = '';
    }
  });
  list.addEventListener('paste', event => {
    const field = event.target.closest('textarea[name="description"]');
    const ticket = field?.closest('.status-ticket');
    if (!ticket) return;
    const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && allowedTypes.has(item.type)).map(item => item.getAsFile()).filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (text) {
      const start = field.selectionStart;
      const end = field.selectionEnd;
      field.setRangeText(text, start, end, 'end');
    }
    addFiles(ticket, files);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const attachments = allAttachments();
    if (attachments.some(item => item.state === 'processing')) { status.textContent = t('Wait for the images to finish preparing before you submit.'); return; }
    if (attachments.some(item => item.state === 'error')) { status.textContent = t('Remove or replace the image that could not be prepared before you submit.'); return; }
    if (totalBytes() > MAX_TOTAL_BYTES) { status.textContent = t('The images in one submission must total 12 MB or less.'); return; }
    const submit = form.querySelector('[type="submit"]');
    const fields = new FormData(form);
    // Feedback ticket 88 (2026-10-14): images are prepared as they are attached, so the only wait left is the
    // receiver writing them to Drive. Send in the background and give the form back at once; the tickets and
    // images are kept aside and come back if the request fails.
    const tickets = readTickets();
    const payload = new URLSearchParams({
      form_type: 'app_feedback',
      experience_version: document.body.dataset.uxVersion || experiences[sourcePage] || experiences['index.html'],
      source_page: sourcePage,
      app_build: fields.get('app_build'),
      reporter_name: fields.get('reporter_name')?.trim() || '',
      reporter_email: fields.get('reporter_email')?.trim() || '',
      page_url: location.href,
      session_id: sessionId,
      device: matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop',
      tickets_json: JSON.stringify(tickets)
    });
    const kept = [...list.children];
    list.replaceChildren();
    addTicket();
    sending += 1;
    status.textContent = t(attachments.length ? 'Sending in the background. You can write the next ticket; keep this page open until it says sent.' : 'Sending your ticket…');
    try {
      await fetch(endpoint, { method: 'POST', mode: 'no-cors', body: payload });
      attachments.forEach(item => URL.revokeObjectURL(item.previewUrl));
      status.textContent = t('Thank you — your feedback and images have been sent.');
    } catch (_) {
      const fresh = [...list.children].filter(ticket => !ticket.querySelector('[name="description"]').value.trim()
        && !(ticketAttachments.get(ticket) || []).length);
      fresh.forEach(ticket => ticket.remove());
      list.prepend(...kept);
      numberTickets();
      status.textContent = t('We could not send that just now. Your ticket and images are still here; please try again.');
    } finally { sending -= 1; submit.disabled = false; }
  });
  window.addEventListener('beforeunload', event => { if (sending) { event.preventDefault(); event.returnValue = ''; } });
  addTicket();
})();
