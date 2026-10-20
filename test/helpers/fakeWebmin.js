// -----------------------------------------------------------------------------
// An in-memory Webmin for the tests: answers the XML-RPC calls the client
// makes, from the real answers in test/fixtures/webmin (decoded, so a test
// can change one figure), with HTTP Basic authentication, the 403 of a
// blocked address, faults and outages on demand. `createNetwork` routes the
// requests of the integration (the `request` seam of src/webmin/http.js) to
// the fake servers by base URL.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { decodeResponse } from '../../src/webmin/xmlrpc.js';

export const USERNAME = 'gladys';
export const PASSWORD = 'webmin-password';

const fixtureUrl = (name) => new URL(`../fixtures/webmin/${name}`, import.meta.url);

export const readFixture = (name) => readFileSync(fixtureUrl(name), 'utf8');

/** The decoded value of a fixture answer. */
export const loadFixture = (name) => decodeResponse(readFixture(name));

function encodeValue(value) {
  if (Array.isArray(value)) {
    return `<value><array><data>${value.map(encodeValue).join('')}</data></array></value>`;
  }
  if (value && typeof value === 'object') {
    const members = Object.entries(value)
      .map(([name, item]) => `<member><name>${name}</name>${encodeValue(item)}</member>`)
      .join('');
    return `<value><struct>${members}</struct></value>`;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? `<value><int>${value}</int></value>`
      : `<value><double>${value}</double></value>`;
  }
  const text = String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;');
  return `<value><string>${text}</string></value>`;
}

export const encodeResponse = (value) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<methodResponse>\n<params>\n<param>${encodeValue(
    value,
  )}</param>\n</params>\n</methodResponse>\n`;

export const encodeFault = (code, message) =>
  `<?xml version="1.0"?>\n<methodResponse><fault>${encodeValue({
    faultCode: code,
    faultString: message,
  })}</fault></methodResponse>`;

export class FakeWebmin {
  constructor({
    info = loadFixture('system-info.xml'),
    uptime = loadFixture('uptime.xml'),
    updates = loadFixture('updates.xml'),
    reboot = 1,
    version = 2.67,
    hostname = 'debian-server.lan.',
    username = USERNAME,
    password = PASSWORD,
  } = {}) {
    this.info = info;
    this.uptime = uptime;
    this.updates = updates;
    this.reboot = reboot;
    this.version = version;
    this.hostname = hostname;
    this.username = username;
    this.password = password;
    /** Faults by method: { code, message }. */
    this.faults = {};
    this.down = false;
    /** Forced HTTP status (403, 502…), or a raw body. */
    this.status = null;
    this.body = null;
    this.calls = [];
  }

  methods() {
    return {
      'system-status.collect_system_info': () => this.info,
      'proc.get_system_uptime': () => this.uptime,
      'webmin.get_webmin_version': () => this.version,
      'webmin.get_system_hostname': () => this.hostname,
      'package-updates.list_possible_updates': () => this.updates,
      'package-updates.check_reboot_required': () => this.reboot,
    };
  }

  /** The answer to one request of the integration. */
  handle(path, { method, headers = {}, body = '' }) {
    if (this.down) {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      throw error;
    }
    if (this.status) {
      return { status: this.status, headers: {}, body: this.body ?? '<html></html>' };
    }
    if (path !== '/xmlrpc.cgi' || method !== 'POST') {
      return { status: 404, headers: {}, body: '<html>Not found</html>' };
    }
    const expected = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
    if (headers.authorization !== expected) {
      return { status: 401, headers: {}, body: '<html>Unauthorized</html>' };
    }
    const name = body.match(/<methodName>([^<]+)<\/methodName>/)?.[1];
    this.calls.push(name);
    if (this.body) {
      return { status: 200, headers: {}, body: this.body };
    }
    const fault = this.faults[name];
    if (fault) {
      return { status: 200, headers: {}, body: encodeFault(fault.code, fault.message) };
    }
    const handler = this.methods()[name];
    if (!handler) {
      const module = name.split('.')[0];
      return {
        status: 200,
        headers: {},
        body: encodeFault(5, `Webmin module ${module} does not exist`),
      };
    }
    return { status: 200, headers: {}, body: encodeResponse(handler()) };
  }
}

/**
 * @param {Record<string, FakeWebmin>} servers by base URL (`https://192.0.2.10:10000`)
 */
export function createNetwork(servers) {
  const requests = [];
  return {
    requests,
    async request(url, options = {}) {
      requests.push({ url, ...options });
      for (const [base, server] of Object.entries(servers)) {
        if (url.startsWith(`${base}/`)) {
          return server.handle(url.slice(base.length), options);
        }
      }
      const error = new Error('getaddrinfo ENOTFOUND');
      error.code = 'ENOTFOUND';
      throw error;
    },
  };
}
