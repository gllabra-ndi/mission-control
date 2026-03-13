const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

  // Click the Command Center nav link
  await page.evaluate(() => {
    const navLinks = Array.from(document.querySelectorAll('button, a'));
    const ccLink = navLinks.find(el => el.textContent.includes('Command Center'));
    if (ccLink) ccLink.click();
  });

  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '/Users/scottlee/.gemini/antigravity/brain/e3f6c36e-899b-4db0-ac32-d2ab95b6639a/grid_verification_cc.png', fullPage: true });
  await browser.close();
})();
