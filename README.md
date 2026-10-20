# Webmin for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that reads your Linux servers through [Webmin](https://webmin.com): the
**package updates** waiting on each server, the **security** ones apart,
whether it **waits for a reboot**, and the essentials of the Webmin dashboard
(load, CPU, memory, swap, fullest disk, temperature, uptime). It talks to the
XML-RPC interface of Webmin over the local network. No cloud. Read only.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

> Tested against a real Webmin 2.670 on Debian 12 (Docker): pending updates
> and security updates, reboot required, wrong password, address blocked after
> failed logins, user without the RPC right, self-signed certificate, from the
> integration image run with the constraints of the Gladys sandbox. Not yet in
> a real Gladys nor on every distribution: feedback welcome in the
> [issues](https://github.com/guim31/gladys-webmin/issues).

## Features

- **Up to three servers**, each with its address, Webmin user, password and
  name.
- **One device per server**, proposed in the Discover tab: **Online**, **CPU**,
  **Memory**, **Swap**, **Load** (1, 5 and 15 min), **Fullest disk**,
  **Highest temperature** (when Webmin reads temperatures), **Uptime**,
  **Available updates**, **Security updates** and **Reboot required**. Feature
  names in French by default (English, German and Spanish available).
- **Scene triggers**, for every server, added to Gladys or not: _New security
  updates_ (with the new packages), _Disk almost full_ (80 to 98 %, every disk
  Webmin lists) and _Server unreachable_.
- **Scene action** _State of a Webmin server_: every figure as an output, the
  packages to update, and a ready-made summary for a message.
- **Dashboard widget** "Webmin server": updates (red when some are for
  security), reboot, memory and disk gauges, temperature, load, uptime, and a
  **Refresh** button.
- A **Test the connection** button, a connection status naming the server and
  the problem, a **transport badge** per device.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- **Webmin** (2.x tested) on each server, reachable from the Gladys machine
  (port 10000, HTTPS by default), with the Perl module **XML::Parser**
  (`libxml-parser-perl` on Debian and Ubuntu, `perl-XML-Parser` on the Red Hat
  family).
- A Webmin user for Gladys with **Can accept RPC calls?** set to Yes. Such a
  user can call any Webmin function as root: restrict it to the address of
  Gladys (see the documentation).

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-webmin` (or
   install **Webmin** from the catalog once it is listed).
2. In **Configuration**, enter the address of Webmin, the user and its
   password. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the servers to follow.

## How it works

- Every refresh interval (1 to 10 minutes, 5 by default), two XML-RPC calls
  per server: `system-status::collect_system_info` (what the Webmin dashboard
  shows, the package list skipped) and `proc::get_system_uptime`.
- Once an hour: `package-updates::list_possible_updates` and
  `package-updates::check_reboot_required`. They answer from the cache of the
  Webmin module (6 hours by default); only when that cache has expired does
  Webmin run the package manager, as its own interface would.
- Only the states that change are sent, the ones that move at every read at
  most once a minute, with a heartbeat every 6 hours. What the triggers
  compare with is kept under `/data`, so a restart neither misses nor repeats
  an announcement.
- Webmin blocks an address after 5 failed logins: after refused credentials,
  the integration waits 30 minutes before trying again (or until the user
  saves the configuration, tests the connection or refreshes the widget).

## Limits

- Read only: no update is ever installed, no server rebooted.
- Updates as fresh as the cache of Webmin; the security flag comes from the
  package source (`…-security` repositories of Debian and Ubuntu).
- Usermin and Virtualmin are not read.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

Project rules and the pitfalls met on the way: [`CLAUDE.md`](CLAUDE.md).

## Credits

- [Webmin](https://github.com/webmin/webmin) (BSD-3-Clause): the XML-RPC
  interface, and the logo of the cover image (`images/brand_webmin.svg` of its
  repository, recoloured).
- The Home Assistant [`webmin`](https://www.home-assistant.io/integrations/webmin/)
  integration ([home-assistant/core](https://github.com/home-assistant/core),
  Apache-2.0) and its library
  [webmin-xmlrpc](https://github.com/autinerd/webmin-xmlrpc): the calls used,
  and a test fixture.
- Architecture adapted from
  [guim31/gladys-glances](https://github.com/guim31/gladys-glances).

Not affiliated with Webmin.

## License

[Apache-2.0](LICENSE)
