// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Webmin servers on a
// fake network, a temporary /data and a manual clock, with the integration
// wired on top through registerHandlers. No timer runs unless `timers` is set:
// the tests read the servers with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { deviceIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { FakeWebmin, PASSWORD, USERNAME, createNetwork } from './fakeWebmin.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const URL_1 = 'https://192.0.2.10:10000';
export const URL_2 = 'https://198.51.100.20';

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = Date.UTC(2026, 9, 13, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {Record<string, FakeWebmin>} [options.servers] by base URL
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] the reading timer of the hub (mock.timers)
 */
export async function createWorld({
  clock = createClock(),
  servers,
  config = {
    server_1_url: '192.0.2.10',
    server_1_username: USERNAME,
    server_1_password: PASSWORD,
    server_1_name: 'NAS',
    language: 'en',
  },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-webmin-')),
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork(servers ?? { [URL_1]: new FakeWebmin() });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, network, app, hub: app.hub, clock, dataDir };
}

/** External id of the device of a server slot. */
export const deviceId = (gladys, slot = 1) => deviceIds(gladys, slot).device;

export const featureId = (gladys, feature, slot = 1) => deviceIds(gladys, slot).feature(feature);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { FakeWebmin, PASSWORD, USERNAME };
