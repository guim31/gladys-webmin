// -----------------------------------------------------------------------------
// The raw answers of Webmin (src/webmin/client.js) turned into one snapshot,
// in plain units, every figure null when the server does not give it.
//
// `collect_system_info` (Webmin's own dashboard data), seen on Webmin 2.670
// and in the Home Assistant fixture:
//   load   [1 min, 5 min, 15 min, MHz, model, vendor, cache, cores]
//   mem    [total, free + buffers + cache, swap total, swap free, …] in kB
//   cpu    [user, kernel, idle, io wait, vm] in %
//   disk_fs [{ dir, device, type, total, free, used, used_percent }] bytes
//   cputemps [{ core, temp }], drivetemps [{ device, temp, errors, failed }]
//   kernel { os, version, arch }
// `get_system_uptime`: [days, hours, minutes] (empty when `uptime` fails).
// -----------------------------------------------------------------------------

const KIB = 1024;

const number = (value) => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};
const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : null;
const clampPercent = (value) => (value === null ? null : Math.min(100, Math.max(0, value)));

// What Webmin lists among the local disks but is no disk of the server: the
// files Docker mounts into a container, read-only images.
const IGNORED_MOUNTS = /^\/(etc\/(hosts|hostname|resolv\.conf)|proc|sys|dev)(\/|$)/;
const IGNORED_TYPES = new Set(['squashfs', 'iso9660', 'overlay', 'tmpfs', 'devtmpfs']);

/** A disk of `disk_fs`, null when it is no real disk. */
function parseDisk(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.dir !== 'string' || !raw.dir) {
    return null;
  }
  if (IGNORED_MOUNTS.test(raw.dir) || IGNORED_TYPES.has(raw.type)) {
    return null;
  }
  const total = number(raw.total);
  if (!total || total <= 0) {
    return null;
  }
  const free = number(raw.free);
  const used = number(raw.used);
  // `used_percent` is what `df` shows (space reserved for root counted as used).
  let percent = number(raw.used_percent);
  if (percent === null && used !== null) {
    percent = (used / total) * 100;
  }
  if (percent === null) {
    return null;
  }
  return {
    mount: raw.dir,
    device: typeof raw.device === 'string' ? raw.device : null,
    type: typeof raw.type === 'string' ? raw.type : null,
    percent: clampPercent(percent),
    free,
    total,
  };
}

function parseUptime(raw) {
  const parts = list(raw).map(number);
  if (parts.length < 3 || parts.some((part) => part === null)) {
    return null;
  }
  const [days, hours, minutes] = parts;
  return days * 86400 + hours * 3600 + minutes * 60;
}

/** The highest temperature, of the CPU cores and the drives (°C), or null. */
function parseTemperatures(info) {
  const temps = [
    ...list(info.cputemps).map((entry) => number(entry?.temp)),
    ...list(info.drivetemps).map((entry) => number(entry?.temp)),
  ].filter((temp) => temp !== null && temp > -50 && temp < 150);
  return temps.length > 0 ? Math.max(...temps) : null;
}

/** The pending updates, the security ones first, by name. */
function parseUpdates(raw) {
  if (!raw) {
    return null;
  }
  const packages = raw.packages
    // Webmin types a value by its look: a version such as 20240203 or 1.10
    // arrives as a number.
    .map((item) => ({
      name: text(item.name) ?? text(item.update) ?? '',
      version: text(item.version),
      oldVersion: text(item.oldversion),
      security: Number(item.security) === 1 || item.security === true,
    }))
    .filter((item) => item.name)
    .sort((a, b) => Number(b.security) - Number(a.security) || a.name.localeCompare(b.name));
  return {
    count: packages.length,
    security: packages.filter((item) => item.security).length,
    packages,
    reboot: raw.reboot,
  };
}

/**
 * @param {object} read what WebminClient.read() returns
 */
export function parseSnapshot(read) {
  const info = read.info ?? {};
  const load = list(info.load);
  const mem = list(info.mem).map(number);
  const cpu = list(info.cpu).map(number);

  const memTotal = mem[0] ?? null;
  const memFree = mem[1] ?? null;
  const swapTotal = mem[2] ?? null;
  const swapFree = mem[3] ?? null;

  const disks = list(info.disk_fs)
    .map(parseDisk)
    .filter(Boolean)
    .sort((a, b) => a.mount.localeCompare(b.mount));

  const cores = number(load[7]);
  return {
    version: read.version ?? null,
    hostname: read.hostname ?? null,
    os: typeof info.kernel?.os === 'string' ? info.kernel.os : null,
    kernel: typeof info.kernel?.version === 'string' ? info.kernel.version : null,
    load:
      load.length >= 3
        ? { min1: number(load[0]), min5: number(load[1]), min15: number(load[2]) }
        : null,
    cores: cores && cores > 0 ? cores : null,
    // Busy = everything but idle (user, kernel, io wait, vm).
    cpu: cpu.length >= 3 && cpu[2] !== null ? clampPercent(100 - cpu[2]) : null,
    memory:
      memTotal && memTotal > 0 && memFree !== null
        ? clampPercent(((memTotal - memFree) / memTotal) * 100)
        : null,
    memoryTotal: memTotal ? memTotal * KIB : null,
    // No swap at all: no swap feature (not "0 % used").
    swap:
      swapTotal && swapTotal > 0 && swapFree !== null
        ? clampPercent(((swapTotal - swapFree) / swapTotal) * 100)
        : null,
    disks,
    temperature: parseTemperatures(info),
    uptime: parseUptime(read.uptime),
    updates: parseUpdates(read.updates),
  };
}

/** The fullest disk, or null. */
export function fullestDisk(snapshot) {
  let fullest = null;
  for (const disk of snapshot?.disks ?? []) {
    if (!fullest || disk.percent > fullest.percent) {
      fullest = disk;
    }
  }
  return fullest;
}
