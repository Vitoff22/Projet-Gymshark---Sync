# Gymshark Sync

Assistant IA interne pour améliorer la productivité et la coordination en entreprise. Gymshark Sync permet aux utilisateurs de dialoguer avec un LLM local (via Ollama) pour organiser leurs tâches, générer des synthèses, planifier des actions et automatiser des workflows.

## Stack technique

| Composant         | Technologie                                                          |
| ----------------- | -------------------------------------------------------------------- |
| **Frontend**      | HTML5, CSS3 (variables, grid, flexbox), JavaScript (vanilla ES2020+) |
| **Backend**       | Node.js, Express 5.2                                                 |
| **Module system** | ES6 Modules (`import` / `export`)                                    |
| **LLM**           | Ollama (modèle `phi3:mini` par défaut)                               |
| **Persistance**   | Fichier JSON (`data/conversations.json`)                             |
| **Communication** | SSE (Server-Sent Events) pour le streaming des réponses              |
| **API Docs**      | Swagger UI + OpenAPI 3 (`/api/docs`)                                 |

## Structure du projet

```
Projet-Gymshark---Sync/
├── backend/
│   ├── config/
│   │   └── prompt.js            # Chargement du system prompt
│   ├── routes/
│   │   └── chat.js              # Routes API (chat, conversations, health)
│   ├── services/
│   │   ├── history.js           # Persistance des conversations (JSON)
│   │   └── ollama.js            # Communication streaming avec Ollama
│   ├── server.js                # Point d'entrée du serveur Express
│   ├── system_prompt            # Instructions système du LLM
│   ├── .env.example             # Variables d'environnement (template)
│   ├── package.json
│   └── package-lock.json
├── frontend/
│   ├── index.html               # Page principale (SPA)
│   ├── style.css                # Styles (design dark, glassmorphism)
│   └── app.js                   # Logique frontend (chat, navigation, SSE)
├── data/
│   └── conversations.json       # Stockage des conversations (auto-généré)
├── .gitignore
├── toRun.todo                   # Mémo d'installation Ollama
└── README.md
```

## Documentation du code

Pour comprendre rapidement l'architecture et les principaux flux techniques:

- Voir [docs/guide-technique.md](docs/guide-technique.md)

Ce guide couvre:

- le role de chaque module backend/frontend,
- le flux de chat en streaming SSE,
- la persistance des conversations,
- les points d'extension et de debug.

## Prérequis

- **Node.js** >= 22 (version maintenue, avec `fetch` natif)
- **Ollama** installé et fonctionnel ([ollama.com](https://ollama.com))

## Installation et lancement

### 1. Installer Ollama et le modèle

```bash
# Installer Ollama (voir https://ollama.com pour les instructions selon l'OS)
# Démarrer le serveur Ollama
ollama serve

# Télécharger le modèle (dans un autre terminal)
ollama pull llama3
```

### 2. Configurer le backend

```bash
cd backend

# Installer les dépendances
npm ci --ignore-scripts

# Copier et adapter le fichier d'environnement
cp .env.example .env
# Modifier .env si nécessaire (URL Ollama, modèle, timeout)
```

### 3. Lancer le serveur backend

```bash
cd backend
npm start
# Le serveur démarre sur http://localhost:3000
# Swagger UI : http://localhost:3000/api/docs
# Spec OpenAPI JSON : http://localhost:3000/api/docs.json
```

### 4. Ouvrir le frontend

Servir le dossier `frontend/` en HTTP local, puis ouvrir `http://localhost:8080`. L’ouverture directe de `index.html` via `file://` n’est pas prise en charge : les origines `null` sont volontairement refusées par le backend.

```bash
# Exemple avec Python
cd frontend
python3 -m http.server 8080 --bind 127.0.0.1
# Puis ouvrir http://localhost:8080
```

## Lancement automatise (Linux/macOS + Windows)

Des scripts sont disponibles a la racine pour demarrer automatiquement :

- Ollama (`ollama serve`) seulement si necessaire
- Le backend (port `3000` par defaut)
- Le frontend (port `8080` par defaut)

### Linux / macOS

```bash
./start_project.sh
```

### Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File .\start_project.ps1
```

### Windows (CMD)

```bat
start_project.bat
```

Ports personnalisables via variables d'environnement :

- `OLLAMA_HOST`
- `OLLAMA_PORT`
- `BACKEND_PORT`
- `FRONTEND_PORT`

## Variables d'environnement

| Variable         | Description                                   | Valeur par défaut        |
| ---------------- | --------------------------------------------- | ------------------------ |
| `OLLAMA_URL`     | URL du serveur Ollama                         | `http://localhost:11434` |
| `OLLAMA_MODEL`   | Nom du modèle LLM à utiliser                  | `phi3:mini`              |
| `OLLAMA_TIMEOUT` | Timeout d'inactivité en ms (vide = désactivé) | `60000`                  |
| `PORT`           | Port du serveur Express                       | `3000`                   |

## Routes API

| Méthode  | Endpoint                 | Description                                    |
| -------- | ------------------------ | ---------------------------------------------- |
| `POST`   | `/api/chat`              | Envoie un message et streame la réponse SSE    |
| `GET`    | `/api/conversations`     | Liste toutes les conversations (sans messages) |
| `GET`    | `/api/conversations/:id` | Récupère une conversation complète par ID      |
| `DELETE` | `/api/conversations/:id` | Supprime une conversation                      |
| `GET`    | `/api/llm/health`        | Health check du serveur Ollama                 |
| `GET`    | `/api/test-stream`       | Test de streaming SSE avec un prompt simple    |
| `GET`    | `/api/docs`              | Interface Swagger UI                           |
| `GET`    | `/api/docs.json`         | Spécification OpenAPI JSON                     |

### Format du body `POST /api/chat`

```json
{
  "message": "Résume mes tâches de la semaine",
  "conversationId": "conv_1234567890"
}
```

Le `conversationId` est optionnel. S'il est omis, un nouvel ID est généré automatiquement.

## Fonctionnalités principales

- **Chat en streaming** : Les réponses du LLM s'affichent en temps réel grâce au protocole SSE
- **Historique des conversations** : Persistance sur disque, chargement et suppression depuis la sidebar
- **Édition de messages** : Possibilité de modifier un message utilisateur et de régénérer la réponse
- **Suggestions rapides** : Prompts pré-définis pour démarrer rapidement une conversation
- **Cartes d'action** : Synthèse, Organisation et Automatisation accessibles depuis l'accueil
- **Vues multiples** : Chat, Recherche, Raccourcis, Centre d'aide, Documentation
- **Effets visuels** : Spotlight suivant le curseur, animations d'entrée, effets ripple, halos
- **Design responsive** : Adapté aux écrans de bureau et mobiles
- **Accessibilité** : Support `prefers-reduced-motion`, `aria-label`, `focus-visible`


## Sécurité et limites du démonstrateur

Ce projet est un **démonstrateur local**, pas un service public avec comptes utilisateurs. Le frontend attend le backend sur le port `3000` ; conserver ce port (modifier `PORT` / `BACKEND_PORT` seul ne reconfigure pas le frontend ni sa CSP). Un autre port frontend est possible avec `-FrontendPort` sous PowerShell, ou `FRONTEND_PORT` sous Bash. Le backend et le serveur frontend de lancement écoutent uniquement sur `127.0.0.1`. Les contrôles Host et Origin rejettent les sites tiers (y compris les origines `null`). Ne pas exposer ces ports via un tunnel ou un proxy public : il faudrait d'abord une authentification, HTTPS, des quotas par compte et un stockage adapté.

L'historique est désormais propre au navigateur : un cookie signé `HttpOnly`, `SameSite=Strict`, valable 30 jours, identifie chaque session. Le cookie est envoyé avec les requêtes du frontend, et chaque lecture, modification et suppression vérifie le propriétaire. La clé de signature locale est dans `data/session.key`, ignorée par Git. Le dossier `data/` contient des informations privées et ne doit jamais être servi comme dossier web ou envoyé sur GitHub. La suppression du cookie ou de cette clé rend les conversations correspondantes inaccessibles depuis l'interface.

Les conversations créées avant cette protection restent conservées dans `data/conversations.json`, sans être attribuées arbitrairement au premier visiteur. Elles ne sont plus accessibles dans l'interface ; démarrer une **nouvelle conversation** si un ancien identifiant provoque une erreur. Une reprise des anciens échanges demande une migration locale explicite après identification de leur propriétaire.

Protections appliquées : corps JSON limité à 16 Kio, message limité à 8 000 caractères, 60 requêtes API par minute pour ce processus local, deux générations simultanées maximum et une par navigateur, délai total de 120 secondes, réponse limitée à 64 000 caractères, arrêt de la génération après déconnexion. Le stockage conserve les 200 derniers messages par conversation, au maximum 100 conversations par navigateur, 1 000 au total et 20 Mio de fichier. Une seule instance du backend doit utiliser ce dossier de données. Les écritures sont sérialisées et remplacent le fichier atomiquement ; un fichier corrompu n'est jamais réinitialisé silencieusement.

Les erreurs fournisseur ne sont pas exposées au navigateur. Les réponses Markdown échappent le HTML et n'autorisent que des liens HTTP(S), sans chargement automatique des images distantes. Une politique CSP restreint les scripts et les connexions. Les polices et icônes restent des ressources externes Google Fonts/CDNJS. Le formulaire de documentation Swagger fonctionne en local. `/api/test-stream` est désactivé par défaut ; `ENABLE_TEST_STREAM=true` l'active avec les mêmes limites de génération.

Gestionnaire pris en charge : **npm uniquement**, avec `backend/package-lock.json` comme fichier de verrouillage de référence. Installation reproductible : `cd backend`, puis `npm ci --ignore-scripts`. Vérifications : `npm test` et `npm audit`. Les tests couvrent notamment l'isolation entre navigateurs, les cookies falsifiés, les origines interdites, les limites, la déconnexion et le rendu Markdown. L'override `js-yaml` est limité au chargeur de configuration NYC de Jest ; son API `load` reste compatible et évite l'ancienne dépendance `sprintf-js` vulnérable.
