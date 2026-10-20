# Webmin

[Webmin](https://webmin.com) est l'interface web d'administration des serveurs
Linux et BSD. Cette intégration lit jusqu'à trois serveurs Webmin et apporte
dans Gladys ce qu'un outil de supervision ne dit pas : les **mises à jour de
paquets** en attente sur chaque serveur, celles de **sécurité** à part, et si
le serveur **attend un redémarrage**. Puis l'essentiel du tableau de bord de
Webmin : charge, processeur, mémoire, swap, disque le plus plein, température
la plus haute, durée de fonctionnement. Les scènes peuvent réagir à de
nouvelles mises à jour de sécurité, à un disque qui se remplit ou à un serveur
qui ne répond plus, et un widget résume un serveur. Tout reste sur votre réseau
local, et rien n'est jamais modifié sur le serveur.

Testée contre un vrai Webmin 2.670 sous Debian 12 (Docker) : mises à jour et
mises à jour de sécurité, redémarrage requis, mauvais mot de passe, adresse
bloquée, utilisateur sans droit RPC, certificat auto-signé. Pas encore dans un
vrai Gladys ni sur toutes les distributions : vos retours sont les bienvenus
dans [les issues](https://github.com/guim31/gladys-webmin/issues).

## Ce qu'il faut

- Gladys Assistant 5.1.0 ou plus récent.
- Webmin (2.x testé) sur chaque serveur, joignable depuis la machine Gladys
  (port 10000, en HTTPS, par défaut).
- Le module Perl **XML::Parser** sur le serveur : `apt install
libxml-parser-perl` (Debian, Ubuntu), `dnf install perl-XML-Parser` (Fedora,
  Rocky, Alma). Sans lui, Webmin ne répond à aucun appel XML-RPC.
- Pour les mises à jour : le module Webmin **Software Package Updates**
  (installé avec Webmin sur les distributions courantes).

## Mise en route

### 1. Créer un utilisateur Webmin pour Gladys

Dans Webmin, ouvrez **Webmin → Webmin Users → Create a new Webmin user** :

- nom `gladys` et un long mot de passe ;
- **Can accept RPC calls?** : **Yes** ;
- aucun module n'est nécessaire : laissez-les tous décochés ;
- conseillé, **IP access control** : n'autorisez que l'adresse de la machine
  Gladys.

Pourquoi cette restriction compte : par XML-RPC, Webmin laisse un tel
utilisateur appeler n'importe quelle fonction de Webmin, en root.
L'intégration n'appelle que des fonctions de lecture (listées dans la section
Limites), mais le mot de passe vaut un mot de passe root : réservez-le à
Gladys, et n'autorisez que l'adresse de Gladys.

### 2. Configurer l'intégration

Dans l'onglet **Configuration**, pour chaque serveur :

- **Adresse de Webmin** : `192.168.1.20`, `serveur.lan`, ou l'adresse copiée
  depuis le navigateur (`https://serveur.lan:10000/`). HTTPS et le port 10000
  sont pris par défaut pour un simple nom ou une IP ;
- **Utilisateur Webmin** et **Mot de passe** : l'utilisateur créé plus haut ;
- **Nom dans Gladys** (facultatif) : par défaut, le nom d'hôte donné par
  Webmin.

Options : **Intervalle de rafraîchissement** (1 à 10 minutes, 5 par défaut ;
les mises à jour sont lues une fois par heure quel que soit cet intervalle),
**Accepter les certificats auto-signés** (coché par défaut : Webmin en crée un
à l'installation), **Langue des noms de fonctionnalités**.

Enregistrez, puis cliquez sur **Tester la connexion** : une ligne par serveur,
avec la version de Webmin, le nombre de disques et de mises à jour.

### 3. Ajouter les appareils

Ouvrez l'onglet **Découverte** : un appareil par serveur qui a répondu.
Ajoutez ceux à suivre.

## Les appareils

Un appareil par serveur, avec ces fonctionnalités (noms dans la langue choisie
dans la configuration) :

- **En ligne** : 1 quand le serveur répond, 0 dès qu'il ne répond plus deux
  lectures de suite ;
- **Processeur**, **Mémoire**, **Swap** (si le serveur en a) : utilisation en
  % ;
- **Charge (1 min)**, **Charge (5 min)**, **Charge (15 min)** : les charges
  moyennes ;
- **Disque le plus plein** : utilisation du disque local le plus plein, en % ;
- **Température la plus haute** : le cœur de processeur ou le disque le plus
  chaud, quand Webmin lit les températures (lm-sensors, hddtemp ou
  smartmontools sur le serveur) ;
- **Durée de fonctionnement** : en jours ;
- **Mises à jour disponibles** et **Mises à jour de sécurité** : nombres de
  paquets ;
- **Redémarrage requis** : 1 quand le serveur attend un redémarrage (Debian et
  Ubuntu : `/var/run/reboot-required` ; famille Red Hat : `needs-restarting`).

Les mises à jour viennent du cache du module Webmin Software Package Updates,
valable 6 heures par défaut : Gladys voit une nouvelle mise à jour quand
Webmin la voit. Pour les voir plus tôt, baissez **Cache time** dans la
configuration de ce module.

## Tableau de bord

Le widget **Serveur Webmin** (choisissez le serveur dans ses réglages) affiche
le nombre de mises à jour (orange s'il y en a, rouge si certaines sont de
sécurité), des jauges mémoire et disque le plus plein, la température la plus
haute, puis les paquets de sécurité, le redémarrage, l'espace libre, la
charge, le swap et la durée de fonctionnement. Le bouton **Actualiser** relit
Webmin, mises à jour comprises.

## Scènes

### Déclencheurs

- **Nouvelles mises à jour de sécurité** : des mises à jour de sécurité
  apparaissent sur un serveur (lu une fois par heure). Relancé à chaque
  nouveau paquet ou nouvelle version. Filtre : serveur. Variables : serveur,
  nouveaux paquets, nouvelles mises à jour de sécurité, mises à jour de
  sécurité, mises à jour disponibles.
- **Disque presque plein** : un disque atteint 80, 85, 90, 95 ou 98 % (le seuil
  est un filtre du déclencheur), pour chaque disque listé par Webmin, pas
  seulement le plus plein. Annoncé de nouveau une fois redescendu de 2 points.
  Variables : serveur, point de montage, espace utilisé, espace libre (Go),
  seuil.
- **Serveur injoignable** : le serveur ne répond plus deux lectures de suite
  (des identifiants refusés ne comptent pas). Variables : serveur, raison.

Les déclencheurs valent pour chaque serveur configuré, ajouté à Gladys ou non,
et survivent à un redémarrage de l'intégration : rien n'est manqué ni annoncé
deux fois.

### Actions

- **État d'un serveur Webmin** : lit un serveur et rend chaque valeur (mises à
  jour, mises à jour de sécurité, redémarrage requis, paquets à mettre à jour,
  processeur, mémoire, swap, charges, disque le plus plein, espace libre,
  température, durée de fonctionnement) et un **résumé** prêt pour un
  message, par exemple `NAS : 4 mise(s) à jour, dont 2 de sécurité (libssl3,
openssl), redémarrage requis, charge 0,42, mémoire 66 %, disque / 87 % (59 Go
libres)`.

### Idées de scènes

- Chaque lundi à 9 h, **État d'un serveur Webmin**, puis envoi du résumé sur
  votre téléphone : la liste de maintenance de la semaine.
- **Nouvelles mises à jour de sécurité** → un message Telegram avec les
  paquets.
- Quand **Redémarrage requis** passe à 1 et que personne n'est à la maison, un
  rappel de redémarrer le soir.
- **Disque presque plein** à 90 % → une notification avec le point de montage.

## Dépannage

- _installez le module Perl XML::Parser_ : installez `libxml-parser-perl` (ou
  `perl-XML-Parser`) sur le serveur, inutile de redémarrer Webmin.
- _cet utilisateur Webmin n'a pas le droit aux appels RPC_ : mettez **Can
  accept RPC calls?** à Yes pour cet utilisateur.
- _nom d'utilisateur ou mot de passe refusé_ : vérifiez-les. Après 5 échecs de
  connexion, Webmin bloque l'adresse de Gladys pendant 60 secondes (_Webmin
  bloque Gladys…_) : l'intégration attend alors 30 minutes avant de réessayer,
  ou **Tester la connexion** tout de suite.
- _certificat refusé_ : cochez **Accepter les certificats auto-signés**.
- _l'adresse redirige_ : Webmin est en HTTPS : saisissez `https://…`.
- _aucun Webmin à cette adresse_ : vérifiez le port (10000 par défaut).
- Mises à jour inconnues dans le rapport de test : le module Software Package
  Updates manque ou ne sait pas lire le gestionnaire de paquets.

## Limites

- Lecture seule : l'intégration n'installe jamais de mise à jour et ne
  redémarre jamais de serveur. Fonctions appelées :
  `system-status::collect_system_info`, `proc::get_system_uptime`,
  `webmin::get_webmin_version`, `webmin::get_system_hostname`,
  `package-updates::list_possible_updates`,
  `package-updates::check_reboot_required`.
- Jusqu'à trois serveurs. Usermin et Virtualmin ne sont pas lus.
- Mises à jour aussi fraîches que le cache de Webmin (6 heures par défaut),
  lues une fois par heure.
- Le marquage « sécurité » vient de la source du paquet (dépôts `…-security` de
  Debian et Ubuntu) : d'autres distributions peuvent n'en montrer aucune.
- Sans lien avec Webmin.
