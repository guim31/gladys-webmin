# Webmin

[Webmin](https://webmin.com) is the web interface that administers Linux and
BSD servers. This integration reads up to three Webmin servers and brings
into Gladys what a system monitor does not tell: the **package updates**
waiting on each server, the **security** ones apart, and whether the server
**waits for a reboot**. Then the essentials of the Webmin dashboard: load,
CPU, memory, swap, the fullest disk, the highest temperature, uptime. Scenes
can react to new security updates, a disk filling up or a server that no
longer answers, and a dashboard widget sums a server up. Everything stays on
your local network, and nothing is ever changed on the server.

Tested against a real Webmin 2.670 on Debian 12 (Docker): updates and
security updates, reboot required, wrong password, address blocked, user
without the RPC right, self-signed certificate. Not yet in a real Gladys nor on
every distribution: feedback welcome on
[the issues](https://github.com/guim31/gladys-webmin/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- Webmin (2.x tested) on each server, reachable from the Gladys machine (port
  10000, HTTPS, by default).
- The Perl module **XML::Parser** on the server: `apt install
libxml-parser-perl` (Debian, Ubuntu), `dnf install perl-XML-Parser` (Fedora,
  Rocky, Alma). Without it, Webmin answers no XML-RPC call.
- For the updates: the Webmin module **Software Package Updates** (installed
  with Webmin on the usual distributions).

## Getting started

### 1. Create a Webmin user for Gladys

In Webmin, open **Webmin → Webmin Users → Create a new Webmin user**:

- user name `gladys` and a long password;
- **Can accept RPC calls?**: **Yes**;
- no module is needed: leave them all unticked;
- recommended, **IP access control**: only allow the address of the Gladys
  machine.

Why the restriction matters: through XML-RPC, Webmin lets such a user call
any Webmin function, as root. The integration only calls reading functions
(listed in the Limits section), but the password is worth a root password:
keep it for Gladys alone, and allow it from the Gladys address only.

### 2. Configure the integration

In the **Configuration** tab, for each server:

- **Webmin address**: `192.168.1.20`, `server.lan`, or the address copied
  from the browser (`https://server.lan:10000/`). HTTPS and port 10000 are
  assumed when you give a bare name or IP;
- **Webmin user** and **Password**: the user created above;
- **Name in Gladys** (optional): by default, the host name Webmin gives.

Options: **Refresh interval** (1 to 10 minutes, 5 by default; the updates
are read once an hour whatever this interval), **Accept self-signed
certificates** (ticked by default: Webmin creates one at installation),
**Language of the feature names**.

Save, then click **Test the connection**: one line per server, with the
version of Webmin, the number of disks and of updates.

### 3. Add the devices

Open the **Discover** tab: one device per server that answered. Add the ones
to follow.

## The devices

One device per server, with these features (names in the language chosen in
the configuration):

- **Online**: 1 when the server answers, 0 once it stopped answering two
  reads in a row;
- **CPU**, **Memory**, **Swap** (when the server has swap): use in %;
- **Load (1 min)**, **Load (5 min)**, **Load (15 min)**: the load averages;
- **Fullest disk**: use of the fullest local disk, in %;
- **Highest temperature**: the hottest CPU core or drive, when Webmin reads
  temperatures (lm-sensors, hddtemp or smartmontools on the server);
- **Uptime**: in days;
- **Available updates** and **Security updates**: numbers of packages;
- **Reboot required**: 1 when the server waits for a reboot (Debian and
  Ubuntu: `/var/run/reboot-required`; Red Hat family: `needs-restarting`).

The updates come from the cache of the Webmin module Software Package
Updates, valid 6 hours by default: Gladys sees a new update when Webmin does.
To see them sooner, lower **Cache time** in the configuration of that module.

## Dashboard

The widget **Webmin server** (choose the server in its settings) shows the
number of updates (orange when some wait, red when some are for security),
memory and fullest disk gauges, the highest temperature, then the security
packages, the reboot, the free space, the load, the swap and the uptime. The
**Refresh** button reads Webmin again, updates included.

## Scenes

### Triggers

- **New security updates**: security updates appear on a server (read once an
  hour). Fired again for every new package or new version. Filter: server.
  Variables: server, new packages, new security updates, security updates,
  available updates.
- **Disk almost full**: a disk reaches 80, 85, 90, 95 or 98 % (the threshold
  is a filter of the trigger), for every disk Webmin lists, not only the
  fullest one. Announced again once the disk went 2 points below. Variables:
  server, mount point, space used, free space (GB), threshold.
- **Server unreachable**: the server stops answering two reads in a row
  (refused credentials do not count). Variables: server, reason.

Triggers fire for every configured server, added to Gladys or not, and
survive a restart of the integration: nothing is missed nor announced twice.

### Actions

- **State of a Webmin server**: reads a server and returns every figure
  (updates, security updates, reboot required, packages to update, CPU,
  memory, swap, loads, fullest disk, free space, temperature, uptime) and a
  **summary** ready for a message, e.g. `NAS: 4 update(s), 2 for security
(libssl3, openssl), reboot required, load 0.42, memory 66%, disk / 87% (59 GB
free)`.

### Scene ideas

- Every Monday at 9 a.m., **State of a Webmin server**, then send the summary
  to your phone: the weekly maintenance list.
- **New security updates** → a Telegram message with the packages.
- When **Reboot required** becomes 1 and nobody is at home, a reminder to
  reboot in the evening.
- **Disk almost full** at 90 % → a notification with the mount point.

## Troubleshooting

- _install the XML::Parser Perl module_: install `libxml-parser-perl` (or
  `perl-XML-Parser`) on the server, no need to restart Webmin.
- _this Webmin user may not make RPC calls_: set **Can accept RPC calls?** to
  Yes for the user.
- _user name or password refused_: check them. After 5 failed logins, Webmin
  blocks the address of Gladys for 60 seconds (_Webmin blocks Gladys…_): the
  integration then waits 30 minutes before trying again, or **Test the
  connection** at once.
- _certificate refused_: tick **Accept self-signed certificates**.
- _the address redirects_: Webmin is in HTTPS: enter `https://…`.
- _no Webmin at this address_: check the port (10000 by default).
- Updates unknown in the test report: the Software Package Updates module is
  missing or cannot read the package manager.

## Limits

- Read only: the integration never installs an update nor reboots a server.
  Functions called: `system-status::collect_system_info`,
  `proc::get_system_uptime`, `webmin::get_webmin_version`,
  `webmin::get_system_hostname`, `package-updates::list_possible_updates`,
  `package-updates::check_reboot_required`.
- Up to three servers. Usermin and Virtualmin are not read.
- Updates as fresh as the cache of Webmin (6 hours by default), read once an
  hour.
- The security flag comes from the package source (Debian and Ubuntu
  `…-security` repositories); other distributions may show no security update.
- Not affiliated with Webmin.
