// -----------------------------------------------------------------------------
// The Webmin hub: one record per configured server, read on a timer of the
// container (the interval chosen in the configuration, 5 minutes by
// default; the updates once an hour); the states of the devices the user
// added published to Gladys when they change, the scene events fired on
// transitions (src/alerts.js), and the views the widget and the scene
// actions read.
//
// Gladys never polls these devices (should_poll: false): the interval is
// beyond the fixed list of the core scheduler, and the scene events must
// fire for every server, added to Gladys or not.
//
// Webmin blocks an address after 5 failed logins in a row (`blockhost_failures`,
// 60 s, HTTP 403 even with the right password afterwards): a server whose
// credentials were refused is read again only every 30 minutes, or at once
// when the user acts (configuration saved, Test the connection, Refresh).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { Watcher } from './alerts.js';
import { buildDevice, deviceIds, featureValues, parseDeviceId } from './devices.js';
import { ERROR_KINDS, WebminClient } from './webmin/client.js';
import { fullestDisk, parseSnapshot } from './webmin/model.js';
import { hostOf } from './config.js';
import { createIssueLog } from './logs.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'webmin-hub' });

export const WIDGET_KEY = 'server';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  SECURITY: 'security_updates_available',
  DISK: 'disk_almost_full',
  UNREACHABLE: 'server_unreachable',
});

export const HUB_TIMINGS = {
  // A server that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 30_000,
  // Failures in a row before a server counts as unreachable (scene event).
  downAfterFailures: 2,
  // Credentials refused: read again this late only (Webmin blocks the address).
  authRetryMs: 30 * 60_000,
  // The values that move at every read (CPU, load…): at most this often.
  noisyEveryMs: 60_000,
  // An unchanged value is sent again after this long.
  heartbeatMs: 6 * 3600_000,
  // A scene action reads Webmin again when the last read is older.
  freshMs: 30_000,
  // A disk not seen for a week is forgotten.
  forgetAfterMs: 7 * 24 * 3600_000,
};

// Package names listed in a scene event or a summary, at most (the rest is counted).
export const MAX_LISTED_PACKAGES = 10;

const LOGIN_KINDS = new Set([ERROR_KINDS.AUTH, ERROR_KINDS.BLOCKED]);

const signature = (server, config) =>
  JSON.stringify([server.url, server.username, server.password, config.allowSelfSigned]);

/** "openssl, libssl3, +2" */
export function listPackages(packages, max = MAX_LISTED_PACKAGES) {
  const names = packages.map((item) => item.name);
  const listed = names.slice(0, max);
  return `${listed.join(', ')}${names.length > listed.length ? `, +${names.length - listed.length}` : ''}`;
}

export class WebminHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/webmin/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<number, object>} server records, by slot */
    this.records = new Map();
    this.watcher = new Watcher();
    /** Last value published per feature external id, and when. */
    this.published = new Map();
    this.publishedAt = new Map();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.pollTimer = null;
    this.stopped = false;
    // Failures that repeat at every read: one line, then one when they heal.
    this.issues = createIssueLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.watcher = new Watcher(await this.store.load());
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.published.clear();
    this.publishedAt.clear();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.config?.language !== config.language;
    this.config = config;
    const wanted = new Map(config.servers.map((server) => [server.slot, server]));
    let forgotten = false;
    for (const [slot, record] of this.records) {
      const server = wanted.get(slot);
      if (!server || record.signature !== signature(server, config)) {
        this.dropRecord(record);
        this.records.delete(slot);
        // Another address may be another machine: what was announced for the
        // old one must not fire for the new one (recorded again, silently).
        if (server && server.url !== record.server.url) {
          forgotten = this.watcher.forgetSlot(slot) || forgotten;
        }
      }
    }
    // A slot whose address is being corrected keeps its history.
    const kept = new Set([...wanted.keys(), ...config.invalidSlots]);
    if (this.watcher.forgetSlots(kept) || forgotten) {
      this.store.save(this.watcher.saved);
    }
    for (const server of config.servers) {
      // Also when the address changed while the integration was stopped.
      if (this.watcher.checkAddress(server.slot, server.url)) {
        this.store.save(this.watcher.saved);
      }
      const record = this.records.get(server.slot);
      if (record) {
        record.server = server; // a new name only
      } else {
        this.records.set(server.slot, this.newRecord(server, config));
      }
    }
    if (languageChanged) {
      this.discovered = null;
    }
    // A configuration saved is a user action: credentials refused before are
    // tried again at once.
    await this.pollAll({ publish: true, force: true });
    this.schedulePoll();
  }

  newRecord(server, config) {
    return {
      server,
      signature: signature(server, config),
      client: new WebminClient({
        url: server.url,
        username: server.username,
        password: server.password,
        insecure: config.allowSelfSigned,
        request: this.request,
        now: this.now,
      }),
      /** @type {object|null} the last snapshot read (src/webmin/model.js) */
      snapshot: null,
      updatesSerial: 0,
      readAt: 0,
      error: null,
      failures: 0,
      // Announced unreachable before a restart: not announced again.
      down: this.watcher.isDown(server.slot),
      polling: null,
      retryTimer: null,
      dropped: false,
    };
  }

  dropRecord(record) {
    record.dropped = true;
    clearTimeout(record.retryTimer);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    for (const record of this.records.values()) {
      clearTimeout(record.retryTimer);
    }
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || this.records.size === 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.issues.ok('poll', 'Polling works again');
      } catch (err) {
        this.issues.fail('poll', 'error', 'Poll failed', err);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Names and identities ------------------------------------------------------

  /** The server name: the one configured, the host name Webmin gives, or the address. */
  serverName(record) {
    return record.server.name ?? record.snapshot?.hostname ?? hostOf(record.server.url);
  }

  label(record) {
    return `Server ${record.server.slot} (${this.serverName(record)})`;
  }

  serverId(slot) {
    return deviceIds(this.gladys, slot).device;
  }

  isCreated(slot) {
    const id = this.serverId(slot);
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  context(record) {
    return {
      online: !record.down && record.error === null && record.snapshot !== null,
      fullest: fullestDisk(record.snapshot),
      ...this.watcher.known(record.server.slot),
    };
  }

  // --- Devices -----------------------------------------------------------------

  discoveredDevices() {
    const devices = [];
    for (const record of [...this.records.values()].sort((a, b) => a.server.slot - b.server.slot)) {
      if (!record.snapshot) {
        continue;
      }
      devices.push(
        buildDevice(this.gladys, {
          slot: record.server.slot,
          name: this.serverName(record),
          snapshot: record.snapshot,
          context: this.context(record),
          language: this.config.language,
        }),
      );
    }
    return devices;
  }

  /** Publish the Discovery list when it changed. */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale device.
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.issues.ok('discovery', 'Discovered devices accepted again');
    } catch (err) {
      this.issues.fail('discovery', 'warn', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the servers, publish the list again. */
  async rediscover() {
    await this.pollAll({ force: true });
    await this.publishDevices({ force: true });
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const record = this.find(device.external_id);
    if (!record) {
      return;
    }
    // A device deleted then added again is a new row in Gladys: no badge yet.
    this.transports.delete(device.external_id);
    await this.publishRecordStates(record, { force: true });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** The user deleted a device: forget what was sent for it. */
  onDeviceDeleted(device) {
    const id = device?.external_id;
    if (typeof id !== 'string') {
      return;
    }
    this.transports.delete(id);
    for (const map of [this.published, this.publishedAt]) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(`${id}:`)) {
          map.delete(key);
        }
      }
    }
  }

  // --- Reading the servers ---------------------------------------------------------

  /**
   * @param {object} [options]
   * @param {boolean} [options.publish] publish the Discovery list even unchanged
   * @param {boolean} [options.force] a user action: read the updates too, and a
   *   server whose credentials were refused
   */
  async pollAll({ publish = false, force = false } = {}) {
    const records = [...this.records.values()];
    const changes = await Promise.all(records.map((record) => this.poll(record, { force })));
    await this.afterChanges(changes.some(Boolean), { publish });
  }

  /** Gladys asks for a refresh (onPoll): read that server now. */
  async pollDevice(device) {
    const record = this.find(device.external_id);
    if (record) {
      await this.afterChanges(await this.poll(record));
    }
  }

  /** Read again the servers whose last read is older than `freshMs` (scene actions). */
  async refreshIfStale(records = [...this.records.values()]) {
    const stale = records.filter((record) => this.now() - record.readAt >= this.timings.freshMs);
    if (stale.length > 0) {
      const changes = await Promise.all(stale.map((record) => this.poll(record)));
      await this.afterChanges(changes.some(Boolean));
    }
  }

  /**
   * Read one server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget should be refreshed now
   */
  poll(record, { force = false } = {}) {
    if (
      !force &&
      LOGIN_KINDS.has(record.error?.kind) &&
      this.now() - record.readAt < this.timings.authRetryMs
    ) {
      return Promise.resolve(false);
    }
    if (record.polling) {
      // A user action during a timer read: read again once it is over, so
      // that the updates are read too.
      return force ? record.polling.then(() => this.poll(record, { force })) : record.polling;
    }
    record.polling = this.read(record, { force }).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record, { force }) {
    try {
      return await this.applySuccess(record, await record.client.read({ updates: force }));
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
  }

  async applySuccess(record, read) {
    if (record.dropped) {
      return false;
    }
    const { slot } = record.server;
    const now = this.now();
    const snapshot = parseSnapshot(read);
    let widgetChanged = record.error !== null || record.readAt === 0;
    if (record.error) {
      logger.info(`${this.label(record)} answers again`);
    }
    if (!record.snapshot || record.snapshot.version !== snapshot.version) {
      logger.info(`${this.label(record)}: Webmin ${snapshot.version ?? '(version unknown)'}`);
    }
    for (const note of read.notes) {
      this.issues.fail(`note:${slot}:${note}`, 'info', `${this.label(record)}: ${note}`);
    }
    const updatesRead = read.updatesSerial !== record.updatesSerial;
    record.snapshot = snapshot;
    record.updatesSerial = read.updatesSerial;
    record.failures = 0;
    record.down = false;
    record.error = null;
    record.readAt = now;
    this.watcher.setDown(slot, false);

    const server = this.serverName(record);
    const serverDevice = this.serverId(slot);
    this.watcher.remember(slot, snapshot);

    for (const { disk, threshold } of this.watcher.disks(slot, snapshot.disks, now)) {
      logger.debug(`${server} ${disk.mount}: ${disk.percent} % used (step ${threshold} %)`);
      widgetChanged = true;
      await this.fireEvent(TRIGGERS.DISK, {
        server: serverDevice,
        threshold,
        server_name: server,
        mount_point: disk.mount,
        used_percent: Math.round(disk.percent * 10) / 10,
        free_gb: disk.free === null ? null : Math.round((disk.free / 1024 ** 3) * 10) / 10,
      });
    }
    if (updatesRead && snapshot.updates) {
      widgetChanged = true;
      const fresh = this.watcher.securityUpdates(slot, snapshot.updates);
      if (fresh.length > 0) {
        logger.debug(`${server}: ${fresh.length} new security update(s)`);
        await this.fireEvent(TRIGGERS.SECURITY, {
          server: serverDevice,
          server_name: server,
          new_count: fresh.length,
          security_count: snapshot.updates.security,
          updates_count: snapshot.updates.count,
          packages: listPackages(fresh),
        });
      }
    }
    this.watcher.forgetStale(slot, now, this.timings.forgetAfterMs);
    this.store.save(this.watcher.saved);

    await this.publishRecordStates(record);
    return widgetChanged;
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    record.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`${this.label(record)}: ${err.message}`);
    } else {
      // The same failure at every read: logged once, "answers again" when it heals.
      logger.debug(`${this.label(record)}: ${err.message}`);
    }
    // Only silence counts as unreachable: a refused password is a
    // configuration problem, reported by the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      record.failures = 0;
      return wasError !== err.kind;
    }
    record.failures += 1;
    if (record.failures === 1) {
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      this.watcher.setDown(record.server.slot, true);
      this.store.save(this.watcher.saved);
      await this.fireEvent(TRIGGERS.UNREACHABLE, {
        server: this.serverId(record.server.slot),
        server_name: this.serverName(record),
        error: pick(ERROR_TEXT[err.kind], this.config.language),
      });
      await this.publishRecordStates(record);
      return true;
    }
    if (record.down) {
      // Offline again after a resync or past the heartbeat (deduplicated).
      await this.publishRecordStates(record);
    }
    return wasError !== err.kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .then(() => this.issues.ok('retry', 'Retry works again'))
        .catch((err) => this.issues.fail('retry', 'error', 'Retry failed', err));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.issues.ok('scene', 'Scene events accepted again');
    } catch (err) {
      this.issues.fail('scene', 'warn', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /**
   * The states of the device of a server, when the user added it.
   * @param {object} record
   * @param {object} [options]
   * @param {boolean} [options.force] send even unchanged values (a device just added)
   */
  async publishRecordStates(record, { force = false } = {}) {
    const { slot } = record.server;
    if (!this.isCreated(slot)) {
      return;
    }
    const context = this.context(record);
    let values;
    if (record.error) {
      // Nothing read: only say the server is offline once it is.
      if (!record.down) {
        return;
      }
      values = featureValues(this.gladys, { slot, snapshot: null, context }).filter(
        (entry) => entry.value !== null,
      );
    } else if (record.snapshot) {
      values = featureValues(this.gladys, { slot, snapshot: record.snapshot, context });
    } else {
      return;
    }
    await this.sendStates(values, { force });
  }

  /** Keep what must be sent now: changed, not too soon. */
  async sendStates(values, { force = false } = {}) {
    const now = this.now();
    const states = [];
    for (const { externalId, value, noisy } of values) {
      if (value === null) {
        continue;
      }
      const last = this.published.get(externalId);
      const at = this.publishedAt.get(externalId);
      if (!force) {
        if (last === value && at !== undefined && now - at < this.timings.heartbeatMs) {
          continue;
        }
        if (last !== value && noisy && at !== undefined && now - at < this.timings.noisyEveryMs) {
          continue;
        }
      }
      states.push({ externalId, value });
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishStates(
        states.map(({ externalId, value }) => ({
          device_feature_external_id: externalId,
          state: value,
        })),
      );
      for (const { externalId, value } of states) {
        this.published.set(externalId, value);
        this.publishedAt.set(externalId, now);
      }
      this.issues.ok('states', 'States accepted again');
    } catch (err) {
      this.issues.fail('states', 'warn', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable". */
  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      if (record.readAt === 0 || !this.isCreated(record.server.slot)) {
        continue;
      }
      const id = this.serverId(record.server.slot);
      const transport =
        record.error === null ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(id) !== transport) {
        entries.push({ external_id: id, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.issues.ok('transports', 'Transports accepted again');
    } catch (err) {
      this.issues.fail('transports', 'warn', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name: connected when every server answers. */
  connectionStatus() {
    if (!this.config) {
      return { connected: false, message: CONNECTION_TEXT.noServer };
    }
    const { servers, invalidSlots } = this.config;
    if (servers.length === 0) {
      return {
        connected: false,
        message: invalidSlots.length ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noServer,
      };
    }
    const failing = [...this.records.values()].filter((record) => record.error);
    if (failing.length === 0 && invalidSlots.length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noServer)) {
      const parts = failing.map((record) =>
        labelled(this.serverName(record), pick(ERROR_TEXT[record.error.kind], language), language),
      );
      if (invalidSlots.length) {
        parts.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = parts.join(' · ').slice(0, 200);
    }
    // Connected while one server of several still answers.
    return { connected: failing.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.ok('connection', 'Connection status accepted again');
    } catch (err) {
      this.issues.fail('connection', 'warn', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene actions, report) --------------------------------------------

  /** The record of a server device, null when not ours or not configured. */
  find(externalId) {
    const parsed = parseDeviceId(this.gladys, externalId);
    return parsed ? (this.records.get(parsed.slot) ?? null) : null;
  }

  /** What the widget and the scene actions show of a server. */
  view(record) {
    const { snapshot } = record;
    return {
      name: this.serverName(record),
      online: record.error === null && snapshot !== null,
      error: record.error,
      snapshot,
      disk: snapshot ? fullestDisk(snapshot) : null,
    };
  }

  /** "Test the connection": read every server now, one line each. */
  async testConnection() {
    await this.pollAll({ publish: true, force: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (this.records.size === 0) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const lines = [...this.records.values()].map((record) => {
        const name = this.serverName(record);
        if (record.error) {
          return labelled(name, pick(ERROR_TEXT[record.error.kind], language), language);
        }
        const { snapshot } = record;
        const parts = [
          text.ok,
          `Webmin ${snapshot.version ?? '?'}`,
          text.disks(snapshot.disks.length),
        ];
        parts.push(
          snapshot.updates
            ? text.updates(snapshot.updates.count, snapshot.updates.security)
            : text.noUpdates,
        );
        return labelled(name, parts.join(', '), language);
      });
      if (this.config?.invalidSlots.length) {
        lines.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /** Throws the reason no server can answer a scene action, if any. */
  assertReadable() {
    if (this.records.size === 0) {
      throw new Error(pick(ACTION_TEXT.noServer, this.config?.language));
    }
  }
}
