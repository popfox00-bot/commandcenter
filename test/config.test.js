import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, parseConfigText } from '../src/core/config.js';
import { ConfigError } from '../src/core/errors.js';
import { assertJobModule } from '../src/core/registry.js';
import { fakeJob, configFor } from './helpers/harness.js';

test('valid config applies defaults and job schema defaults', () => {
  const { config } = configFor([fakeJob()]);
  const job = config.jobs.fake;
  assert.equal(job.enabled, true);
  assert.equal(job.schedule, '0 * * * *');
  assert.deepEqual(job.settings, { terms: [] });
  assert.equal(job.notify.maxPerRun, 5);
  assert.equal(config.timezone, 'UTC');
});

test('job entry schedule overrides module default', () => {
  const { config } = configFor([fakeJob()], { fake: { schedule: '*/30 * * * *' } });
  assert.equal(config.jobs.fake.schedule, '*/30 * * * *');
});

test('invalid config fails loudly listing every problem', () => {
  const registry = new Map([['fake', fakeJob()]]);
  const raw = {
    version: 1,
    jobs: {
      fake: { schedule: 'every hour', settings: { terms: 'not-an-array' } },
    },
  };
  assert.throws(() => validateConfig(raw, registry), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /schedule/);
    return true;
  });
  const raw2 = { version: 1, jobs: { fake: { settings: { terms: 'x', bogus: 1 } }, nope: {} } };
  assert.throws(() => validateConfig(raw2, registry), (err) => {
    assert.match(err.message, /jobs\.fake\.settings\.terms/);
    assert.match(err.message, /jobs\.fake\.settings/);
    assert.match(err.message, /jobs\.nope: no job module/);
    return true;
  });
});

test('unknown top-level and job keys are rejected (strict)', () => {
  const registry = new Map([['fake', fakeJob()]]);
  assert.throws(() => validateConfig({ version: 1, jobz: {}, jobs: {} }, registry), ConfigError);
  assert.throws(() => validateConfig({ version: 1, jobs: { fake: { enabeld: true } } }, registry), /enabeld|Unrecognized/);
});

test('bad timezone is rejected', () => {
  const registry = new Map([['fake', fakeJob()]]);
  assert.throws(() => validateConfig({ version: 1, timezone: 'Mars/Olympus', jobs: { fake: {} } }, registry), /time zone/);
});

test('YAML syntax errors and duplicate keys are ConfigErrors', () => {
  assert.throws(() => parseConfigText('version: 1\njobs: [\n'), ConfigError);
  assert.throws(() => parseConfigText('version: 1\nversion: 2\n'), ConfigError);
});

test('job module contract is enforced', () => {
  assert.throws(() => assertJobModule({ id: 'x1', name: 'X' }), /description.*run\(ctx\).*schedule/);
  assert.equal(assertJobModule(fakeJob()).id, 'fake');
});
