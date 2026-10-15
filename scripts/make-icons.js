// Render web/icons/icon.svg to the PNGs iOS and Android need (`npm run icons`). Uses Playwright's Chromium.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const dir = resolve(import.meta.dirname, '../web/icons');
const svg = readFileSync(`${dir}/icon.svg`, 'utf8');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['apple-touch-icon.png', 180, 0], ['icon-512-maskable.png', 512, 0.1]]) {
  await page.setViewportSize({ width: size, height: size });
  // Maskable icons need a full-bleed background with the artwork inside the safe zone.
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(`<html><body style="margin:0;background:#0f1115;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: `${dir}/${name}`, omitBackground: false });
  console.log('wrote', name);
}
await browser.close();
