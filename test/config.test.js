// -----------------------------------------------------------------------------
// Configuration: the address typed by the user, the three server slots, the
// defaults.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, hostOf, normalizeConfig, parseServerUrl } from '../src/config.js';

test('an address becomes a base URL, HTTPS and port 10000 by default', () => {
  assert.equal(parseServerUrl('192.0.2.10'), 'https://192.0.2.10:10000');
  assert.equal(parseServerUrl(' server.lan '), 'https://server.lan:10000');
  assert.equal(parseServerUrl('192.0.2.10:20000'), 'https://192.0.2.10:20000');
  assert.equal(parseServerUrl('http://192.0.2.10:10000/'), 'http://192.0.2.10:10000');
  assert.equal(parseServerUrl('https://server.lan:10000/sysinfo.cgi'), 'https://server.lan:10000');
  assert.equal(parseServerUrl('https://server.lan:10000/?dashboard#x'), 'https://server.lan:10000');
  assert.equal(parseServerUrl('https://webmin.example.com'), 'https://webmin.example.com');
  assert.equal(
    parseServerUrl('https://example.com/webmin/xmlrpc.cgi'),
    'https://example.com/webmin',
    'a reverse proxy sub-path is kept',
  );
});

test('an unusable address is refused, credentials in it too', () => {
  for (const raw of [
    '',
    '   ',
    'ftp://server',
    'https://',
    'https://user:pw@server.lan',
    42,
    null,
  ]) {
    assert.equal(parseServerUrl(raw), null, String(raw));
  }
});

test('the host shown to the user drops the scheme and the default port', () => {
  assert.equal(hostOf('https://192.0.2.10:10000'), '192.0.2.10');
  assert.equal(hostOf('https://192.0.2.10:20000'), '192.0.2.10:20000');
  assert.equal(hostOf('https://example.com/webmin'), 'example.com/webmin');
});

test('the defaults: no server, 5 minutes, self-signed accepted, French names', () => {
  const config = normalizeConfig(DEFAULT_CONFIG);
  assert.deepEqual(config.servers, []);
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.allowSelfSigned, true);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({}).allowSelfSigned, true);
  assert.equal(normalizeConfig({ allow_self_signed: false }).allowSelfSigned, false);
  assert.equal(normalizeConfig({ allow_self_signed: 'false' }).allowSelfSigned, false);
});

test('three slots, each with its credentials; a bad address is reported, not dropped silently', () => {
  const config = normalizeConfig({
    server_1_url: '192.0.2.10',
    server_1_username: ' gladys ',
    server_1_password: 'p@ss word\n',
    server_2_url: 'ftp://nope',
    server_3_url: 'https://198.51.100.20',
    server_3_name: '  Backup  ',
    poll_interval: '60',
    language: 'de',
  });
  assert.deepEqual(config.servers, [
    {
      slot: 1,
      url: 'https://192.0.2.10:10000',
      username: 'gladys',
      password: 'p@ss word',
      name: null,
    },
    { slot: 3, url: 'https://198.51.100.20', username: '', password: '', name: 'Backup' },
  ]);
  assert.deepEqual(config.invalidSlots, [2]);
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.language, 'de');
});

test('an interval or a language outside the lists falls back to the default', () => {
  const config = normalizeConfig({ poll_interval: '5', language: 'it' });
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.language, 'fr');
});
