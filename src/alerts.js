// -----------------------------------------------------------------------------
// What the scene triggers compare with, read after read. Pure bookkeeping, no
// I/O: the hub (src/hub.js) feeds it every successful read and fires the
// events it returns. The tables live in /data (src/store.js) so a restart
// neither repeats an announcement nor misses one.
//
//   - disks: the scene filters of Gladys only compare for equality, so the
//     trigger carries a `threshold` filter among fixed steps, and one event
//     is fired per step crossed (a scene "90 %" matches the 90 % event and
//     nothing else); announced again only once the disk went back 2 points
//     below the step (a cleaned disk). Every disk Webmin lists, not only the
//     fullest one.
//   - security updates: the security packages pending (name and version) are
//     compared with the previous read of the updates; new ones fire one
//     event that lists them. A package updated then pending again with a
//     newer version is new again.
//   - what a server has shown once (swap, temperatures, the updates module):
//     its features stay, so that a blip does not change the device structure.
//
// The first time a disk or the updates of a server are seen, they are
// recorded without any event: nothing has changed, and no scene could exist
// yet at the very first read.
// -----------------------------------------------------------------------------

export const DISK_THRESHOLDS = Object.freeze([80, 85, 90, 95, 98]);
export const DISK_REARM_POINTS = 2;

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const numbers = (value) => (Array.isArray(value) ? value.filter(Number.isFinite) : []);
const strings = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
const slotOf = (id) => Number(String(id).split(':')[0]);

const packageId = (item) => `${item.name}=${item.version ?? ''}`;

export class Watcher {
  constructor(saved = {}) {
    const tables = object(saved);
    this.saved = {
      disks: object(tables.disks),
      servers: object(tables.servers),
    };
  }

  server(slot) {
    const entry = object(this.saved.servers[slot]);
    this.saved.servers[slot] = entry;
    return entry;
  }

  /**
   * The address a slot was read at: another one may be another machine,
   * whose updates must not be compared with the previous one's.
   * @returns {boolean} whether the slot was forgotten
   */
  checkAddress(slot, url) {
    const entry = object(this.saved.servers[slot]);
    if (typeof entry.url === 'string' && entry.url !== url) {
      this.forgetSlot(slot);
      this.server(slot).url = url;
      return true;
    }
    if (entry.url !== url) {
      this.server(slot).url = url;
      return true;
    }
    return false;
  }

  /** Whether "server unreachable" was announced and not healed (survives a restart). */
  isDown(slot) {
    return object(this.saved.servers[slot]).down === true;
  }

  setDown(slot, down) {
    const entry = this.server(slot);
    if ((entry.down === true) === down) {
      return false;
    }
    entry.down = down;
    return true;
  }

  /** What the server has shown once, for its device structure. */
  known(slot) {
    const entry = object(this.saved.servers[slot]);
    return {
      hasSwap: entry.swap === true,
      hasTemperature: entry.temperature === true,
      hasUpdates: entry.updates === true,
      hasReboot: entry.reboot === true,
    };
  }

  /** Record what a snapshot shows (features never disappear on their own). */
  remember(slot, snapshot) {
    const entry = this.server(slot);
    let changed = false;
    const mark = (key, seen) => {
      if (seen && entry[key] !== true) {
        entry[key] = true;
        changed = true;
      }
    };
    mark('swap', snapshot.swap !== null);
    mark('temperature', snapshot.temperature !== null);
    mark('updates', snapshot.updates !== null);
    mark('reboot', snapshot.updates !== null && snapshot.updates.reboot !== null);
    return changed;
  }

  /**
   * @param {number} slot
   * @param {Array<{ mount: string, percent: number }>} disks
   * @returns {Array<{ disk: object, threshold: number }>} the steps crossed
   */
  disks(slot, disks, now) {
    const crossed = [];
    for (const disk of disks) {
      const id = `${slot}:${disk.mount}`;
      const entry = this.saved.disks[id];
      if (!entry) {
        this.saved.disks[id] = {
          above: DISK_THRESHOLDS.filter((step) => disk.percent >= step),
          seenAt: now,
        };
        continue;
      }
      const above = new Set(numbers(entry.above));
      for (const step of DISK_THRESHOLDS) {
        if (disk.percent >= step && !above.has(step)) {
          above.add(step);
          crossed.push({ disk, threshold: step });
        } else if (disk.percent < step - DISK_REARM_POINTS) {
          above.delete(step);
        }
      }
      this.saved.disks[id] = { above: [...above].sort((a, b) => a - b), seenAt: now };
    }
    return crossed;
  }

  /**
   * A new read of the updates of a server.
   * @param {number} slot
   * @param {{ packages: Array<{ name: string, version: string|null, security: boolean }> }} updates
   * @returns {Array<object>} the security packages new since the previous read
   */
  securityUpdates(slot, updates) {
    const entry = this.server(slot);
    const current = updates.packages.filter((item) => item.security);
    const first = !Array.isArray(entry.security);
    const known = new Set(strings(entry.security));
    entry.security = current.map(packageId).sort();
    if (first) {
      return [];
    }
    return current.filter((item) => !known.has(packageId(item)));
  }

  /** Forget the servers removed from the configuration. */
  forgetSlots(kept) {
    let changed = false;
    for (const table of Object.values(this.saved)) {
      for (const id of Object.keys(table)) {
        if (!kept.has(slotOf(id))) {
          delete table[id];
          changed = true;
        }
      }
    }
    return changed;
  }

  /** Forget everything of one server (its address now points at another machine). */
  forgetSlot(slot) {
    let changed = false;
    for (const table of Object.values(this.saved)) {
      for (const id of Object.keys(table)) {
        if (slotOf(id) === slot) {
          delete table[id];
          changed = true;
        }
      }
    }
    return changed;
  }

  /** Forget a disk the server no longer shows after `maxAgeMs` (unplugged). */
  forgetStale(slot, now, maxAgeMs) {
    for (const [id, entry] of Object.entries(this.saved.disks)) {
      if (slotOf(id) === slot && !(entry?.seenAt >= now - maxAgeMs)) {
        delete this.saved.disks[id];
      }
    }
  }
}
