// -----------------------------------------------------------------------------
// The hub, end to end against the SDK's fake Gladys and fake Webmin servers:
// discovery, states of the devices added (only the changes), scene events on
// transitions (security updates, disk steps, unreachable server), what
// survives a restart, the back-off after refused credentials, the reading
// timer, the connection status, the widget and the scene action.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS } from '../src/devices.js';
import { HUB_TIMINGS, TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { METHODS } from '../src/webmin/client.js';
import { loadFixture } from './helpers/fakeWebmin.js';
import {
  FakeWebmin,
  PASSWORD,
  URL_1,
  URL_2,
  USERNAME,
  createClock,
  createDevices,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

const K = FEATURE_KEYS;
const eventsOf = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);

async function serverWorld(t, options = {}) {
  const webmin = options.webmin ?? new FakeWebmin();
  const world = await createWorld({ servers: { [URL_1]: webmin }, ...options });
  t.after(() => world.app.stop());
  return { ...world, webmin };
}

const SUDO = {
  name: 'sudo',
  version: '1.9.13p3-1+deb12u3',
  oldversion: '1.9.13p3-1+deb12u1',
  security: 1,
};

test('discovers one device per server, with the updates and the reboot', async (t) => {
  const world = await serverWorld(t);
  const [device] = world.fake.discoveredDevices;
  assert.equal(world.fake.discoveredDevices.length, 1);
  assert.equal(device.name, 'NAS');
  assert.equal(device.external_id, deviceId(world.gladys));
  assert.equal(device.should_poll, false);
  assert.deepEqual(
    device.features.map((feature) => feature.external_id.split(':').pop()),
    [
      K.ONLINE,
      K.CPU,
      K.MEMORY,
      K.SWAP,
      K.LOAD_1,
      K.LOAD_5,
      K.LOAD_15,
      K.DISK_MAX,
      K.UPTIME,
      K.UPDATES,
      K.SECURITY_UPDATES,
      K.REBOOT_REQUIRED,
    ],
  );
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.states.length, 0, 'nothing published before the device is added');
});

test('named after the host name Webmin gives when no name is configured', async (t) => {
  const world = await serverWorld(t, {
    config: {
      server_1_url: '192.0.2.10',
      server_1_username: USERNAME,
      server_1_password: PASSWORD,
    },
  });
  assert.equal(world.fake.discoveredDevices[0].name, 'debian-server.lan');
  assert.equal(world.fake.discoveredDevices[0].features[0].name, 'En ligne', 'French by default');
});

test('adding the device publishes every value, then only the changes', async (t) => {
  const world = await serverWorld(t, { clock: createClock() });
  await createDevices(world);
  const last = (key) => world.fake.lastState(featureId(world.gladys, key));
  assert.equal(last(K.ONLINE), 1);
  assert.equal(last(K.UPDATES), 4);
  assert.equal(last(K.SECURITY_UPDATES), 2);
  assert.equal(last(K.REBOOT_REQUIRED), 1);
  assert.equal(last(K.DISK_MAX), 87);
  assert.equal(last(K.LOAD_5), 2.21);
  assert.equal(last(K.UPTIME), 11.97);
  assert.ok(world.fake.widgetRefreshes.includes(WIDGET_KEY));
  assert.equal(world.fake.transports.at(-1).transport, 'local');

  const count = world.fake.states.length;
  world.clock.advance(5 * 60_000);
  await world.hub.pollAll();
  assert.equal(world.fake.states.length, count, 'nothing changed, nothing sent');
  world.webmin.info.disk_fs[0].used_percent = 88;
  world.clock.advance(5 * 60_000);
  await world.hub.pollAll();
  assert.equal(world.fake.states.length, count + 1);
  assert.equal(last(K.DISK_MAX), 88);
});

test('new security updates fire one event listing them; the same list fires nothing', async (t) => {
  const world = await serverWorld(t, { clock: createClock() });
  assert.deepEqual(eventsOf(world, TRIGGERS.SECURITY), [], 'the first read only records');
  world.webmin.updates = [...loadFixture('updates.xml'), SUDO];
  world.clock.advance(5 * 60_000);
  await world.hub.pollAll();
  assert.deepEqual(eventsOf(world, TRIGGERS.SECURITY), [], 'updates read once an hour');
  world.clock.advance(3600_000);
  await world.hub.pollAll();
  const [event] = eventsOf(world, TRIGGERS.SECURITY);
  assert.deepEqual(event.data, {
    server: deviceId(world.gladys),
    server_name: 'NAS',
    new_count: 1,
    security_count: 3,
    updates_count: 5,
    packages: 'sudo',
  });
  world.clock.advance(3600_000);
  await world.hub.pollAll();
  assert.equal(eventsOf(world, TRIGGERS.SECURITY).length, 1);
  // Installed, then a newer version pending: new again.
  world.webmin.updates = loadFixture('updates.xml');
  await world.hub.pollAll({ force: true });
  world.webmin.updates = [
    ...loadFixture('updates.xml'),
    { ...SUDO, version: '1.9.13p3-1+deb12u4' },
  ];
  await world.hub.pollAll({ force: true });
  assert.equal(eventsOf(world, TRIGGERS.SECURITY).length, 2);
});

test('a disk crossing the steps fires once per step, again after going 2 points below', async (t) => {
  const world = await serverWorld(t);
  const disk = world.webmin.info.disk_fs[0];
  disk.used_percent = 96;
  await world.hub.pollAll();
  assert.deepEqual(
    eventsOf(world, TRIGGERS.DISK).map((event) => event.data.threshold),
    [90, 95],
  );
  assert.equal(eventsOf(world, TRIGGERS.DISK)[0].data.mount_point, '/');
  disk.used_percent = 94;
  await world.hub.pollAll();
  disk.used_percent = 92;
  await world.hub.pollAll();
  disk.used_percent = 95;
  await world.hub.pollAll();
  assert.deepEqual(
    eventsOf(world, TRIGGERS.DISK).map((event) => event.data.threshold),
    [90, 95, 95],
  );
});

test('a restart neither repeats nor misses an announcement', async (t) => {
  const first = await serverWorld(t);
  first.webmin.info.disk_fs[0].used_percent = 91;
  await first.hub.pollAll({ force: true });
  assert.equal(eventsOf(first, TRIGGERS.DISK).length, 1);
  await first.app.stop();

  const webmin = first.webmin;
  webmin.updates = [...loadFixture('updates.xml'), SUDO];
  const second = await serverWorld(t, { webmin, dataDir: first.dataDir });
  assert.equal(eventsOf(second, TRIGGERS.DISK).length, 0, 'the 90 % step already announced');
  assert.deepEqual(
    eventsOf(second, TRIGGERS.SECURITY).map((event) => event.data.packages),
    ['sudo'],
    'the update that appeared while stopped',
  );
});

test('a server silent two reads in a row is unreachable, once', async (t) => {
  const world = await serverWorld(t);
  await createDevices(world);
  world.webmin.down = true;
  await world.hub.pollAll();
  assert.equal(eventsOf(world, TRIGGERS.UNREACHABLE).length, 0, 'a blip is no outage');
  await world.hub.pollAll();
  await world.hub.pollAll();
  const events = eventsOf(world, TRIGGERS.UNREACHABLE);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.server_name, 'NAS');
  assert.equal(events[0].data.error, 'does not answer (is Webmin running?)');
  assert.equal(world.fake.lastState(featureId(world.gladys, K.ONLINE)), 0);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(world.fake.connectionStatus.connected, false);
  world.webmin.down = false;
  await world.hub.pollAll();
  assert.equal(world.fake.lastState(featureId(world.gladys, K.ONLINE)), 1);
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('refused credentials: no unreachable event, and Webmin is left alone for 30 minutes', async (t) => {
  const webmin = new FakeWebmin();
  webmin.password = 'changed on the server';
  const clock = createClock();
  const world = await serverWorld(t, { webmin, clock });
  assert.match(world.fake.connectionStatus.message.en, /user name or password refused/);
  const before = world.network.requests.length;
  for (let read = 0; read < 5; read += 1) {
    clock.advance(5 * 60_000);
    await world.hub.pollAll();
  }
  assert.equal(world.network.requests.length, before, 'no login attempt in 25 minutes');
  assert.equal(eventsOf(world, TRIGGERS.UNREACHABLE).length, 0);
  clock.advance(HUB_TIMINGS.authRetryMs);
  await world.hub.pollAll();
  assert.equal(world.network.requests.length, before + 1);
  // The user fixes the password on the server, then tests the connection.
  webmin.password = PASSWORD;
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.en,
    /NAS: OK, Webmin 2\.670, 1 disk\(s\), 4 update\(s\) available, 2 for security/,
  );
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('Webmin blocking the address and missing XML::Parser are said in words', async (t) => {
  const webmin = new FakeWebmin();
  webmin.status = 403;
  const world = await serverWorld(t, { webmin });
  assert.match(world.fake.connectionStatus.message.fr, /Webmin bloque Gladys/);
  webmin.status = null;
  webmin.faults[METHODS.SYSTEM_INFO] = {
    code: 2,
    message: 'XML::Parser Perl module is not installed',
  };
  await world.hub.pollAll({ force: true });
  assert.match(world.fake.connectionStatus.message.en, /libxml-parser-perl/);
});

test('the reading timer reads Webmin without any onPoll (Gladys#3198)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const webmin = new FakeWebmin();
  const world = await createWorld({ servers: { [URL_1]: webmin }, timers: true });
  t.after(() => world.app.stop());
  webmin.calls.length = 0;
  t.mock.timers.tick(300_000);
  // Let the timer callback run its requests.
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(webmin.calls.includes(METHODS.SYSTEM_INFO));
});

test('two servers: one failing keeps the integration connected and says which', async (t) => {
  const failing = new FakeWebmin();
  failing.down = true;
  const world = await createWorld({
    servers: { [URL_1]: new FakeWebmin(), [URL_2]: failing },
    config: {
      server_1_url: '192.0.2.10',
      server_1_username: USERNAME,
      server_1_password: PASSWORD,
      server_2_url: URL_2,
      server_2_username: USERNAME,
      server_2_password: PASSWORD,
      server_2_name: 'Backup',
      language: 'en',
    },
  });
  t.after(() => world.app.stop());
  assert.equal(world.fake.discoveredDevices.length, 1, 'a server never read is not proposed');
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.match(world.fake.connectionStatus.message.en, /^Backup: does not answer/);
});

test('without the updates module: no update features, the rest works', async (t) => {
  const webmin = new FakeWebmin();
  webmin.faults[METHODS.UPDATES] = {
    code: 5,
    message: 'Webmin module package-updates does not exist',
  };
  const world = await serverWorld(t, { webmin });
  const keys = world.fake.discoveredDevices[0].features.map((f) => f.external_id.split(':').pop());
  assert.ok(!keys.includes(K.UPDATES) && !keys.includes(K.REBOOT_REQUIRED));
  assert.ok(keys.includes(K.LOAD_5));
});

test('features once seen stay: a server losing its updates module keeps its structure', async (t) => {
  const world = await serverWorld(t);
  const before = JSON.stringify(world.fake.discoveredDevices);
  world.webmin.faults[METHODS.UPDATES] = { code: 7, message: 'apt failed' };
  await world.hub.pollAll({ force: true });
  assert.equal(JSON.stringify(world.fake.discoveredDevices), before);
});

// --- Widget and scene action ------------------------------------------------------

test('the widget shows updates, gauges and rows, valid for the core', async (t) => {
  const world = await serverWorld(t);
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, {
      settings: { server: deviceId(world.gladys) },
      language,
    });
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(validateWidgetContent(ack.data.content), [], language);
  }
  const data = (
    await world.fake.widgetGet(WIDGET_KEY, {
      settings: { server: deviceId(world.gladys) },
      language: 'en',
    })
  ).data.content;
  const types = data.components.map((component) => component.type);
  assert.deepEqual(types, ['text', 'value', 'gauge', 'gauge', 'status', 'button']);
  assert.equal(data.components[1].value, 4);
  assert.equal(data.components[1].color, 'danger');
  const rows = data.components[4].items;
  assert.deepEqual(rows[0], {
    label: 'Security',
    value: 'libssl3, openssl',
    icon: 'shield',
    color: 'danger',
  });
  assert.equal(rows[1].label, 'Reboot required');
});

test('the widget without a server, with a gone one, with an offline one', async (t) => {
  const world = await serverWorld(t);
  const get = async (server) =>
    (await world.fake.widgetGet(WIDGET_KEY, { settings: { server }, language: 'en' })).data.content;
  assert.match((await get('')).components[0].text, /Choose the server/);
  assert.match(
    (await get(world.gladys.externalIds('server', '3').device)).components[0].text,
    /no longer in the configuration/,
  );
  world.webmin.down = true;
  await world.hub.pollAll();
  const offline = await get(deviceId(world.gladys));
  assert.deepEqual(validateWidgetContent(offline), []);
  assert.match(offline.components[1].text, /does not answer/);
});

test('the Refresh button reads Webmin again, the updates too', async (t) => {
  const world = await serverWorld(t);
  world.webmin.calls.length = 0;
  const ack = await world.fake.widgetAction(
    WIDGET_KEY,
    'refresh',
    {},
    {
      settings: { server: deviceId(world.gladys) },
    },
  );
  assert.equal(ack.success, true, ack.error);
  assert.ok(world.webmin.calls.includes(METHODS.UPDATES));
});

test('State of a Webmin server: every figure and a summary', async (t) => {
  const world = await serverWorld(t);
  const ack = await world.fake.sceneAction('get_server_status', { server: deviceId(world.gladys) });
  assert.equal(ack.success, true, ack.error);
  const { outputs } = ack.data;
  assert.equal(outputs.updates, 4);
  assert.equal(outputs.security_updates, 2);
  assert.equal(outputs.reboot_required, true);
  assert.equal(outputs.packages, 'libssl3, openssl, curl, libcurl4');
  assert.equal(outputs.disk_mount, '/');
  assert.equal(
    outputs.summary,
    'NAS: 4 update(s), 2 for security (libssl3, openssl), reboot required, load 2.21, memory 66%, disk / 87% (59 GB free)',
  );
  world.webmin.down = true;
  world.clock.advance(HUB_TIMINGS.freshMs);
  await world.hub.pollAll();
  world.clock.advance(HUB_TIMINGS.freshMs);
  const offline = await world.fake.sceneAction('get_server_status', {
    server: deviceId(world.gladys),
  });
  assert.equal(offline.data.outputs.online, false);
  assert.equal(offline.data.outputs.summary, 'NAS: does not answer (is Webmin running?)');
  const unknown = await world.fake.sceneAction('get_server_status', { server: 'nope' });
  assert.equal(unknown.success, false);
});
