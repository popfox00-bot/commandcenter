// The standalone decrypt.html (web/decryption/), opened straight from a file (no server, no app):
// it opens files made by the app with the password, with the recovery key, and says so when wrong.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createVault, encryptFile } from '../../web/lib/vault.js';

let browser;
before(async () => { browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined }); });
after(async () => { await browser?.close(); });

test('decrypt.html, from a file on disk and offline, opens the app\'s encrypted files', async () => {
  const v = await createVault('maple river candle orbit', { iterations: 600_000 });
  const a = await encryptFile(v.key, v.header, new File(['hello from the vault'], 'note.txt', { type: 'text/plain' }));
  const b = await encryptFile(v.key, v.header, new File([new Uint8Array([1, 2, 3, 250])], 'raw.bin', { type: 'application/octet-stream' }));
  const files = [
    { name: a.name, mimeType: 'application/octet-stream', buffer: Buffer.from(await a.blob.arrayBuffer()) },
    { name: b.name, mimeType: 'application/octet-stream', buffer: Buffer.from(await b.blob.arrayBuffer()) },
  ];
  const context = await browser.newContext();
  await context.setOffline(true);
  const page = await context.newPage();
  const errors = []; const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('blob:')) requests.push(r.url()); });
  await page.goto(pathToFileURL(resolve(import.meta.dirname, '../../web/decryption/decrypt.html')).href);
  await page.setInputFiles('#files', files);

  await page.fill('#secret', 'not it at all');
  await page.click('button');
  await page.waitForSelector('text=Opened 0 of 2.');
  assert.match(await page.textContent('#out'), /Wrong password or recovery key/);

  for (const secret of ['maple river candle orbit', v.recoveryKey]) {
    await page.fill('#secret', secret);
    await page.click('button');
    await page.waitForSelector('text=Opened 2 of 2.');
    const got = await page.$$eval('#out a', (links) => Promise.all(links.map(async (l) => ({ name: l.download, bytes: [...new Uint8Array(await (await fetch(l.href)).arrayBuffer())] }))));
    assert.deepEqual(got.map((g) => g.name), ['note.txt', 'raw.bin']);
    assert.equal(Buffer.from(got[0].bytes).toString(), 'hello from the vault');
    assert.deepEqual(got[1].bytes, [1, 2, 3, 250]);
  }
  assert.deepEqual(requests, [], 'nothing sent anywhere');
  assert.deepEqual(errors, []);
  await context.close();
});
