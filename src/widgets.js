// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `server`.
//
// The use case: a glance at the wall tablet tells whether a server waits for
// its updates or a reboot, and whether it is fine. Tiles: the updates
// (orange when some wait, red when some are for security), the memory and
// fullest disk gauges, the highest temperature; then a few rows: the
// security packages, the reboot, load, swap, uptime. A server that does not
// answer says so in words.
//
// The server is chosen in the widget settings (its device, the only kind of
// choice a widget setting offers). The figures are sent as values, not bound
// to device features: the widget works before the device is added.
//
// Budget (8 components, 6 tiles, 2 texts, 1 status, 4 buttons): a heading,
// four tiles, one status list of eight rows at most, a Refresh button that
// also reads the updates again.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY, listPackages } from './hub.js';
import {
  ERROR_TEXT,
  formatGigabytes,
  formatNumber,
  formatPercent,
  formatUptime,
  labelled,
  pick,
} from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 8;

export const TEXT = {
  pick: {
    en: 'Choose the server in the settings of this widget.',
    fr: 'Choisissez le serveur dans les réglages de ce widget.',
    de: 'Wähle den Server in den Einstellungen dieses Widgets.',
    es: 'Elija el servidor en los ajustes de este widget.',
  },
  gone: {
    en: 'This server is no longer in the configuration of the integration.',
    fr: "Ce serveur n'est plus dans la configuration de l'intégration.",
    de: 'Dieser Server ist nicht mehr in der Konfiguration der Integration.',
    es: 'Este servidor ya no está en la configuración de la integración.',
  },
  waiting: {
    en: 'Waiting for the first answer of Webmin…',
    fr: 'En attente de la première réponse de Webmin…',
    de: 'Warte auf die erste Antwort von Webmin …',
    es: 'Esperando la primera respuesta de Webmin…',
  },
  updates: { en: 'Updates', fr: 'Mises à jour', de: 'Updates', es: 'Actualizaciones' },
  security: { en: 'Security', fr: 'Sécurité', de: 'Sicherheit', es: 'Seguridad' },
  reboot: {
    en: 'Reboot required',
    fr: 'Redémarrage requis',
    de: 'Neustart erforderlich',
    es: 'Reinicio necesario',
  },
  yes: { en: 'Yes', fr: 'Oui', de: 'Ja', es: 'Sí' },
  memory: { en: 'Memory', fr: 'Mémoire', de: 'Speicher', es: 'Memoria' },
  disk: { en: 'Disk', fr: 'Disque', de: 'Datenträger', es: 'Disco' },
  temperature: { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
  uptime: { en: 'Uptime', fr: 'En marche depuis', de: 'Läuft seit', es: 'En marcha desde' },
  load: { en: 'Load', fr: 'Charge', de: 'Last', es: 'Carga' },
  swap: { en: 'Swap', fr: 'Swap', de: 'Auslagerung', es: 'Swap' },
  free: { en: 'free', fr: 'libres', de: 'frei', es: 'libres' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Webmin read again.',
    fr: 'Webmin relu.',
    de: 'Webmin neu gelesen.',
    es: 'Webmin leído de nuevo.',
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Danger from 90, warning from 75: what a monitoring tool shows in red and orange. */
const usageColor = (value) =>
  value >= 90 ? WIDGET_COLORS.DANGER : value >= 75 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS;
const temperatureColor = (celsius) =>
  celsius >= 85
    ? WIDGET_COLORS.DANGER
    : celsius >= 70
      ? WIDGET_COLORS.WARNING
      : WIDGET_COLORS.NEUTRAL;

function message(text, language, ttl = 300) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

const refreshButton = (language) => ({
  type: 'button',
  label: t(TEXT.refresh, language),
  icon: 'refresh-cw',
  style: 'secondary',
  action: { key: ACTIONS.REFRESH },
});

const gauge = (label, value, language) => ({
  type: 'gauge',
  value: Math.round(value),
  min: 0,
  max: 100,
  unit: '%',
  label: t(label, language),
  color: usageColor(value),
});

/** The tiles and the rows of a server that answers. */
function serverComponents(view, language) {
  const { snapshot, disk } = view;
  const { updates } = snapshot;
  const components = [];
  if (updates) {
    components.push({
      type: 'value',
      value: updates.count,
      label: t(TEXT.updates, language),
      icon: 'package',
      color:
        updates.security > 0
          ? WIDGET_COLORS.DANGER
          : updates.count > 0
            ? WIDGET_COLORS.WARNING
            : WIDGET_COLORS.SUCCESS,
    });
  }
  if (snapshot.memory !== null) {
    components.push(gauge(TEXT.memory, snapshot.memory, language));
  }
  if (disk) {
    components.push({
      ...gauge(TEXT.disk, disk.percent, language),
      label: fit(`${t(TEXT.disk, language)} ${disk.mount}`, 24),
    });
  }
  if (snapshot.temperature !== null) {
    components.push({
      type: 'value',
      value: Math.round(snapshot.temperature),
      unit: '°C',
      label: t(TEXT.temperature, language),
      icon: 'thermometer',
      color: temperatureColor(snapshot.temperature),
    });
  }

  const rows = [];
  if (updates?.security > 0) {
    rows.push({
      label: t(TEXT.security, language),
      value: fit(
        listPackages(
          updates.packages.filter((item) => item.security),
          3,
        ),
        40,
      ),
      icon: 'shield',
      color: WIDGET_COLORS.DANGER,
    });
  }
  if (updates?.reboot) {
    rows.push({
      label: t(TEXT.reboot, language),
      value: t(TEXT.yes, language),
      icon: 'rotate-cw',
      color: WIDGET_COLORS.WARNING,
    });
  }
  if (disk?.free !== null && disk?.free !== undefined) {
    rows.push({
      label: fit(`${t(TEXT.disk, language)} ${disk.mount}`, 40),
      value: `${formatGigabytes(disk.free, language)} ${t(TEXT.free, language)}`,
      icon: 'hard-drive',
      color: usageColor(disk.percent),
    });
  }
  if (snapshot.load) {
    const loads = [snapshot.load.min1, snapshot.load.min5, snapshot.load.min15]
      .filter((value) => value !== null)
      .map((value) => formatNumber(value, language, 2));
    rows.push({
      label: t(TEXT.load, language),
      value: loads.join(' · '),
      icon: 'activity',
      color:
        snapshot.cores && snapshot.load.min5 > snapshot.cores
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (snapshot.swap !== null) {
    rows.push({
      label: t(TEXT.swap, language),
      value: formatPercent(snapshot.swap, language),
      icon: 'layers',
      color: usageColor(snapshot.swap),
    });
  }
  if (snapshot.uptime !== null) {
    rows.push({
      label: t(TEXT.uptime, language),
      value: formatUptime(snapshot.uptime, language),
      icon: 'clock',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (rows.length > 0) {
    components.push({ type: 'status', items: rows.slice(0, MAX_ROWS) });
  }
  return components;
}

async function get(hub, { settings, language = 'en' }) {
  const chosen = typeof settings?.server === 'string' ? settings.server : '';
  if (!chosen) {
    return message(TEXT.pick, language);
  }
  const record = hub.find(chosen);
  if (!record) {
    return message(TEXT.gone, language);
  }
  const view = hub.view(record);

  if (!view.online) {
    if (!view.error) {
      return message(TEXT.waiting, language, 30);
    }
    return {
      ttl_seconds: 60,
      components: [
        { type: 'text', variant: 'heading', text: fit(view.name, 40) },
        {
          type: 'text',
          variant: 'body',
          text: labelled(view.name, t(ERROR_TEXT[view.error.kind], language), language),
        },
        refreshButton(language),
      ],
    };
  }
  return {
    ttl_seconds: 60,
    components: [
      { type: 'text', variant: 'heading', text: fit(view.name, 40) },
      ...serverComponents(view, language),
      refreshButton(language),
    ],
  };
}

async function action(hub, { actionKey, settings }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  // A user action: the updates are read again too, and a server whose
  // credentials were refused is tried again.
  const record = typeof settings?.server === 'string' ? hub.find(settings.server) : null;
  if (record) {
    await hub.afterChanges(await hub.poll(record, { force: true }));
  } else {
    await hub.pollAll({ force: true });
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
