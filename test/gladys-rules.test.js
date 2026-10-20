// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// answers of Webmin 2.670 and the Home Assistant fixture (several disks,
// temperatures), with and without the updates module, in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { Store } from '../src/store.js';
import { METHODS } from '../src/webmin/client.js';
import { FakeWebmin, PASSWORD, USERNAME, createNetwork } from './helpers/fakeWebmin.js';

process.env.LOG_LEVEL ??= 'silent';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);
const ha = JSON.parse(
  await readFile(new URL('./fixtures/webmin/ha-webmin_update.json', import.meta.url), 'utf8'),
);

const URLS = ['https://192.0.2.10:10000', 'https://192.0.2.11:10000', 'https://198.51.100.20'];

const SERVERS = {
  debian: () => new FakeWebmin(),
  ha: () => new FakeWebmin({ info: ha }),
  bare: () => {
    const webmin = new FakeWebmin({ info: { ...ha, mem: [1000, 500, 0, 0] } });
    webmin.faults[METHODS.UPDATES] = { code: 5, message: 'no module' };
    return webmin;
  },
};

// Three servers at once: every device of the fixtures is discovered.
async function discover(language, kinds) {
  const servers = Object.fromEntries(kinds.map((kind, index) => [URLS[index], SERVERS[kind]()]));
  const config = { language };
  kinds.forEach((_, index) => {
    config[`server_${index + 1}_url`] = URLS[index];
    config[`server_${index + 1}_username`] = USERNAME;
    config[`server_${index + 1}_password`] = PASSWORD;
  });
  const gladys = createFakeGladys({ config });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-webmin-rules-'))),
    timers: false,
    request: createNetwork(servers).request,
  });
  await gladys.connect();
  await app.ready;
  await app.stop();
  return gladys.fake.discoveredDevices;
}

const scenarios = [
  { label: 'English names', language: 'en', kinds: ['debian', 'ha', 'bare'] },
  { label: 'French names', language: 'fr', kinds: ['ha', 'bare', 'debian'] },
  { label: 'German names', language: 'de', kinds: ['bare', 'debian', 'ha'] },
  { label: 'Spanish names', language: 'es', kinds: ['debian', 'bare', 'ha'] },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const devices = await discover(scenario.language, scenario.kinds);
    assert.equal(devices.length, 3, `expected the fixture devices, got ${devices.length}`);
    assert.equal(
      new Set(devices.map((device) => device.external_id)).size,
      devices.length,
      'unique device external ids',
    );

    for (const device of devices) {
      const where = device.name;

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}
