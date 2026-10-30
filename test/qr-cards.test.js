// QR → Saved → App codes (web/tools/qr/qr-cards-core.js): which app a code belongs to and the handle
// in it, the handle as each app writes it, stored cards checked, and the card colors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_BRANDS, detectApp, shownHandle, normalizeCard, cardColors } from '../web/tools/qr/qr-cards-core.js';
import { homeApps } from '../web/apps/index.js';

test('the app and the handle, from the code\'s link', () => {
  const cases = [
    ['https://www.snapchat.com/add/alexfox?share_id=x', 'snapchat', 'alexfox'],
    ['https://snapchat.com/t/AbC123', 'snapchat', 'AbC123'],
    ['https://venmo.com/u/Alex-Fox', 'venmo', 'Alex-Fox'],
    ['https://venmo.com/code?user_id=123456789', 'venmo', ''],
    ['https://cash.app/$alexfox', 'cashapp', 'alexfox'],
    ['https://paypal.me/alexfox', 'paypal', 'alexfox'],
    ['https://enroll.zellepay.com/qr-codes?data=eyJ0', 'zelle', ''],
    ['https://instagram.com/alex.fox?igsh=1', 'instagram', 'alex.fox'],
    ['https://www.tiktok.com/@alexfox', 'tiktok', 'alexfox'],
    ['https://wa.me/15551234567', 'whatsapp', '15551234567'],
    ['https://www.linkedin.com/in/alex-fox-1', 'linkedin', 'alex-fox-1'],
    ['https://x.com/alexfox', 'x', 'alexfox'],
    ['https://t.me/alexfox', 'telegram', 'alexfox'],
    ['https://discord.gg/abcd', 'discord', 'abcd'],
    ['https://example.com/me', 'other', ''],
    ['MECARD:N:Fox,Alex;;', 'other', ''],
  ];
  for (const [text, app, handle] of cases) assert.deepEqual(detectApp(text), { app, handle }, text);
  assert.equal(detectApp('https://www.netflix.com/').app, 'other', 'x.com inside another name is not X');
});

test('handles as each app writes them; cards checked; colors', () => {
  assert.equal(shownHandle('venmo', 'Alex-Fox'), '@Alex-Fox');
  assert.equal(shownHandle('cashapp', '$alexfox'), '$alexfox');
  assert.equal(shownHandle('paypal', 'alexfox'), 'alexfox');
  assert.equal(shownHandle('venmo', ''), '');
  assert.equal(normalizeCard({ app: 'venmo' }), null, 'a card needs a code or a picture');
  const c = normalizeCard({ id: 1, app: 'nope', text: 'x', handle: '@me', name: '  Alex ', color: 'red' });
  assert.deepEqual([c.app, c.handle, c.name, c.color], ['other', 'me', 'Alex', '']);
  assert.deepEqual(cardColors({ app: 'snapchat' }), { bg: ['#FFFC00'], ink: '#FFFFFF', accent: null, outline: '#000000' }, 'white text outlined in black on the yellow');
  assert.equal(cardColors({ app: 'venmo' }).outline, 'rgba(0,0,0,0.55)');
  assert.equal(cardColors({ app: 'other', color: '#ffeeaa' }).ink, '#000000', 'dark text on a light color');
  assert.equal(cardColors({ app: 'other', color: '#112233' }).ink, '#FFFFFF');
  for (const [k, b] of Object.entries(APP_BRANDS)) assert.ok(b.name && b.bg.length && b.ink && b.verb, k);
});

test('home screen: the default order, your order, apps added later at the end, Jobs only in Settings', () => {
  assert.deepEqual(homeApps().map((a) => a.id), ['calendar', 'updates', 'notes', 'files', 'draw', 'qr', 'games', 'settings']);
  assert.deepEqual(homeApps(['qr', 'calendar', 'gone']).map((a) => a.id).slice(0, 3), ['qr', 'calendar', 'updates'], 'unknown ids ignored; the rest keep their order');
  assert.equal(homeApps(['jobs']).some((a) => a.id === 'jobs'), false);
});
