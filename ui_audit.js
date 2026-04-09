const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto('http://localhost:3000/?tab=capacity-grid', { waitUntil: 'domcontentloaded', timeout: 0 });
  await new Promise(r => setTimeout(r, 2000));

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Task Estimate'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 500));

  const before = await page.evaluate(() => {
    const input = document.querySelector('tbody input[type="number"]');
    const cls = input ? input.className : '';
    return { className: cls, isGreen: cls.includes('emerald'), isRed: cls.includes('red'), isNeutral: cls.includes('surface/30') };
  });

  await page.evaluate(() => {
    const input = document.querySelector('tbody input[type="number"]');
    if (!input) return;
    input.value = '9';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 400));

  const after = await page.evaluate(() => {
    const input = document.querySelector('tbody input[type="number"]');
    const cls = input ? input.className : '';
    const summary = Array.from(document.querySelectorAll('span')).map(s => s.textContent || '').find(t => t.includes('cells matched')) || '';
    return { className: cls, isGreen: cls.includes('emerald'), isRed: cls.includes('red'), isNeutral: cls.includes('surface/30'), summary };
  });

  await page.screenshot({ path: '/tmp/capacity-grid-live-match-fix.png', fullPage: true });
  console.log(JSON.stringify({ before, after }, null, 2));
  await browser.close();
})();
