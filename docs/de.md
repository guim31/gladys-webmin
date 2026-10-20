# Webmin

[Webmin](https://webmin.com) ist die Weboberfläche zur Verwaltung von Linux-
und BSD-Servern. Diese Integration liest bis zu drei Webmin-Server und bringt
nach Gladys, was ein Überwachungstool nicht sagt: die **Paketupdates**, die auf
jedem Server warten, die **Sicherheitsupdates** gesondert, und ob der Server
**auf einen Neustart wartet**. Dazu das Wichtigste aus dem Webmin-Dashboard:
Last, Prozessor, Arbeitsspeicher, Auslagerung, der vollste Datenträger, die
höchste Temperatur, die Laufzeit. Szenen können auf neue Sicherheitsupdates,
einen volllaufenden Datenträger oder einen Server reagieren, der nicht mehr
antwortet, und ein Widget fasst einen Server zusammen. Alles bleibt in deinem
lokalen Netz, und am Server wird nie etwas geändert.

Getestet mit einem echten Webmin 2.670 unter Debian 12 (Docker): Updates und
Sicherheitsupdates, Neustart erforderlich, falsches Passwort, gesperrte
Adresse, Benutzer ohne RPC-Recht, selbstsigniertes Zertifikat. Noch nicht in
einem echten Gladys und nicht auf jeder Distribution: Rückmeldungen sind in
[den Issues](https://github.com/guim31/gladys-webmin/issues) willkommen.

## Voraussetzungen

- Gladys Assistant 5.1.0 oder neuer.
- Webmin (2.x getestet) auf jedem Server, vom Gladys-Rechner erreichbar
  (standardmäßig Port 10000, HTTPS).
- Das Perl-Modul **XML::Parser** auf dem Server: `apt install
libxml-parser-perl` (Debian, Ubuntu), `dnf install perl-XML-Parser` (Fedora,
  Rocky, Alma). Ohne es beantwortet Webmin keinen XML-RPC-Aufruf.
- Für die Updates: das Webmin-Modul **Software Package Updates** (bei den
  üblichen Distributionen mit Webmin installiert).

## Erste Schritte

### 1. Einen Webmin-Benutzer für Gladys anlegen

Öffne in Webmin **Webmin → Webmin Users → Create a new Webmin user**:

- Benutzername `gladys` und ein langes Passwort;
- **Can accept RPC calls?**: **Yes**;
- es wird kein Modul gebraucht: Lass alle abgewählt;
- empfohlen, **IP access control**: Erlaube nur die Adresse des
  Gladys-Rechners.

Warum die Einschränkung zählt: Über XML-RPC lässt Webmin einen solchen
Benutzer jede Webmin-Funktion als root aufrufen. Die Integration ruft nur
lesende Funktionen auf (im Abschnitt Grenzen aufgeführt), aber das Passwort ist
so viel wert wie ein root-Passwort: Verwende es nur für Gladys und erlaube es
nur von der Adresse von Gladys.

### 2. Die Integration konfigurieren

Im Tab **Konfiguration**, für jeden Server:

- **Webmin-Adresse**: `192.168.1.20`, `server.lan` oder die aus dem Browser
  kopierte Adresse (`https://server.lan:10000/`). Bei einem bloßen Namen oder
  einer IP werden HTTPS und Port 10000 angenommen;
- **Webmin-Benutzer** und **Passwort**: der oben angelegte Benutzer;
- **Name in Gladys** (optional): standardmäßig der Hostname, den Webmin
  angibt.

Optionen: **Aktualisierungsintervall** (1 bis 10 Minuten, standardmäßig 5; die
Updates werden unabhängig davon einmal pro Stunde gelesen), **Selbstsignierte
Zertifikate akzeptieren** (standardmäßig aktiviert: Webmin erstellt bei der
Installation eines), **Sprache der Funktionsnamen**.

Speichere und klicke dann auf **Verbindung testen**: eine Zeile pro Server, mit
der Webmin-Version, der Zahl der Datenträger und der Updates.

### 3. Die Geräte hinzufügen

Öffne den Tab **Entdecken**: ein Gerät pro Server, der geantwortet hat. Füge
die hinzu, die du verfolgen willst.

## Die Geräte

Ein Gerät pro Server, mit diesen Funktionen (Namen in der in der Konfiguration
gewählten Sprache):

- **Online**: 1, wenn der Server antwortet, 0, sobald er zwei Lesungen
  hintereinander nicht mehr antwortet;
- **Prozessor**, **Arbeitsspeicher**, **Auslagerung** (wenn der Server Swap
  hat): Auslastung in %;
- **Last (1 Min.)**, **Last (5 Min.)**, **Last (15 Min.)**: die
  Durchschnittslasten;
- **Vollster Datenträger**: Belegung des vollsten lokalen Datenträgers, in %;
- **Höchste Temperatur**: der heißeste Prozessorkern oder Datenträger, wenn
  Webmin Temperaturen liest (lm-sensors, hddtemp oder smartmontools auf dem
  Server);
- **Laufzeit**: in Tagen;
- **Verfügbare Updates** und **Sicherheitsupdates**: Anzahl der Pakete;
- **Neustart erforderlich**: 1, wenn der Server auf einen Neustart wartet
  (Debian und Ubuntu: `/var/run/reboot-required`; Red-Hat-Familie:
  `needs-restarting`).

Die Updates kommen aus dem Cache des Webmin-Moduls Software Package Updates,
standardmäßig 6 Stunden gültig: Gladys sieht ein neues Update, wenn Webmin es
sieht. Um sie früher zu sehen, senke **Cache time** in der Konfiguration dieses
Moduls.

## Dashboard

Das Widget **Webmin-Server** (wähle den Server in seinen Einstellungen) zeigt
die Zahl der Updates (orange, wenn welche warten, rot, wenn Sicherheitsupdates
dabei sind), Anzeigen für Arbeitsspeicher und den vollsten Datenträger, die
höchste Temperatur, dann die Sicherheitspakete, den Neustart, den freien
Speicher, die Last, die Auslagerung und die Laufzeit. Die Schaltfläche
**Aktualisieren** liest Webmin neu, samt Updates.

## Szenen

### Auslöser

- **Neue Sicherheitsupdates**: Auf einem Server erscheinen Sicherheitsupdates
  (einmal pro Stunde gelesen). Erneut bei jedem neuen Paket oder jeder neuen
  Version. Filter: Server. Variablen: Server, neue Pakete, neue
  Sicherheitsupdates, Sicherheitsupdates, verfügbare Updates.
- **Datenträger fast voll**: Ein Datenträger erreicht 80, 85, 90, 95 oder 98 %
  (die Schwelle ist ein Filter des Auslösers), für jeden Datenträger, den
  Webmin auflistet, nicht nur den vollsten. Erneut gemeldet, wenn er 2 Punkte
  darunter war. Variablen: Server, Einhängepunkt, belegter Speicher, freier
  Speicher (GB), Schwelle.
- **Server nicht erreichbar**: Der Server antwortet zwei Lesungen
  hintereinander nicht mehr (abgelehnte Zugangsdaten zählen nicht). Variablen:
  Server, Grund.

Die Auslöser gelten für jeden konfigurierten Server, ob zu Gladys hinzugefügt
oder nicht, und überstehen einen Neustart der Integration: Nichts wird
verpasst oder doppelt gemeldet.

### Aktionen

- **Zustand eines Webmin-Servers**: liest einen Server und gibt jeden Wert
  zurück (Updates, Sicherheitsupdates, Neustart erforderlich, zu
  aktualisierende Pakete, Prozessor, Arbeitsspeicher, Auslagerung, Lasten,
  vollster Datenträger, freier Speicher, Temperatur, Laufzeit) und eine
  **Zusammenfassung** für eine Nachricht, z. B. `NAS: 4 Update(s), davon 2
Sicherheitsupdate(s) (libssl3, openssl), Neustart erforderlich, Last 0,42,
Arbeitsspeicher 66 %, Datenträger / 87 % (59 GB frei)`.

### Ideen für Szenen

- Jeden Montag um 9 Uhr **Zustand eines Webmin-Servers**, dann die
  Zusammenfassung an dein Handy: die Wartungsliste der Woche.
- **Neue Sicherheitsupdates** → eine Telegram-Nachricht mit den Paketen.
- Wenn **Neustart erforderlich** auf 1 wechselt und niemand zu Hause ist, eine
  Erinnerung, am Abend neu zu starten.
- **Datenträger fast voll** bei 90 % → eine Benachrichtigung mit dem
  Einhängepunkt.

## Fehlerbehebung

- _installiere das Perl-Modul XML::Parser_: Installiere `libxml-parser-perl`
  (oder `perl-XML-Parser`) auf dem Server, ein Neustart von Webmin ist nicht
  nötig.
- _dieser Webmin-Benutzer darf keine RPC-Aufrufe machen_: Setze **Can accept
  RPC calls?** für den Benutzer auf Yes.
- _Benutzername oder Passwort abgelehnt_: Prüfe sie. Nach 5 Fehlanmeldungen
  sperrt Webmin die Adresse von Gladys für 60 Sekunden (_Webmin sperrt
  Gladys …_): Die Integration wartet dann 30 Minuten, bevor sie es erneut
  versucht, oder sofort mit **Verbindung testen**.
- _Zertifikat abgelehnt_: Aktiviere **Selbstsignierte Zertifikate
  akzeptieren**.
- _die Adresse leitet um_: Webmin läuft mit HTTPS: Gib `https://…` ein.
- _kein Webmin unter dieser Adresse_: Prüfe den Port (standardmäßig 10000).
- Updates unbekannt im Testbericht: Das Modul Software Package Updates fehlt
  oder kann den Paketmanager nicht lesen.

## Grenzen

- Nur lesend: Die Integration installiert nie ein Update und startet nie einen
  Server neu. Aufgerufene Funktionen: `system-status::collect_system_info`,
  `proc::get_system_uptime`, `webmin::get_webmin_version`,
  `webmin::get_system_hostname`, `package-updates::list_possible_updates`,
  `package-updates::check_reboot_required`.
- Bis zu drei Server. Usermin und Virtualmin werden nicht gelesen.
- Updates so aktuell wie der Cache von Webmin (standardmäßig 6 Stunden),
  einmal pro Stunde gelesen.
- Die Kennzeichnung als Sicherheitsupdate kommt aus der Paketquelle
  (`…-security`-Repositorys von Debian und Ubuntu): Andere Distributionen
  zeigen womöglich keine.
- Nicht mit Webmin verbunden.
