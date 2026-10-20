// -----------------------------------------------------------------------------
// Webmin client: the XML-RPC interface of Webmin (`/xmlrpc.cgi`, port 10000,
// HTTPS with the self-signed certificate Webmin creates at installation).
// Each call runs a function of a Webmin module on the server, as the Webmin
// user given, with HTTP Basic authentication. Calls used (Webmin 2.670):
//
//   system-status.collect_system_info('', ['package-updates'])
//       load, CPU, memory and swap (kB), disks, temperatures: what the
//       Webmin dashboard shows; the package list skipped (read apart);
//   proc.get_system_uptime()                 [days, hours, minutes]
//   webmin.get_webmin_version()              2.670 (a double)
//   webmin.get_system_hostname()             at detection
//   package-updates.list_possible_updates()  the pending updates, with the
//       `security` flag (an apt source named "…-security"), from the cache
//       of the Webmin module: no apt or dnf run by Gladys;
//   package-updates.check_reboot_required()  1 or 0.
//
// The updates are read once an hour (they do not change faster, and the
// module may run the package manager when its cache expired), the rest at
// every read. A server without the "Software Package Updates" module still
// gives its system figures: its updates stay unknown.
//
// Read only: none of these functions changes anything on the server.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';
import { XmlRpcFault, decodeResponse, encodeCall } from './xmlrpc.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: off, wrong address, firewall, Webmin stopped
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // user name or password refused (HTTP 401)
  BLOCKED: 'blocked', // the address is blocked after failed logins (HTTP 403)
  RPC_DENIED: 'rpc_denied', // the user may not make RPC calls (fault 1)
  XML_PARSER: 'xml_parser', // XML::Parser missing on the server (fault 2)
  NOT_WEBMIN: 'not_webmin', // something answers, not the XML-RPC of Webmin
  REDIRECT: 'redirect', // the address redirects (HTTP on the HTTPS port)
  FAULT: 'fault', // any other fault of Webmin
  HTTP: 'http', // any other HTTP error
});

// Fault codes of xmlrpc.cgi.
export const FAULTS = Object.freeze({
  RPC_DENIED: 1,
  XML_PARSER: 2,
  NO_MODULE: 5,
  CALL_FAILED: 7,
});

export class WebminError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status, code }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'WebminError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

export const METHODS = Object.freeze({
  SYSTEM_INFO: 'system-status.collect_system_info',
  UPTIME: 'proc.get_system_uptime',
  VERSION: 'webmin.get_webmin_version',
  HOSTNAME: 'webmin.get_system_hostname',
  UPDATES: 'package-updates.list_possible_updates',
  REBOOT: 'package-updates.check_reboot_required',
});

// The version and the host name are read again after this long.
export const REDETECT_AFTER_MS = 3600_000;
// The pending updates and the reboot flag: once an hour.
export const UPDATES_EVERY_MS = 3600_000;

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// The XML-RPC answer is TLS on an HTTP request: Node reports a parse error.
const PROTOCOL_CODES = new Set(['HPE_INVALID_CONSTANT', 'EPROTO', 'ERR_SSL_WRONG_VERSION_NUMBER']);

/** The version as Webmin writes it ("2.670", not 2.67). */
export const formatVersion = (value) =>
  typeof value === 'number' ? value.toFixed(3) : typeof value === 'string' ? value.trim() : null;

export class WebminClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} options.username
   * @param {string} options.password
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   * @param {() => number} [options.now]
   */
  constructor({
    url,
    username,
    password,
    insecure = false,
    request = httpRequest,
    timeoutMs = 20_000,
    now = () => Date.now(),
  }) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.detectedAt = null;
    this.static = { version: null, hostname: null };
    this.updatesAt = null;
    /** Counts the reads of the updates: the hub compares only what is new. */
    this.updatesSerial = 0;
    /** @type {{ packages: Array<object>, reboot: boolean|null }|null} null: unknown */
    this.updates = null;
  }

  headers() {
    const token = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    return {
      'content-type': 'text/xml',
      accept: 'text/xml',
      authorization: `Basic ${token}`,
    };
  }

  /**
   * One XML-RPC call.
   * @returns {Promise<unknown>} the decoded value
   * @throws {WebminError}
   */
  async call(method, params = []) {
    let response;
    try {
      response = await this.request(`${this.url}/xmlrpc.cgi`, {
        method: 'POST',
        headers: this.headers(),
        body: encodeCall(method, params),
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (TLS_CODES.has(err.code)) {
        throw new WebminError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
      }
      if (err.code === 'ERESPONSETOOLARGE') {
        throw new WebminError(ERROR_KINDS.HTTP, 'Answer too large');
      }
      if (PROTOCOL_CODES.has(err.code)) {
        throw new WebminError(ERROR_KINDS.NOT_WEBMIN, `Protocol mismatch (${err.code})`);
      }
      throw new WebminError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
    }
    const { status } = response;
    if (status === 401) {
      throw new WebminError(ERROR_KINDS.AUTH, 'Credentials refused (HTTP 401)', { status });
    }
    // miniserv blocks an address for `blockhost_time` (60 s) after
    // `blockhost_failures` (5) failed logins, even with the right password.
    if (status === 403) {
      throw new WebminError(ERROR_KINDS.BLOCKED, 'Address blocked by Webmin (HTTP 403)', {
        status,
      });
    }
    // A reverse proxy in front of a stopped Webmin: silence, like no answer at all.
    if (status === 502 || status === 503 || status === 504) {
      throw new WebminError(
        ERROR_KINDS.UNREACHABLE,
        `No Webmin behind the proxy (HTTP ${status})`,
        {
          status,
        },
      );
    }
    if (status >= 300 && status < 400) {
      throw new WebminError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new WebminError(ERROR_KINDS.NOT_WEBMIN, 'No /xmlrpc.cgi at this address (HTTP 404)', {
        status,
      });
    }
    if (status !== 200) {
      throw new WebminError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
    try {
      return decodeResponse(response.body);
    } catch (err) {
      if (err instanceof XmlRpcFault) {
        const kind =
          err.code === FAULTS.RPC_DENIED
            ? ERROR_KINDS.RPC_DENIED
            : err.code === FAULTS.XML_PARSER
              ? ERROR_KINDS.XML_PARSER
              : ERROR_KINDS.FAULT;
        // The fault string of Webmin names the module or the Perl error, never a secret.
        throw new WebminError(kind, `${method}: fault ${err.code} (${err.message.slice(0, 160)})`, {
          code: err.code,
        });
      }
      // An HTML page: the login page of another service, a portal.
      throw new WebminError(ERROR_KINDS.NOT_WEBMIN, 'The answer is not XML-RPC');
    }
  }

  /** A call whose failure (a missing module, a Perl error) is not a server failure. */
  async optional(method, params = []) {
    try {
      return { value: await this.call(method, params) };
    } catch (err) {
      if (err.kind === ERROR_KINDS.FAULT) {
        return { value: null, fault: err };
      }
      throw err;
    }
  }

  /**
   * Read the server.
   * @param {object} [options]
   * @param {boolean} [options.updates] read the updates now, whatever their age
   * @returns {Promise<{ info: object, uptime: unknown, version: string|null,
   *   hostname: string|null, updates: object|null, updatesSerial: number, notes: string[] }>}
   * @throws {WebminError}
   */
  async read({ updates = false } = {}) {
    const notes = [];
    const info = await this.call(METHODS.SYSTEM_INFO, ['', ['package-updates']]);
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
      throw new WebminError(ERROR_KINDS.NOT_WEBMIN, 'Unexpected system information');
    }
    const uptime = await this.optional(METHODS.UPTIME);
    if (uptime.fault) {
      notes.push(uptime.fault.message);
    }

    const now = this.now();
    if (this.detectedAt === null || now - this.detectedAt >= REDETECT_AFTER_MS) {
      const version = await this.optional(METHODS.VERSION);
      const hostname = await this.optional(METHODS.HOSTNAME);
      this.static = {
        version: formatVersion(version.value),
        hostname:
          typeof hostname.value === 'string' ? hostname.value.trim().replace(/\.+$/, '') : null,
      };
      this.detectedAt = now;
    }

    if (updates || this.updatesAt === null || now - this.updatesAt >= UPDATES_EVERY_MS) {
      const list = await this.optional(METHODS.UPDATES);
      if (list.fault || !Array.isArray(list.value)) {
        // No "Software Package Updates" module, or no access to it.
        this.updates = null;
        if (list.fault) {
          notes.push(list.fault.message);
        }
      } else {
        const reboot = await this.optional(METHODS.REBOOT);
        this.updates = {
          packages: list.value.filter((item) => item && typeof item === 'object'),
          reboot: reboot.fault ? null : Number(reboot.value) === 1,
        };
      }
      this.updatesAt = now;
      this.updatesSerial += 1;
    }

    return {
      info,
      uptime: uptime.value,
      version: this.static.version,
      hostname: this.static.hostname,
      updates: this.updates,
      updatesSerial: this.updatesSerial,
      notes,
    };
  }
}
