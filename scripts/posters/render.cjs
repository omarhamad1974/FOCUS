/**
 * Renders the 8 launch posters (4 roles × square 1080×1080 and story 1080×1920) to PNG.
 *   npx vite            (in another terminal)
 *   pip install qrcode && node scripts/posters/render.cjs http://localhost:5173/ out-dir
 * Each QR code opens that role's landing page on the live site.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const base = process.argv[2] || 'http://localhost:5173/';
const out = process.argv[3] || 'posters';
const SITE = 'https://omarhamad1974.github.io/FOCUS/#/join/';
const ROLES = ['player', 'organizer', 'trainer', 'seller'];
const PY = `import sys, qrcode, qrcode.image.svg
img = qrcode.make(sys.argv[1], image_factory=qrcode.image.svg.SvgPathImage, border=1, error_correction=qrcode.constants.ERROR_CORRECT_M)
sys.stdout.write(img.to_string(encoding='unicode'))`;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  for (const size of ['square', 'story']) {
    const page = await browser.newPage({ viewport: { width: 1080, height: size === 'story' ? 1920 : 1080 }, deviceScaleFactor: 1 });
    for (const role of ROLES) {
      const svg = execFileSync('python3', ['-c', PY, SITE + role], { encoding: 'utf8' }).replace(/<\?xml[^>]*>/, '');
      await page.goto(`${base}scripts/posters/poster.html?role=${role}&size=${size}`);
      await page.waitForFunction(() => 'setQR' in window);
      await page.evaluate((s) => window.setQR(s), svg);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      const file = path.join(out, `pingo-${role}-${size}.png`);
      await page.locator('#poster').screenshot({ path: file });
      console.log(file);
    }
    await page.close();
  }
  await browser.close();
})();
