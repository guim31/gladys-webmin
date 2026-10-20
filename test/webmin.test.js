// -----------------------------------------------------------------------------
// The Webmin layer: XML-RPC on the real answers of Webmin 2.670, the client
// (errors by kind, hourly updates, a missing module), and the snapshot built
// from them and from the Home Assistant fixture.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ERROR_KINDS, METHODS, WebminClient, formatVersion } from '../src/webmin/client.js';
import { fullestDisk, parseSnapshot } from '../src/webmin/model.js';
import {
  XmlRpcFault,
  XmlRpcFormatError,
  decodeResponse,
  encodeCall,
} from '../src/webmin/xmlrpc.js';
import {
  FakeWebmin,
  PASSWORD,
  USERNAME,
  createNetwork,
  loadFixture,
} from './helpers/fakeWebmin.js';

const URL_1 = 'https://192.0.2.10:10000';

function client(webmin = new FakeWebmin(), options = {}) {
  const network = createNetwork({ [URL_1]: webmin });
  let time = Date.UTC(2026, 9, 20, 10, 0, 0);
  const result = new WebminClient({
    url: URL_1,
    username: USERNAME,
    password: PASSWORD,
    request: network.request,
    now: () => time,
    ...options,
  });
  return { client: result, webmin, network, advance: (ms) => (time += ms) };
}

// --- XML-RPC ---------------------------------------------------------------------

test('the real answers of Webmin decode to plain values', () => {
  assert.equal(loadFixture('version.xml'), 2.67);
  assert.equal(formatVersion(loadFixture('version.xml')), '2.670');
  assert.deepEqual(loadFixture('uptime.xml'), [11, 23, 15]);
  assert.equal(loadFixture('reboot.xml'), 1);
  const updates = loadFixture('updates.xml');
  assert.deepEqual(
    updates.map((item) => [item.name, item.security]),
    [
      ['curl', ''],
      ['libcurl4', ''],
      ['libssl3', 1],
      ['openssl', 1],
    ],
  );
  const info = loadFixture('system-info.xml');
  assert.equal(info.disk_total, 502392610816, 'an <int> beyond 32 bits');
  assert.deepEqual(info.load.slice(0, 3), [1.64, 2.21, 1.75]);
  assert.equal(info.kernel.os, 'Linux');
});

test('a fault becomes an XmlRpcFault, its string base64-decoded when it is', () => {
  const plain = `<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultString</name><value><string>Invalid user for RPC</string></value></member><member><name>faultCode</name><value><int>1</int></value></member></struct></value></fault></methodResponse>`;
  assert.throws(
    () => decodeResponse(plain),
    (err) => err instanceof XmlRpcFault && err.code === 1 && err.message === 'Invalid user for RPC',
  );
  const encoded = Buffer.from('Function call nosuchfunc failed\n\n').toString('base64');
  const base64 = `<methodResponse><fault><value><struct><member><name>faultCode</name><value><int>7</int></value></member><member><name>faultString</name><value><base64>${encoded}</base64></value></member></struct></value></fault></methodResponse>`;
  assert.throws(
    () => decodeResponse(base64),
    (err) => err.code === 7 && err.message === 'Function call nosuchfunc failed',
  );
});

test('untyped values, entities, booleans, an empty answer; HTML is refused', () => {
  const xml = `<methodResponse><params><param><value><struct>
    <member><name>a</name><value>plain &amp; simple</value></member>
    <member><name>b</name><value><boolean>1</boolean></value></member>
    <member><name>c</name><value><i8>9007199254740</i8></value></member>
    <member><name>d</name><value><string>&#233;t&#xE9;</string></value></member>
    <member><name>e</name><value><nil/></value></member>
  </struct></value></param></params></methodResponse>`;
  assert.deepEqual(decodeResponse(xml), {
    a: 'plain & simple',
    b: true,
    c: 9007199254740,
    d: 'été',
    e: null,
  });
  assert.equal(decodeResponse('<methodResponse><params></params></methodResponse>'), null);
  assert.throws(() => decodeResponse('<html><body>Login</body></html>'), XmlRpcFormatError);
  assert.throws(() => decodeResponse(''), XmlRpcFormatError);
});

test('a call is escaped XML with typed parameters', () => {
  assert.equal(
    encodeCall('system-status.collect_system_info', ['', ['package-updates'], 2, 'a<b&c']),
    '<?xml version="1.0"?>\n<methodCall><methodName>system-status.collect_system_info</methodName><params><param><value><string></string></value></param><param><value><array><data><value><string>package-updates</string></value></data></array></value></param><param><value><int>2</int></value></param><param><value><string>a&lt;b&amp;c</string></value></param></params></methodCall>',
  );
});

// --- Client ------------------------------------------------------------------------

test('a read: system information without packages, uptime, version, updates, reboot', async () => {
  const { client: webminClient, network } = client();
  const read = await webminClient.read();
  assert.equal(read.version, '2.670');
  assert.equal(read.hostname, 'debian-server.lan', 'the trailing dot of a FQDN dropped');
  assert.equal(read.updates.packages.length, 4);
  assert.equal(read.updates.reboot, true);
  const first = network.requests[0];
  assert.equal(first.url, `${URL_1}/xmlrpc.cgi`);
  assert.equal(first.method, 'POST');
  assert.match(first.body, /<string>package-updates<\/string>/, 'package list skipped there');
  assert.equal(
    first.headers.authorization,
    `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`,
  );
});

test('the updates, the version and the host name are read once an hour', async () => {
  const { client: webminClient, webmin, advance } = client();
  await webminClient.read();
  webmin.calls.length = 0;
  advance(5 * 60_000);
  await webminClient.read();
  assert.deepEqual(webmin.calls, [METHODS.SYSTEM_INFO, METHODS.UPTIME]);
  webmin.calls.length = 0;
  await webminClient.read({ updates: true });
  assert.deepEqual(webmin.calls, [
    METHODS.SYSTEM_INFO,
    METHODS.UPTIME,
    METHODS.UPDATES,
    METHODS.REBOOT,
  ]);
  webmin.calls.length = 0;
  advance(3600_000);
  await webminClient.read();
  assert.equal(webmin.calls.length, 6);
});

test('without the package updates module: the system figures, updates unknown', async () => {
  const webmin = new FakeWebmin();
  webmin.faults[METHODS.UPDATES] = {
    code: 5,
    message: 'Webmin module package-updates does not exist',
  };
  webmin.faults[METHODS.UPTIME] = { code: 7, message: 'uptime failed' };
  const { client: webminClient } = client(webmin);
  const read = await webminClient.read();
  assert.equal(read.updates, null);
  assert.equal(read.uptime, null);
  assert.equal(read.notes.length, 2);
  assert.ok(read.info.load);
});

test('every failure has its kind', async () => {
  const cases = [
    ['wrong password', (w) => (w.password = 'other'), ERROR_KINDS.AUTH],
    ['blocked address', (w) => (w.status = 403), ERROR_KINDS.BLOCKED],
    ['proxy without Webmin', (w) => (w.status = 502), ERROR_KINDS.UNREACHABLE],
    ['HTTP on the HTTPS port', (w) => (w.status = 302), ERROR_KINDS.REDIRECT],
    ['no xmlrpc.cgi', (w) => (w.status = 404), ERROR_KINDS.NOT_WEBMIN],
    ['an HTML page', (w) => (w.body = '<html>Hello</html>'), ERROR_KINDS.NOT_WEBMIN],
    [
      'no RPC right',
      (w) => (w.faults[METHODS.SYSTEM_INFO] = { code: 1, message: 'Invalid user for RPC' }),
      ERROR_KINDS.RPC_DENIED,
    ],
    [
      'no XML::Parser',
      (w) =>
        (w.faults[METHODS.SYSTEM_INFO] = {
          code: 2,
          message: 'XML::Parser Perl module is not installed',
        }),
      ERROR_KINDS.XML_PARSER,
    ],
    [
      'no system-status module',
      (w) =>
        (w.faults[METHODS.SYSTEM_INFO] = {
          code: 5,
          message: 'Webmin module system-status does not exist',
        }),
      ERROR_KINDS.FAULT,
    ],
    ['server off', (w) => (w.down = true), ERROR_KINDS.UNREACHABLE],
    ['HTTP 500', (w) => (w.status = 500), ERROR_KINDS.HTTP],
  ];
  for (const [label, arrange, kind] of cases) {
    const webmin = new FakeWebmin();
    arrange(webmin);
    await assert.rejects(client(webmin).client.read(), (err) => err.kind === kind, label);
  }
  for (const [code, kind] of [
    ['DEPTH_ZERO_SELF_SIGNED_CERT', ERROR_KINDS.TLS],
    ['ERR_SSL_WRONG_VERSION_NUMBER', ERROR_KINDS.NOT_WEBMIN],
    ['ETIMEDOUT', ERROR_KINDS.UNREACHABLE],
  ]) {
    const failing = new WebminClient({
      url: URL_1,
      username: USERNAME,
      password: PASSWORD,
      request: async () => {
        throw Object.assign(new Error(code), { code });
      },
    });
    await assert.rejects(failing.read(), (err) => err.kind === kind, code);
  }
});

test('no secret in the error messages', async () => {
  const webmin = new FakeWebmin();
  webmin.password = 'something else';
  await assert.rejects(client(webmin).client.read(), (err) => {
    assert.ok(!err.message.includes(PASSWORD));
    return true;
  });
});

// --- Snapshot ---------------------------------------------------------------------

test('the snapshot of the real Webmin answers', async () => {
  const { client: webminClient } = client();
  const snapshot = parseSnapshot(await webminClient.read());
  assert.equal(snapshot.version, '2.670');
  assert.equal(snapshot.cpu, 38, '100 - idle');
  assert.deepEqual(snapshot.load, { min1: 1.64, min5: 2.21, min15: 1.75 });
  assert.equal(snapshot.cores, 4);
  assert.equal(Math.round(snapshot.memory * 10) / 10, 65.5);
  assert.equal(Math.round(snapshot.swap * 10) / 10, 98.8);
  assert.deepEqual(
    snapshot.disks.map((disk) => [disk.mount, disk.percent]),
    [['/', 87]],
  );
  assert.equal(snapshot.uptime, 11 * 86400 + 23 * 3600 + 15 * 60);
  assert.equal(snapshot.temperature, null);
  assert.deepEqual(
    {
      count: snapshot.updates.count,
      security: snapshot.updates.security,
      reboot: snapshot.updates.reboot,
    },
    { count: 4, security: 2, reboot: true },
  );
  assert.deepEqual(
    snapshot.updates.packages.map((item) => item.name),
    ['libssl3', 'openssl', 'curl', 'libcurl4'],
    'security first',
  );
});

test('the snapshot of the Home Assistant fixture: several disks, temperatures', () => {
  const data = JSON.parse(
    readFileSync(new URL('./fixtures/webmin/ha-webmin_update.json', import.meta.url), 'utf8'),
  );
  const snapshot = parseSnapshot({ info: data, uptime: [11, 0, 1], updates: null });
  assert.equal(snapshot.cpu, 8);
  assert.equal(snapshot.cores, 12);
  assert.deepEqual(
    snapshot.disks.map((disk) => [disk.mount, disk.percent]),
    [
      ['/', 80],
      ['/media/disk1', 89],
      ['/media/disk2', 38],
    ],
  );
  assert.equal(fullestDisk(snapshot).mount, '/media/disk1');
  assert.equal(snapshot.temperature, 59, 'the hottest of cores and drives');
  assert.equal(snapshot.updates, null);
  assert.equal(snapshot.uptime, 11 * 86400 + 60);
});

test('missing or odd figures are null, never NaN; a server without swap has no swap', () => {
  const snapshot = parseSnapshot({
    info: {
      mem: [1000, 400, 0, 0],
      cpu: [],
      load: 'none',
      disk_fs: [
        { dir: '/etc/hosts', total: 10, used_percent: 50 },
        { dir: '/boot', total: 0, used_percent: 0 },
        { dir: '/data', total: 100, used: 25 },
      ],
    },
    uptime: [],
    updates: null,
  });
  assert.equal(snapshot.memory, 60);
  assert.equal(snapshot.swap, null);
  assert.equal(snapshot.cpu, null);
  assert.equal(snapshot.load, null);
  assert.equal(snapshot.uptime, null);
  assert.deepEqual(
    snapshot.disks.map((disk) => [disk.mount, disk.percent]),
    [['/data', 25]],
  );
  assert.equal(fullestDisk({ disks: [] }), null);
});
