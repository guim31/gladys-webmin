// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to three Webmin servers, each in its own slot. The slot number is the
// device identity: changing the address of a slot (a new IP, a name instead
// of an IP) keeps the device and its history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3];

// Port of Webmin (miniserv), HTTPS by default since its installation.
export const DEFAULT_PORT = 10000;

// Refresh intervals offered in the configuration, in seconds. The updates
// are read once an hour whatever the interval (src/webmin/client.js).
export const POLL_INTERVALS = ['60', '120', '300', '600'];

export const DEFAULT_CONFIG = {
  server_1_url: '',
  server_1_username: '',
  server_1_password: '',
  server_1_name: '',
  server_2_url: '',
  server_2_username: '',
  server_2_password: '',
  server_2_name: '',
  server_3_url: '',
  server_3_username: '',
  server_3_password: '',
  server_3_name: '',
  poll_interval: '300',
  allow_self_signed: true,
  language: 'fr',
};

export const MAX_NAME_LENGTH = 40;

// What follows the root of the web interface in a URL copied from the
// browser (`/sysinfo.cgi`, `/xmlrpc.cgi`, `/?dashboard`): the client adds
// `/xmlrpc.cgi` on its own.
const INTERFACE_PATH = /\/([\w-]+\.cgi|index\.html)$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, port 10000 added), `host:port`, or the URL copied from the
 * browser (`https://server.lan:10000/`). HTTPS by default, as Webmin. A path
 * is kept (Webmin behind a reverse proxy sub-path); a page, the query and
 * the fragment are dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the messages.
  if (url.username || url.password) {
    return null;
  }
  // A bare host means the default Webmin port; an explicit scheme without
  // a port means a reverse proxy on 80/443.
  if (!hasScheme && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme, no default port). */
export const hostOf = (url) =>
  url.replace(/^https?:\/\//, '').replace(new RegExp(`:${DEFAULT_PORT}(?=/|$)`), '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const servers = [];
  const invalid = [];
  for (const slot of SLOTS) {
    const typed = text(`server_${slot}_url`);
    if (!typed) {
      continue;
    }
    const url = parseServerUrl(typed);
    if (!url) {
      invalid.push(slot);
      continue;
    }
    // A pasted password often carries a trailing new line; spaces inside are kept.
    const password =
      typeof source[`server_${slot}_password`] === 'string'
        ? source[`server_${slot}_password`].replace(/^[\r\n]+|[\r\n]+$/g, '')
        : '';
    servers.push({
      slot,
      url,
      username: text(`server_${slot}_username`),
      password,
      name: text(`server_${slot}_name`).slice(0, MAX_NAME_LENGTH) || null,
    });
  }

  return {
    servers,
    invalidSlots: invalid,
    // On by default: Webmin creates a self-signed certificate at installation.
    allowSelfSigned: !(source.allow_self_signed === false || source.allow_self_signed === 'false'),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
