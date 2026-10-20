// -----------------------------------------------------------------------------
// The Gladys device of a Webmin server, proposed in the Discovery tab: one per
// configured server, the user adds the ones to follow.
//
// What Webmin adds to the system monitors (Glances, Beszel, Netdata): the
// package updates waiting on the server, the security ones apart, and
// whether it waits for a reboot. Then the essentials of its dashboard: load,
// CPU, memory, swap, the fullest disk, the highest temperature, uptime.
//
// Identity: the configuration slot of the server. Changing its address (a
// new IP, a name instead of an IP) keeps the device and its history.
//
// Category/type couples come from the core table (see
// test/gladys-rules.test.js). The core has no generic "percent" category:
// usage percentages are `level-sensor/liquid-level-percent` (a fill level,
// the couple Glances, OctoPrint and Brother already use, 0-100 gauge). Load
// averages have no category at all: `unknown/unknown`, three of them, so
// their names show. Online and reboot required: `input/binary`, two of them.
//
// Published with should_poll: false: the integration reads Webmin on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPES = Object.freeze({ SERVER: 'server' });

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  ONLINE: 'online',
  CPU: 'cpu',
  MEMORY: 'memory',
  SWAP: 'swap',
  LOAD_1: 'load_1',
  LOAD_5: 'load_5',
  LOAD_15: 'load_15',
  DISK_MAX: 'disk_max',
  TEMPERATURE_MAX: 'temperature_max',
  UPTIME: 'uptime',
  UPDATES: 'updates',
  SECURITY_UPDATES: 'security_updates',
  REBOOT_REQUIRED: 'reboot_required',
});

const K = FEATURE_KEYS;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [K.ONLINE]: 'Online',
    [K.CPU]: 'CPU',
    [K.MEMORY]: 'Memory',
    [K.SWAP]: 'Swap',
    [K.LOAD_1]: 'Load (1 min)',
    [K.LOAD_5]: 'Load (5 min)',
    [K.LOAD_15]: 'Load (15 min)',
    [K.DISK_MAX]: 'Fullest disk',
    [K.TEMPERATURE_MAX]: 'Highest temperature',
    [K.UPTIME]: 'Uptime',
    [K.UPDATES]: 'Available updates',
    [K.SECURITY_UPDATES]: 'Security updates',
    [K.REBOOT_REQUIRED]: 'Reboot required',
  },
  fr: {
    [K.ONLINE]: 'En ligne',
    [K.CPU]: 'Processeur',
    [K.MEMORY]: 'Mémoire',
    [K.SWAP]: 'Swap',
    [K.LOAD_1]: 'Charge (1 min)',
    [K.LOAD_5]: 'Charge (5 min)',
    [K.LOAD_15]: 'Charge (15 min)',
    [K.DISK_MAX]: 'Disque le plus plein',
    [K.TEMPERATURE_MAX]: 'Température la plus haute',
    [K.UPTIME]: 'Durée de fonctionnement',
    [K.UPDATES]: 'Mises à jour disponibles',
    [K.SECURITY_UPDATES]: 'Mises à jour de sécurité',
    [K.REBOOT_REQUIRED]: 'Redémarrage requis',
  },
  de: {
    [K.ONLINE]: 'Online',
    [K.CPU]: 'Prozessor',
    [K.MEMORY]: 'Arbeitsspeicher',
    [K.SWAP]: 'Auslagerung',
    [K.LOAD_1]: 'Last (1 Min.)',
    [K.LOAD_5]: 'Last (5 Min.)',
    [K.LOAD_15]: 'Last (15 Min.)',
    [K.DISK_MAX]: 'Vollster Datenträger',
    [K.TEMPERATURE_MAX]: 'Höchste Temperatur',
    [K.UPTIME]: 'Laufzeit',
    [K.UPDATES]: 'Verfügbare Updates',
    [K.SECURITY_UPDATES]: 'Sicherheitsupdates',
    [K.REBOOT_REQUIRED]: 'Neustart erforderlich',
  },
  es: {
    [K.ONLINE]: 'En línea',
    [K.CPU]: 'Procesador',
    [K.MEMORY]: 'Memoria',
    [K.SWAP]: 'Swap',
    [K.LOAD_1]: 'Carga (1 min)',
    [K.LOAD_5]: 'Carga (5 min)',
    [K.LOAD_15]: 'Carga (15 min)',
    [K.DISK_MAX]: 'Disco más lleno',
    [K.TEMPERATURE_MAX]: 'Temperatura más alta',
    [K.UPTIME]: 'Tiempo en marcha',
    [K.UPDATES]: 'Actualizaciones disponibles',
    [K.SECURITY_UPDATES]: 'Actualizaciones de seguridad',
    [K.REBOOT_REQUIRED]: 'Reinicio necesario',
  },
};

export const MODEL = 'Webmin';

// Display bounds (the core never applies them on write).
export const BOUNDS = Object.freeze({
  LOAD_MAX: 1000,
  UPTIME_MAX_DAYS: 36500,
  UPDATES_MAX: 10000,
  TEMPERATURE: [-50, 150],
});

/** External ids of the device of a server slot. */
export function deviceIds(gladys, slot) {
  return gladys.externalIds(DEVICE_TYPES.SERVER, `${slot}`);
}

/** The slot of a device external id, null when not ours. */
export function parseDeviceId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  const prefix = gladys.externalIds(DEVICE_TYPES.SERVER, '').device;
  if (!externalId.startsWith(prefix)) {
    return null;
  }
  const match = externalId.slice(prefix.length).match(/^(\d+)$/);
  return match ? { slot: Number(match[1]) } : null;
}

const round = (value, digits) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

// Feature shapes. `noisy`: moves at every read, published at most once a
// minute (src/hub.js).
const percent = () => ({
  definition: {
    category: CATEGORY.LEVEL_SENSOR,
    type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    unit: UNIT.PERCENT,
    min: 0,
    max: 100,
  },
  digits: 1,
});
const binary = () => ({
  definition: { category: CATEGORY.INPUT, type: TYPE.SENSOR.BINARY, min: 0, max: 1 },
  digits: 0,
});
const load = () => ({
  definition: {
    category: CATEGORY.UNKNOWN,
    type: TYPE.UNKNOWN.UNKNOWN,
    min: 0,
    max: BOUNDS.LOAD_MAX,
  },
  digits: 2,
});
const counter = () => ({
  definition: {
    category: CATEGORY.COUNTER_SENSOR,
    type: TYPE.SENSOR.INTEGER,
    min: 0,
    max: BOUNDS.UPDATES_MAX,
  },
  digits: 0,
});

/**
 * The features of the server device: which exist for a snapshot, their
 * shape, their value. `context` carries what the hub knows beyond the
 * snapshot: { online, hasUpdates, hasReboot, hasSwap, hasTemperature }.
 */
const BLUEPRINT = [
  { key: K.ONLINE, ...binary(), value: (_, ctx) => (ctx.online ? 1 : 0) },
  { key: K.CPU, ...percent(), noisy: true, value: (s) => s?.cpu },
  { key: K.MEMORY, ...percent(), noisy: true, value: (s) => s?.memory },
  { key: K.SWAP, ...percent(), noisy: true, when: (_, ctx) => ctx.hasSwap, value: (s) => s?.swap },
  { key: K.LOAD_1, ...load(), noisy: true, value: (s) => s?.load?.min1 },
  { key: K.LOAD_5, ...load(), noisy: true, value: (s) => s?.load?.min5 },
  { key: K.LOAD_15, ...load(), noisy: true, value: (s) => s?.load?.min15 },
  { key: K.DISK_MAX, ...percent(), value: (s, ctx) => ctx.fullest?.percent },
  {
    key: K.TEMPERATURE_MAX,
    definition: {
      category: CATEGORY.DEVICE_TEMPERATURE_SENSOR,
      type: TYPE.SENSOR.DECIMAL,
      unit: UNIT.CELSIUS,
      min: BOUNDS.TEMPERATURE[0],
      max: BOUNDS.TEMPERATURE[1],
    },
    digits: 0,
    noisy: true,
    when: (_, ctx) => ctx.hasTemperature,
    value: (s) => s?.temperature,
  },
  {
    key: K.UPTIME,
    definition: {
      category: CATEGORY.DURATION,
      type: TYPE.DURATION.DECIMAL,
      unit: UNIT.DAYS,
      min: 0,
      max: BOUNDS.UPTIME_MAX_DAYS,
    },
    digits: 2,
    value: (s) => (s?.uptime === null || s?.uptime === undefined ? null : s.uptime / 86400),
  },
  {
    key: K.UPDATES,
    ...counter(),
    when: (_, ctx) => ctx.hasUpdates,
    value: (s) => s?.updates?.count,
  },
  {
    key: K.SECURITY_UPDATES,
    ...counter(),
    when: (_, ctx) => ctx.hasUpdates,
    value: (s) => s?.updates?.security,
  },
  {
    key: K.REBOOT_REQUIRED,
    ...binary(),
    when: (_, ctx) => ctx.hasReboot,
    value: (s) =>
      s?.updates?.reboot === null || s?.updates?.reboot === undefined
        ? null
        : s.updates.reboot
          ? 1
          : 0,
  },
];

const present = (feature, snapshot, ctx) => !feature.when || feature.when(snapshot, ctx);

/** The feature keys the device has for this context. */
export const featureKeys = (snapshot, ctx = {}) =>
  BLUEPRINT.filter((feature) => present(feature, snapshot, ctx)).map((f) => f.key);

/**
 * The discovery payload of the device of a server.
 * @param {object} gladys SDK client
 * @param {object} options
 * @param {number} options.slot server slot
 * @param {string} options.name device name
 * @param {object} options.snapshot src/webmin/model.js
 * @param {object} [options.context]
 * @param {string} [options.language] feature names language
 */
export function buildDevice(gladys, { slot, name, snapshot, context = {}, language = 'en' }) {
  const ids = deviceIds(gladys, slot);
  const names = NAMES[language] ?? NAMES.en;
  const features = BLUEPRINT.filter((feature) => present(feature, snapshot, context)).map(
    (feature) => ({
      name: names[feature.key],
      external_id: ids.feature(feature.key),
      ...feature.definition,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    }),
  );
  return {
    name: name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    features,
  };
}

/**
 * The value of every feature of the device (null: nothing to publish).
 * @returns {Array<{ key: string, externalId: string, value: number|null, noisy: boolean }>}
 */
export function featureValues(gladys, { slot, snapshot, context = {} }) {
  const ids = deviceIds(gladys, slot);
  return BLUEPRINT.filter((feature) => present(feature, snapshot, context)).map((feature) => ({
    key: feature.key,
    externalId: ids.feature(feature.key),
    value:
      snapshot === null && feature.key !== K.ONLINE
        ? null
        : round(feature.value(snapshot, context), feature.digits),
    noisy: Boolean(feature.noisy),
  }));
}
