# Atolls HR — Next.js + Firebase Realtime Database

Version Firebase du portail RH : connexion Google existante, compte `ADMIN_EMAIL` externe autorisé avec son rôle actuel (y compris Dev), rôles et départements séparés, statut Manager, congés, réunions, notifications et calcul mensuel Work Tickets.

Les données RH sont privées. Le navigateur écoute uniquement un marqueur de changement Firebase, puis recharge les données autorisées via Next.js. Les rôles et les sessions sont contrôlés côté serveur. Aucune clé privée ne doit entrer dans Git ou dans une variable `NEXT_PUBLIC_`.

## Migrer ton site Netlify existant, sans terminal

### 1. Créer Firebase

1. Ouvre https://console.firebase.google.com/ et crée un projet.
2. Dans **Build → Realtime Database → Create database**, choisis **Realtime Database**, pas Cloud Firestore. Choisis une région proche de tes fonctions Netlify. Commence en **mode verrouillé**.
3. Copie l'URL exacte affichée : `https://...firebasedatabase.app` ou `https://...firebaseio.com`.
4. Dans l'onglet **Rules**, remplace les règles par le contenu de `firebase/database.rules.json`, puis publie. La lecture/écriture publique reste interdite. Seul le marqueur `atolls/revision` peut être lu par un utilisateur Firebase ayant une session Atolls active et non expirée. Les clients ne peuvent pas lire les dossiers RH ni écrire directement.
5. Dans **Build → Authentication**, clique sur **Get started**. Les connexions Firebase utilisent des jetons personnalisés créés par le serveur ; la connexion Google du portail reste inchangée. Aucun fournisseur Anonymous/Email-Password ne doit être activé pour ce projet.
6. Dans **Project settings → General**, ajoute une application Web et récupère la propriété `apiKey` de sa configuration.
7. Dans **Project settings → Service accounts**, génère une clé privée. Garde le fichier JSON hors du dépôt. Utilise un compte de service de ce même projet ayant l'accès administrateur à Realtime Database et l'accès Firebase Authentication nécessaire aux jetons personnalisés.

### 2. Variables Netlify

Dans les variables d'environnement du site, ajoute ces valeurs avec **Builds et Functions**, contexte **Production** :

| Variable | Valeur |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `project_id` du JSON du compte de service |
| `FIREBASE_DATABASE_URL` | URL exacte de Realtime Database |
| `FIREBASE_CLIENT_EMAIL` | `client_email` du JSON |
| `FIREBASE_PRIVATE_KEY` | Valeur complète `private_key`, sans guillemets extérieurs ; les séparateurs littéraux `\n` sont acceptés |
| `FIREBASE_WEB_API_KEY` | `apiKey` de l'application Web Firebase |

Marque la clé privée comme secrète. Conserve Google OAuth, `APP_URL`, `COMPANY_DOMAIN`, `ADMIN_EMAIL` et SMTP existants. Ne préfixe pas les secrets par `NEXT_PUBLIC_`. La clé API Web Firebase est une configuration publique, pas une clé de compte de service ; elle est transmise uniquement au navigateur connecté. Les règles protègent les données indépendamment de cette clé.

### 3. Transférer Turso une seule fois

1. Conserve `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN` disponibles aux **Builds → Production**. Un jeton Turso en lecture seule suffit si tu en disposes.
2. La destination Firebase `/atolls` doit être vide : ne lance pas une initialisation avant l'import.
3. Supprime/désactive `INITIALIZE_DATABASE`. Ajoute **`MIGRATE_TURSO_TO_FIREBASE=true`**, portée **Builds**, contexte **Production** uniquement.
4. Préviens les utilisateurs de ne pas modifier les données pendant la bascule. Le dernier déploiement Turso reste actif pendant le build ; une modification faite après la capture de la source ne sera pas transférée. Garde une sauvegarde Turso avant la bascule. Si SMTP est actif, suspends aussi les envois pendant la bascule ; une file de notifications reprise après interruption peut sinon renvoyer un message.
5. Remplace le code du dépôt connecté à Netlify par cette version complète. Garde `npm run build` et `.next`. Lance le déploiement Production.
6. Le build lit un instantané cohérent de Turso, convertit les données JSON et les importe atomiquement dans Firebase. Il conserve les identifiants, comptes, rôles/permissions, profils, départements, congés, fériés, réunions, participants, anciens tickets, journaux et notifications. Les sessions ne sont pas transférées : chacun se reconnectera. La base Turso n'est pas modifiée.
7. Le message attendu est **Turso import complete**. Si l’import réussit mais que la compilation échoue ensuite, retire le flag avant de relancer le déploiement : les données sont déjà dans Firebase. Après réussite, supprime `MIGRATE_TURSO_TO_FIREBASE` ainsi que les deux variables Turso de Netlify. Ne laisse pas le flag d'import actif pour les déploiements suivants : un second import est refusé pour protéger les données Firebase.
8. Ouvre `/api/health` : la réponse doit contenir `ok: true` et `provider: firebase-realtime-database`. Connecte-toi avec ton compte existant ; son rôle est conservé, notamment Dev. Vérifie les employés, congés, rôles et Work Tickets avant d'autoriser les utilisateurs à reprendre les modifications.

Le code migré ne change pas ta base réelle tant que tu n'as pas configuré les accès et lancé l'import. Aucun jeton réel n'est inclus dans l'archive. Garde la base Turso et l'ancienne archive comme point de retour. Si des écritures ont commencé dans Firebase, un retour à Turso nécessitera leur réconciliation ; il ne faut pas basculer simplement vers l'ancien site en perdant ces changements.

## Installation neuve, sans données Turso

N'active pas le flag d'import. Pour une base Firebase neuve, mets temporairement `INITIALIZE_DATABASE=true` en **Builds → Production**, puis déploie. Le projet crée les cinq rôles, les départements, les salles et un premier compte RH à l'adresse `ADMIN_EMAIL`. Retire le flag après réussite. Une initialisation répétée préserve les comptes actifs et leurs rôles ; elle ne réactive aucun compte désactivé. L'initialisation et l'import ne peuvent pas être activés ensemble.

Pour utiliser un compte configuré existant en **Dev**, conserve son rôle dans la source avant import. `ADMIN_EMAIL` autorise uniquement cette adresse Google vérifiée hors du domaine ; il ne donne pas de droits RH à la connexion. Garde un autre compte RH pour administrer le portail.

## Actualisation et sauvegardes

Firebase Realtime Database diffuse un marqueur de révision avec un jeton utilisateur lié à la session Atolls. Le serveur ne diffuse aucun dossier RH directement. Chaque changement déclenche un rafraîchissement des données autorisées et du calcul Work Tickets. Une vérification toutes les 30 secondes et au retour sur l'onglet complète ce mécanisme si le flux est interrompu.

Les formulaires ouverts et les pages Profile/Settings reportent les rafraîchissements pour préserver les saisies. Après fermeture, les changements en attente sont chargés. Une sauvegarde affiche sa confirmation après l'écriture effective, puis recharge l'affichage en arrière-plan. Les modifications restent validées sur le serveur, et les comptes inactifs sont refusés à chaque requête.

Le serveur fait une lecture Firebase par instantané métier, au lieu d'une requête réseau par employé/rôle et module. Les écritures utilisent des requêtes conditionnelles ETag avec reprise sur conflit. Réservation, validation du congé, audit et notifications sont validés atomiquement ; aucun envoi SMTP n'a lieu dans une transaction pouvant être rejouée.

Cette version vise un portail interne de volume modéré : l'état de l'organisation est lu et validé comme une unité pour préserver les invariants RH. Un gros historique ou beaucoup d'écritures simultanées nécessiteraient une partition des données et des transactions. Aucun gain de délai en production n'a été mesuré avec tes comptes ; Firebase ne supprime pas la latence réseau ni les coûts de transfert.

## Work Tickets

Un compte employé ou Manager reçoit uniquement son propre calcul mensuel. Les comptes ayant la portée organisation et les droits Employees View/Edit disposent de tous les employés, d'une recherche et du total de la liste.

Formule : jours du mois − samedis/dimanches − jours fériés configurés en semaine − congés approuvés en semaine. Chaque date est déduite une seule fois. Tous les fériés configurés sont utilisés comme calendrier commun : les employés n'ont pas encore de calendrier de bureau individuel. Il s'agit d'une estimation calendaire du mois entier, pas d'un pointage de présence. Les contrats à temps partiel, demi-journées et dates d'entrée/sortie ne sont pas modélisés. Les préférences de jours au bureau ne réduisent pas les jours ouvrés. Les anciens tickets de tâches sont conservés mais le tableau Kanban n'est plus l'écran Work Tickets.

## Développement et contrôles locaux

Node.js 24. Copie `.env.example` en `.env.local`, complète les valeurs hors Git, puis `npm ci` et `npm run dev`. Les builds n'appellent pas Firebase sans flag explicite. Les commandes facultatives sont `npm run db:setup`, `npm run seed`, `npm run db:check`, `npm run db:migrate:turso`. Aucune commande locale n'est nécessaire avec le chemin Netlify décrit ci-dessus.

Google OAuth garde ces URL pour ton site : origine ``, callback ``. Si `ADMIN_EMAIL` est externe, l'audience Google doit autoriser les comptes externes et inclure ce compte comme utilisateur de test lorsque l'application est en mode Testing. L'authentification conserve state, PKCE, nonce et la vérification de signature du jeton Google.

Voir `VALIDATION.md` pour les contrôles réellement effectués. Le service SMTP facultatif et la fonction planifiée Netlify conservent la livraison des notifications ; sans SMTP, les notifications restent disponibles dans le portail. L'interface reste en anglais ; la préférence de langue est mémorisée sans traduction automatique.

Références officielles :
- https://firebase.google.com/docs/database/rest/auth
- https://firebase.google.com/docs/database/rest/save-data
- https://firebase.google.com/docs/database/rest/retrieve-data
- https://firebase.google.com/docs/auth/admin/create-custom-tokens
