// Socials' natural voices: every one has its sample (each saying SAMPLE_LINE, made ahead with the voice model and kept
// with the app in web/apps/socials/voices/), so trying voices out plays at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NATURAL, sampleUrl, SAMPLE_LINE } from '../web/apps/socials/socials-speech.js';

test('each natural voice has its sample, and none is missing or empty', () => {
  assert.equal(SAMPLE_LINE, 'Hi! This is how I sound.');
  assert.equal(NATURAL.length, 43);
  const names = new Set();
  for (const v of NATURAL) {
    const f = fileURLToPath(sampleUrl(v.id));
    assert.ok(existsSync(f), `${v.name} (${v.id}) has no sample at ${f}`);
    assert.ok(statSync(f).size > 4000, `${v.name}'s sample is too small`);
    assert.ok(!names.has(f), `${v.id} shares a sample file`); names.add(f);
  }
});

test('fast voices (for phones): 13, each with its sample; every full voice has a fast stand-in (Nova stays Nova)', async () => {
  const { FAST, fastFor, fullFor } = await import('../web/apps/socials/socials-speech.js');
  assert.equal(FAST.length, 13);
  for (const v of FAST) {
    const f = fileURLToPath(sampleUrl(v.id));
    assert.ok(existsSync(f) && statSync(f).size > 4000, `${v.name} has its sample`);
    assert.ok(Number.isInteger(v.speaker) && v.speaker >= 0 && v.speaker < 904);
    assert.ok(NATURAL.some((n) => n.id === v.full), `${v.name} stands in for a full voice`);
  }
  assert.equal(fastFor('af_nova').name, 'Nova');
  assert.equal(fullFor(fastFor('af_nova').id), 'af_nova');
  for (const n of NATURAL) {
    const f = fastFor(n.id); assert.ok(f, n.id);
    if (n.gender === 'M') assert.equal(f.gender, 'M', `${n.name}: a man's voice`);
    if (n.gender === 'F') assert.equal(f.gender, 'F', `${n.name}: a woman's voice`);
  }
});
