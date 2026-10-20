# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration keeps and sends:

- The address, Webmin user name and password of each server are stored by
  Gladys in the integration configuration; the password is a secret field,
  never written to the logs nor shown back.
- `/data/webmin-state.json` holds what the scene triggers compare with: the
  disk thresholds already announced and the security packages already seen
  (names and versions), per server slot. No credential.
- Network: XML-RPC requests (HTTP Basic authentication) from the container to
  the configured Webmin servers only, on the local network; HTTPS by default,
  certificate checks off only when "Accept self-signed certificates" is
  ticked. Nothing else is contacted.
- A Webmin user allowed to make RPC calls can call any Webmin function, as
  root: the integration calls only six reading functions (see the
  documentation), and the documentation asks to restrict that user to the
  address of Gladys.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Webmin itself, and the other third-party services the integration talks to.
