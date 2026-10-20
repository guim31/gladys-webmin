// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Are there updates?" is already a scene condition on the device features.
// "State of a server" is what a condition cannot do: put the state of a
// server in a message ("NAS: 3 update(s), 1 for security (openssl), reboot
// required, disk / 78 %…"), with every figure as an output too, for the
// servers the user did not add. It reads Webmin again when the last read is
// older than 30 seconds (the updates keep their hourly read). An unreachable
// server is an answer, not a failure: `online` false, and the summary says
// so — the scene can still send it.
// -----------------------------------------------------------------------------

import { listPackages } from './hub.js';
import {
  ACTION_TEXT,
  ERROR_TEXT,
  SUMMARY_TEXT,
  formatCelsius,
  formatGigabytes,
  formatNumber,
  formatPercent,
  labelled,
  pick,
} from './texts.js';

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The one-line state of a server, in the configured language. */
export function summarize(view, language) {
  const text = SUMMARY_TEXT[language] ?? SUMMARY_TEXT.en;
  if (!view.online) {
    const reason = view.error ? pick(ERROR_TEXT[view.error.kind], language) : text.unreachable;
    return labelled(view.name, reason, language);
  }
  const { snapshot, disk } = view;
  const parts = [];
  const { updates } = snapshot;
  if (updates) {
    if (updates.count === 0) {
      parts.push(text.upToDate);
    } else {
      parts.push(text.updates(updates.count));
      if (updates.security > 0) {
        const security = updates.packages.filter((item) => item.security);
        parts.push(text.security(updates.security, listPackages(security)));
      }
    }
    if (updates.reboot) {
      parts.push(text.reboot);
    }
  }
  if (snapshot.load?.min5 !== null && snapshot.load?.min5 !== undefined) {
    parts.push(`${text.load} ${formatNumber(snapshot.load.min5, language, 2)}`);
  }
  if (snapshot.memory !== null) {
    parts.push(`${text.memory} ${formatPercent(snapshot.memory, language)}`);
  }
  if (disk) {
    const free = disk.free === null ? '' : ` (${text.free(formatGigabytes(disk.free, language))})`;
    parts.push(`${text.disk} ${disk.mount} ${formatPercent(disk.percent, language)}${free}`);
  }
  if (snapshot.temperature !== null) {
    parts.push(formatCelsius(snapshot.temperature, language));
  }
  return labelled(view.name, parts.join(', '), language);
}

export const SCENE_ACTIONS = {
  async get_server_status(hub, { fields = {} }) {
    hub.assertReadable();
    const language = hub.config.language;
    const found = hub.find(fields.server);
    if (!found) {
      throw new Error(pick(ACTION_TEXT.unknownServer, language));
    }
    await hub.refreshIfStale([found]);
    // Read again: the server may have been reconfigured meanwhile.
    const record = hub.find(fields.server) ?? found;
    const view = hub.view(record);
    const outputs = { name: view.name, online: view.online, summary: summarize(view, language) };
    if (!view.online) {
      return outputs;
    }
    const { snapshot, disk } = view;
    const set = (key, value, digits = 1) => {
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        outputs[key] = round(value, digits);
      }
    };
    set('cpu', snapshot.cpu);
    set('memory', snapshot.memory);
    set('swap', snapshot.swap);
    set('load_1', snapshot.load?.min1, 2);
    set('load_5', snapshot.load?.min5, 2);
    set('load_15', snapshot.load?.min15, 2);
    set('uptime_days', snapshot.uptime === null ? null : snapshot.uptime / 86400, 2);
    if (disk) {
      outputs.disk_mount = disk.mount;
      set('disk_percent', disk.percent);
      set('disk_free_gb', disk.free === null ? null : disk.free / 1024 ** 3);
    }
    set('temperature', snapshot.temperature);
    if (snapshot.updates) {
      outputs.updates = snapshot.updates.count;
      outputs.security_updates = snapshot.updates.security;
      if (snapshot.updates.reboot !== null) {
        outputs.reboot_required = snapshot.updates.reboot;
      }
      if (snapshot.updates.count > 0) {
        outputs.packages = listPackages(snapshot.updates.packages);
      }
    }
    return outputs;
  },
};
