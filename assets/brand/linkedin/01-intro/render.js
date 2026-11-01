// Renders carousel.html into slide-1.png … slide-N.png (1080 × 1350) and carousel.pdf (one slide per page, for a
// LinkedIn document post). Run from this folder: node render.js   (needs Playwright with Chromium).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await p.goto('file://' + path.join(__dirname, 'carousel.html'), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const slides = p.locator('section.s');
  const n = await slides.count();
  for (let i = 0; i < n; i++) await slides.nth(i).screenshot({ path: path.join(__dirname, `slide-${i + 1}.png`) });
  await p.pdf({ path: path.join(__dirname, 'carousel.pdf'), width: '1080px', height: '1350px', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  console.log(n, 'slides'); await b.close();
})();
