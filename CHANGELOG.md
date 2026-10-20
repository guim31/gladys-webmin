# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Up to three Webmin servers, read over XML-RPC with a dedicated Webmin user,
  self-signed certificates accepted by default.
- One device per server: online, CPU, memory, swap, load (1, 5 and 15 min),
  fullest disk, highest temperature, uptime, available updates, security
  updates and reboot required.
- Scene triggers: new security updates (with the packages), disk almost full
  (80 to 98 %, every disk), server unreachable.
- Scene action "State of a Webmin server": every figure, the packages to
  update and a summary ready for a message.
- Dashboard widget "Webmin server", with a Refresh button.
- A Test the connection button and a connection status that names the
  problem (XML::Parser missing, no RPC right, address blocked by Webmin…).
- Every text in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-webmin/commits/main
