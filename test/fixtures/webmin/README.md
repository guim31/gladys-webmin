# Webmin fixtures

- `*.xml`: real answers of `/xmlrpc.cgi`, Webmin 2.670 on Debian 12 (Docker,
  October 2026), anonymized (mount point, device, CPU model). `updates.xml`:
  four pending updates, two of them from `bookworm-security`; `reboot.xml`
  with `/var/run/reboot-required` present.
- `ha-webmin_update.json`: the decoded data of a real server, from the tests
  of the Home Assistant `webmin` integration
  ([home-assistant/core](https://github.com/home-assistant/core), Apache-2.0),
  addresses replaced by documentation ones.
