// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene event
// variables, scene action outputs and errors. Four languages, the four of the
// Gladys interface; German says "du", Spanish "usted". test/i18n.test.js
// checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './webmin/client.js';

export const LANGUAGE_FALLBACK = 'en';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of a Webmin server in the configuration.',
    fr: "Saisissez l'adresse d'un serveur Webmin dans la configuration.",
    de: 'Gib die Adresse eines Webmin-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de un servidor Webmin en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. 192.168.1.20 or https://server.lan:10000',
    fr: 'Adresse incomprise, ex. 192.168.1.20 ou https://serveur.lan:10000',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.20 oder https://server.lan:10000',
    es: 'Dirección no válida, p. ej. 192.168.1.20 o https://servidor.lan:10000',
  },
};

// One short explanation per error kind (src/webmin/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer (is Webmin running?)',
    fr: 'ne répond pas (Webmin est-il lancé ?)',
    de: 'antwortet nicht (läuft Webmin?)',
    es: 'no responde (¿se está ejecutando Webmin?)',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'user name or password refused',
    fr: "nom d'utilisateur ou mot de passe refusé",
    de: 'Benutzername oder Passwort abgelehnt',
    es: 'nombre de usuario o contraseña rechazados',
  },
  [ERROR_KINDS.BLOCKED]: {
    en: 'Webmin blocks Gladys after failed logins: check the password, wait a minute',
    fr: 'Webmin bloque Gladys après des échecs de connexion : vérifiez le mot de passe, attendez une minute',
    de: 'Webmin sperrt Gladys nach Fehlanmeldungen: Prüfe das Passwort, warte eine Minute',
    es: 'Webmin bloquea Gladys tras inicios de sesión fallidos: compruebe la contraseña, espere un minuto',
  },
  [ERROR_KINDS.RPC_DENIED]: {
    en: 'this Webmin user may not make RPC calls (see the documentation)',
    fr: "cet utilisateur Webmin n'a pas le droit aux appels RPC (voir la documentation)",
    de: 'dieser Webmin-Benutzer darf keine RPC-Aufrufe machen (siehe Dokumentation)',
    es: 'este usuario de Webmin no puede hacer llamadas RPC (consulte la documentación)',
  },
  [ERROR_KINDS.XML_PARSER]: {
    en: 'install the XML::Parser Perl module on the server (libxml-parser-perl)',
    fr: 'installez le module Perl XML::Parser sur le serveur (libxml-parser-perl)',
    de: 'installiere das Perl-Modul XML::Parser auf dem Server (libxml-parser-perl)',
    es: 'instale el módulo Perl XML::Parser en el servidor (libxml-parser-perl)',
  },
  [ERROR_KINDS.NOT_WEBMIN]: {
    en: 'no Webmin at this address (check the port, 10000 by default)',
    fr: 'aucun Webmin à cette adresse (vérifiez le port, 10000 par défaut)',
    de: 'kein Webmin unter dieser Adresse (prüfe den Port, standardmäßig 10000)',
    es: 'no hay ningún Webmin en esta dirección (compruebe el puerto, 10000 por defecto)',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.FAULT]: {
    en: 'Webmin refused the request, see the logs',
    fr: 'Webmin a refusé la requête, voir les logs',
    de: 'Webmin hat die Anfrage abgelehnt, sieh in den Protokollen nach',
    es: 'Webmin ha rechazado la solicitud, consulte los registros',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report, one line per server.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    disks: (count) => `${count} disk(s)`,
    updates: (count, security) => `${count} update(s) available, ${security} for security`,
    noUpdates: 'updates unknown (module "Software Package Updates" not readable)',
  },
  fr: {
    ok: 'OK',
    disks: (count) => `${count} disque(s)`,
    updates: (count, security) =>
      `${count} mise(s) à jour disponible(s), dont ${security} de sécurité`,
    noUpdates: 'mises à jour inconnues (module « Software Package Updates » illisible)',
  },
  de: {
    ok: 'OK',
    disks: (count) => `${count} Datenträger`,
    updates: (count, security) =>
      `${count} Update(s) verfügbar, davon ${security} Sicherheitsupdate(s)`,
    noUpdates: 'Updates unbekannt (Modul „Software Package Updates“ nicht lesbar)',
  },
  es: {
    ok: 'OK',
    disks: (count) => `${count} disco(s)`,
    updates: (count, security) =>
      `${count} actualización(es) disponible(s), ${security} de seguridad`,
    noUpdates: 'actualizaciones desconocidas (módulo «Software Package Updates» no legible)',
  },
};

// The `summary` output of "State of a server", ready for a message.
export const SUMMARY_TEXT = {
  en: {
    cpu: 'CPU',
    memory: 'memory',
    disk: 'disk',
    load: 'load',
    free: (size) => `${size} free`,
    updates: (count) => `${count} update(s)`,
    security: (count, names) => `${count} for security (${names})`,
    upToDate: 'up to date',
    reboot: 'reboot required',
    unreachable: 'unreachable',
  },
  fr: {
    cpu: 'processeur',
    memory: 'mémoire',
    disk: 'disque',
    load: 'charge',
    free: (size) => `${size} libres`,
    updates: (count) => `${count} mise(s) à jour`,
    security: (count, names) => `dont ${count} de sécurité (${names})`,
    upToDate: 'à jour',
    reboot: 'redémarrage requis',
    unreachable: 'injoignable',
  },
  de: {
    cpu: 'Prozessor',
    memory: 'Arbeitsspeicher',
    disk: 'Datenträger',
    load: 'Last',
    free: (size) => `${size} frei`,
    updates: (count) => `${count} Update(s)`,
    security: (count, names) => `davon ${count} Sicherheitsupdate(s) (${names})`,
    upToDate: 'aktuell',
    reboot: 'Neustart erforderlich',
    unreachable: 'nicht erreichbar',
  },
  es: {
    cpu: 'procesador',
    memory: 'memoria',
    disk: 'disco',
    load: 'carga',
    free: (size) => `${size} libres`,
    updates: (count) => `${count} actualización(es)`,
    security: (count, names) => `${count} de seguridad (${names})`,
    upToDate: 'actualizado',
    reboot: 'reinicio necesario',
    unreachable: 'inaccesible',
  },
};

// Units written in the texts (the French write "Go", the others "GB").
export const UNIT_TEXT = {
  gigabyte: { en: 'GB', fr: 'Go', de: 'GB', es: 'GB' },
};

// Errors of the scene actions (shown in Gladys).
export const ACTION_TEXT = {
  noServer: {
    en: 'No Webmin server is configured.',
    fr: "Aucun serveur Webmin n'est configuré.",
    de: 'Kein Webmin-Server ist konfiguriert.',
    es: 'No hay ningún servidor Webmin configurado.',
  },
  unknownServer: {
    en: 'This device does not belong to a configured Webmin server.',
    fr: "Cet appareil n'appartient à aucun serveur Webmin configuré.",
    de: 'Dieses Gerät gehört zu keinem konfigurierten Webmin-Server.',
    es: 'Este dispositivo no pertenece a ningún servidor Webmin configurado.',
  },
};

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A number written the way the language writes it (decimal comma in fr, de, es). */
export const formatNumber = (value, language, digits = 1) =>
  new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value);

/** "12 %" (fr, de, es) or "12%" (en). */
export const formatPercent = (value, language) =>
  `${formatNumber(value, language, 0)}${language === 'en' ? '%' : ' %'}`;

/** A size in GiB, "110 GB" / "110 Go". */
export const formatGigabytes = (bytes, language) =>
  `${formatNumber(bytes / 1024 ** 3, language, bytes >= 10 * 1024 ** 3 ? 0 : 1)} ${pick(
    UNIT_TEXT.gigabyte,
    language,
  )}`;

/** A temperature, "52 °C". */
export const formatCelsius = (value, language) => `${formatNumber(value, language, 0)} °C`;

/** An uptime, "4 d 3 h" / "4 j 3 h" / "4 T 3 Std." / "4 d 3 h". */
export function formatUptime(seconds, language) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const day = { en: 'd', fr: 'j', de: 'T', es: 'd' }[language] ?? 'd';
  const hour = language === 'de' ? 'Std.' : 'h';
  if (days > 0) {
    return `${days} ${day} ${hours} ${hour}`;
  }
  if (hours > 0) {
    return `${hours} ${hour} ${minutes} min`;
  }
  return `${minutes} min`;
}
