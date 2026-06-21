# AgentRoom - Plan complet de la solution

## 1. Vision

AgentRoom est une salle de comprehension entre plusieurs projets logiciels et leurs agents IA.

L'objectif n'est pas seulement de faire "discuter" deux terminaux Codex ou Claude. L'objectif est de permettre a deux projets de se comprendre:

- ce que chaque projet fournit;
- ce que chaque projet attend;
- quels dossiers, fichiers ou informations peuvent etre visibles;
- quelles questions restent ouvertes;
- quelles decisions ont ete prises;
- quelles integrations risquent de casser;
- quels agents travaillent sur quoi.

Exemple principal:

- Dev A travaille sur un site WordPress headless avec Claude Code.
- Dev B travaille sur un SaaS avec Codex.
- Le SaaS doit consommer les contenus, endpoints, schemas, medias, webhooks ou regles d'auth du site WordPress.
- AgentRoom permet aux deux agents de partager le contexte utile, de poser des questions, de detecter les incompatibilites et de garder une trace claire des decisions.

## 2. Positionnement

AgentRoom n'est pas:

- un simple chat entre agents;
- un Slack pour bots;
- une plateforme generique d'orchestration IA;
- un outil reserve aux developpeurs experts;
- un outil qui donne automatiquement acces a tout le code.

AgentRoom est:

- une interface visuelle pour comprendre les relations entre projets;
- un relais local-first entre agents Codex, Claude et autres;
- une couche de permissions pour partager seulement le contexte necessaire;
- un ledger de coordination: questions, reponses, decisions, contrats, tests, responsabilites;
- un outil pour rendre les integrations inter-projets plus fiables.

## 3. Utilisateurs cibles

### 3.1 Utilisateurs principaux

- Freelances qui travaillent avec plusieurs agents IA.
- Petites equipes produit qui divisent le travail entre plusieurs repos.
- Agences qui construisent des sites headless, SaaS, plugins, themes, apps clients.
- Fondateurs non techniques qui utilisent Codex ou Claude pour construire un produit.
- Product owners qui veulent comprendre ce que les agents font entre plusieurs projets.
- Equipes techniques avec plusieurs services dependants.

### 3.2 Cas d'usage forts

- WordPress headless + SaaS client.
- Backend API + frontend web app.
- App mobile + backend.
- Plugin WordPress + plateforme SaaS.
- Shopify theme + Shopify app.
- Design system + application produit.
- Microservice A + microservice B.
- Repo open source + integration client.

## 4. Probleme a resoudre

Aujourd'hui, quand deux agents IA travaillent sur deux projets differents:

- ils ne connaissent pas les attentes de l'autre projet;
- ils n'ont pas de vision claire des contrats d'integration;
- les humains doivent copier-coller les informations entre terminaux;
- les decisions se perdent dans des chats ou des plans;
- les changements d'API ou de schema cassent facilement l'autre projet;
- les permissions sont binaires: tout partager ou rien partager;
- les non-developpeurs ne comprennent pas ce qui se passe.

AgentRoom resout cela avec une couche de comprehension partagee.

## 5. Principe central

Chaque projet expose une representation lisible par humain et par agent:

- Project Card: qui est le projet et son role.
- Provides: ce que le projet fournit.
- Expects: ce que le projet attend des autres.
- Contracts: schemas, endpoints, types, evenements, webhooks.
- Permissions: ce qui peut etre lu ou non.
- Questions: ce qui doit etre clarifie.
- Decisions: ce qui a ete valide.
- Evidence: tests, diffs, checks, captures, logs utiles.

Les agents ne doivent pas "deviner" le projet de l'autre. Ils doivent lire une couche partagee, limitee et verifiable.

## 6. Experience utilisateur

### 6.1 Installation simple

Commande principale:

```bash
npx agentroom@latest
```

Alternative installation globale:

```bash
npm install -g agentroom
```

Puis:

```bash
agentroom
```

Alternative macOS:

```bash
brew install agentroom
```

La premiere commande doit:

- lancer un assistant;
- detecter le projet courant;
- ouvrir une interface web locale;
- proposer une configuration simple;
- creer les fichiers necessaires;
- aider a connecter Codex ou Claude.

### 6.2 Connexion d'un projet

Dans le premier projet:

```bash
cd mon-site-wordpress
npx agentroom@latest connect
```

Dans le second projet:

```bash
cd mon-saas
npx agentroom@latest join
```

Ou avec invitation:

```bash
agentroom invite
```

Puis:

```bash
agentroom join ar_8FK2-LM91
```

### 6.3 Interface visuelle

L'interface doit etre accessible a un non-developpeur.

Ecran principal:

```text
+---------------------------+          +---------------------------+
| Site WordPress Headless   | <------> | SaaS Client               |
| Fournit: contenus, medias |          | Attend: contenus, images  |
| Agent: Claude             |          | Agent: Codex              |
+---------------------------+          +---------------------------+

Incompatibilites: 2
Questions ouvertes: 4
Decisions a valider: 1
Contrats synchronises: 6
```

Zones principales:

- Carte des projets.
- Graphe de dependances.
- Questions entre agents.
- Permissions visuelles.
- Timeline de decisions.
- Contrats partages.
- Resume humain.

## 7. Objets produit

### 7.1 Project Card

La Project Card explique un projet de facon simple.

Exemple:

```md
# Project Card

Name: Headless WordPress Site
Role: Content provider for SaaS
Stack: WordPress, ACF, WPGraphQL

Provides:
- Blog posts
- Pages
- Case studies
- Media URLs
- SEO metadata
- Content update webhooks

Expects:
- Preview auth token from SaaS
- Supported locales
- Required image sizes
- Webhook endpoint

Primary agent:
- Claude Code

Human owner:
- Dev A
```

### 7.2 Provides

Ce que le projet fournit aux autres.

Exemple:

```json
{
  "project": "wordpress-site",
  "provides": [
    {
      "type": "graphql_resource",
      "name": "case_study",
      "fields": ["title", "slug", "heroImage", "clientName", "publishedAt"]
    },
    {
      "type": "webhook",
      "name": "content.updated",
      "payload": "docs/webhooks/content-updated.schema.json"
    }
  ]
}
```

### 7.3 Expects

Ce que le projet attend des autres.

Exemple:

```json
{
  "project": "saas-app",
  "expects": [
    {
      "from": "wordpress-site",
      "type": "graphql_resource",
      "name": "case_study",
      "required_fields": ["title", "slug", "heroImage"]
    },
    {
      "from": "wordpress-site",
      "type": "webhook",
      "name": "content.updated"
    }
  ]
}
```

### 7.4 Contract

Le contrat est la source de verite de l'integration.

Exemple:

```json
{
  "id": "contract_wordpress_saas_content_v1",
  "provider": "wordpress-site",
  "consumer": "saas-app",
  "status": "active",
  "resources": [
    {
      "kind": "GraphQL",
      "name": "CaseStudy",
      "fields": [
        { "name": "title", "type": "string", "required": true },
        { "name": "slug", "type": "string", "required": true },
        { "name": "heroImage", "type": "url", "required": false }
      ]
    }
  ],
  "breaking_changes_require_human_approval": true
}
```

### 7.5 Question

Les agents posent des questions structurees.

```json
{
  "type": "QUESTION",
  "id": "q_001",
  "from": "saas-agent",
  "to": "wordpress-agent",
  "topic": "case_study.heroImage",
  "question": "Is heroImage always present?",
  "impact": "The SaaS importer may fail if image is null.",
  "urgency": "blocking",
  "status": "open"
}
```

### 7.6 Answer

```json
{
  "type": "ANSWER",
  "question_id": "q_001",
  "from": "wordpress-agent",
  "answer": "No. heroImage can be null for older content.",
  "suggested_resolution": "Either add a SaaS fallback image or make the ACF field required.",
  "confidence": "high"
}
```

### 7.7 Decision

```json
{
  "type": "DECISION",
  "id": "d_001",
  "title": "Use fallback image when heroImage is null",
  "approved_by": ["Dev A", "Dev B"],
  "reason": "Older WordPress content can have no hero image.",
  "affects": ["wordpress-site", "saas-app"],
  "created_at": "2026-06-20T21:00:00Z"
}
```

### 7.8 Access Request

```json
{
  "type": "ACCESS_REQUEST",
  "from": "saas-agent",
  "to": "wordpress-owner",
  "path": "src/auth/preview-token.ts",
  "scope": "read-only",
  "reason": "Need to understand how preview authentication should work.",
  "status": "pending"
}
```

## 8. Permissions

### 8.1 Principe

La visibilite doit etre progressive:

1. Resume seulement.
2. Dossiers autorises.
3. Fichiers a la demande.
4. Projet complet, uniquement si l'humain l'autorise explicitement.

Le mode par defaut doit etre le plus sur: resume + contrats + docs.

### 8.2 Fichier de permissions

```md
# agentroom.permissions.md

## Visible
- README.md
- docs/**
- src/api/**
- src/types/**
- tests/fixtures/**
- wordpress/acf-json/**

## Ask First
- src/auth/**
- src/database/migrations/**
- config/**

## Hidden
- .env*
- secrets/**
- private/**
- src/billing/**
- .git/**

## Always Redact
- API keys
- tokens
- passwords
- private keys
- customer data
```

### 8.3 Permissions visuelles

Dans l'interface:

```text
Visibilite du projet WordPress

[Visible]       Documentation
[Visible]       API / schemas
[Visible]       Fixtures de test
[Ask First]     Auth / preview
[Hidden]        Paiement
[Hidden]        Secrets
```

### 8.4 Regles de securite

- Lecture seule par defaut pour l'autre agent.
- Aucune execution de commande dans le projet distant.
- Aucune modification de fichier distant.
- Les secrets sont masques automatiquement.
- Les demandes d'acces doivent expliquer pourquoi.
- Tout acces est journalise.
- Les decisions sensibles exigent approbation humaine.

## 9. Architecture technique

### 9.1 Architecture MVP

```text
Codex / Claude
     |
     | MCP tools / CLI commands / hooks
     v
AgentRoom Local Relay
     |
     | SQLite + files
     v
.agentroom/
     |
     v
Web UI locale
```

### 9.2 Composants

#### CLI

Commandes:

```bash
agentroom
agentroom connect
agentroom join
agentroom invite
agentroom status
agentroom doctor
agentroom permissions
agentroom disconnect
```

#### Local Relay

Responsabilites:

- gerer les sessions;
- recevoir les messages;
- stocker les evenements;
- appliquer les permissions;
- exposer les outils MCP;
- alimenter l'interface web;
- eviter les boucles de messages;
- journaliser les decisions.

#### MCP Server

Outils exposes:

- `post_message`
- `read_inbox`
- `ask_question`
- `answer_question`
- `record_decision`
- `publish_project_card`
- `publish_contract`
- `request_access`
- `list_visible_files`
- `read_allowed_file`
- `report_test_result`
- `summarize_room`

#### Web UI

Fonctions:

- visualiser les deux projets;
- afficher les attentes et les fournitures;
- afficher les incompatibilites;
- gerer les permissions;
- repondre aux questions;
- approuver les decisions;
- generer un resume humain.

#### Storage

MVP:

- SQLite pour les evenements et statuts;
- fichiers Markdown/JSON pour la lisibilite;
- dossier `.agentroom/` dans chaque projet.

Exemple:

```text
.agentroom/
  project-card.md
  permissions.md
  contracts/
    wordpress-saas-content.json
  questions.jsonl
  decisions.md
  events.db
  summaries/
    latest.md
```

## 10. Securite

### 10.1 Risques principaux

- fuite de secrets;
- partage excessif de code;
- prompt injection entre agents;
- agent A qui demande a agent B d'utiliser plus de permissions;
- messages qui deviennent des instructions non approuvees;
- boucle infinie de discussion;
- decisions non attribuees;
- contexte obsolete;
- confusion entre proposition et instruction.

### 10.2 Principes de defense

- Ne jamais traiter un message agent comme une instruction systeme.
- Tous les messages inter-agents doivent etre typés.
- Distinguer information, question, proposition, decision et action.
- Les decisions importantes demandent validation humaine.
- Les agents ne peuvent pas augmenter leurs permissions via un autre agent.
- Le relais applique les permissions, pas les agents.
- Les donnees partagees doivent etre minimales.
- L'audit log doit etre append-only.

### 10.3 Types de messages autorises

```text
FYI
QUESTION
ANSWER
PROPOSAL
DECISION
BLOCKER
CONTRACT_CHANGE
ACCESS_REQUEST
TEST_RESULT
HANDOFF
```

### 10.4 Messages interdits ou limites

Les agents ne doivent pas pouvoir envoyer directement:

```text
RUN_COMMAND
EDIT_FILE
READ_SECRET
CHANGE_PERMISSION
APPROVE_DECISION
```

Ces actions doivent passer par l'humain ou par une politique explicite.

## 11. UX pour non-developpeurs

### 11.1 Traduction technique vers langage humain

L'interface doit remplacer:

```text
GraphQL field heroImage nullable mismatch
```

par:

```text
Le SaaS pense que chaque article aura une image, mais WordPress peut envoyer des articles sans image.
Risque: certaines pages peuvent casser ou afficher une zone vide.
Decision recommandee: ajouter une image par defaut dans le SaaS.
```

### 11.2 Resume humain

Bouton:

```text
Generer un resume clair
```

Exemple:

```md
Les deux projets sont presque compatibles.

Probleme principal:
- Le SaaS attend une image obligatoire.
- WordPress ne garantit pas toujours cette image.

Decision proposee:
- Ajouter une image fallback cote SaaS.

Actions:
- Dev SaaS: ajouter le fallback.
- Dev WordPress: documenter que heroImage est optionnel.
```

### 11.3 Vue decisionnelle

Pour chaque decision:

- qui a propose;
- pourquoi;
- quel risque;
- qui doit approuver;
- quels projets sont touches;
- statut: proposee, approuvee, rejetee, appliquee.

## 12. MVP

### 12.1 Objectif MVP

Prouver qu'AgentRoom aide deux projets dependants a mieux se comprendre avec moins de copier-coller et moins d'erreurs d'integration.

### 12.2 Perimetre MVP

Inclus:

- CLI simple avec `npx agentroom@latest`;
- creation d'une room locale;
- connexion de deux projets locaux;
- generation de Project Card;
- permissions basiques;
- MCP mailbox;
- questions/reponses entre agents;
- contrats JSON simples;
- interface web locale;
- timeline de decisions;
- resume humain.

Exclus:

- edition distante de code;
- execution distante de commandes;
- multi-tenant cloud;
- SSO enterprise;
- marketplace d'adapters;
- A2A complet;
- support de 10 agents;
- modification automatique des permissions.

### 12.3 Demo MVP ideale

1. Ouvrir un repo WordPress.
2. Lancer:

```bash
npx agentroom@latest connect
```

3. Ouvrir un repo SaaS.
4. Lancer:

```bash
npx agentroom@latest join
```

5. AgentRoom genere:

- Project Card WordPress;
- Project Card SaaS;
- contrats detectes;
- attentes non satisfaites;
- questions ouvertes.

6. Le SaaS demande:

```text
Est-ce que heroImage est obligatoire ?
```

7. WordPress repond:

```text
Non, certains contenus anciens n'ont pas d'image.
```

8. AgentRoom propose une decision:

```text
Ajouter un fallback image cote SaaS.
```

9. L'humain approuve.
10. Les deux agents mettent leur plan a jour.

## 13. Roadmap

### Phase 1 - Prototype local

- CLI Node.js.
- SQLite.
- Web UI locale.
- Project Cards.
- Questions/reponses.
- Permissions Markdown.
- MCP server minimal.

### Phase 2 - Integration Codex / Claude

- Instructions auto pour connecter Codex.
- Instructions auto pour connecter Claude.
- Detection de `AGENTS.md` et `CLAUDE.md`.
- Hooks optionnels.
- Lecture controlee de fichiers autorises.

### Phase 3 - Contrats intelligents

- Detection d'API REST.
- Detection GraphQL.
- Detection TypeScript types.
- Detection OpenAPI.
- Detection ACF / WPGraphQL.
- Detection webhooks.
- Comparaison Provides vs Expects.

### Phase 4 - UX avancee

- Graphe de dependances.
- Permissions drag-and-drop.
- Resume non-technique.
- Notifications.
- Decision board.
- Export client.

### Phase 5 - Collaboration distante

- Rooms partagees via tunnel securise.
- Invitations.
- Historique synchronise.
- Gestion d'equipe.
- Stockage cloud optionnel.

### Phase 6 - Version entreprise

- SSO.
- Audit logs avances.
- Policies.
- Redaction avancee.
- Self-host.
- Data residency.
- Gestion multi-projets.

## 14. Backlog fonctionnel

### Must-have

- Installation simple.
- Interface web locale.
- Connexion de deux projets.
- Project Card.
- Permissions visibles/cachees.
- Questions/reponses.
- Decisions.
- Contrats simples.
- Resume humain.

### Should-have

- MCP adapter.
- Hooks Codex/Claude.
- Detection stack.
- Detection fichiers sensibles.
- Detection types/API.
- Timeline.
- Export Markdown.
- Mode read-only strict.

### Could-have

- Slack integration.
- GitHub PR comments.
- Cloud rooms.
- A2A gateway.
- Multi-agent rooms.
- Visual diff of contracts.
- AI-generated diagrams.

### Won't-have in MVP

- Edition de code entre projets.
- Execution de commandes distantes.
- Permissions automatiques sans validation.
- Support enterprise complet.
- Orchestration autonome totale.

## 15. Modele de donnees initial

### Tables SQLite

```sql
projects(
  id text primary key,
  name text,
  path text,
  role text,
  stack text,
  created_at text
);

agents(
  id text primary key,
  project_id text,
  name text,
  kind text,
  status text
);

messages(
  id text primary key,
  room_id text,
  from_agent_id text,
  to_agent_id text,
  type text,
  payload_json text,
  created_at text
);

questions(
  id text primary key,
  room_id text,
  from_project_id text,
  to_project_id text,
  topic text,
  question text,
  impact text,
  status text,
  created_at text
);

decisions(
  id text primary key,
  room_id text,
  title text,
  reason text,
  status text,
  approved_by text,
  created_at text
);

contracts(
  id text primary key,
  provider_project_id text,
  consumer_project_id text,
  version text,
  payload_json text,
  status text
);

access_requests(
  id text primary key,
  from_project_id text,
  to_project_id text,
  path text,
  reason text,
  scope text,
  status text,
  created_at text
);
```

## 16. Stack technique recommandee

### CLI

- Node.js + TypeScript.
- Distribution via npm: `npx agentroom@latest`.
- Package global optionnel.

### UI

- React + Vite.
- Local web server.
- Tailwind ou CSS simple.
- Graphe avec React Flow.

### Backend local

- Node.js.
- SQLite.
- WebSocket pour updates temps reel.
- MCP server stdio/http.

### Detection projet

- Lecture de `package.json`, `composer.json`, `wp-config.php`, `schema.graphql`, `openapi.yaml`.
- Detection de `AGENTS.md`, `CLAUDE.md`, README.
- Ignore automatique de `.env`, `.git`, `node_modules`, `vendor`, `dist`, `build`.

## 17. Packaging et installation

### Commande zero friction

```bash
npx agentroom@latest
```

### Premier ecran CLI

```text
AgentRoom

1. Connect this project
2. Join an existing room
3. Open dashboard
4. Run diagnostics
```

### Auto-open dashboard

Apres lancement:

```text
AgentRoom is running:
http://localhost:4317
```

### Fallback manuel

Si Codex ou Claude ne peuvent pas etre configures automatiquement, afficher:

```text
Copy this instruction into your agent:

You are connected to AgentRoom. Use the local MCP tools to:
- publish your project card
- read allowed context from the other project
- ask structured questions
- record decisions only after human approval
```

## 18. Differenciation

AgentRoom se differencie par:

- une UX visuelle pour non-developpeurs;
- une installation tres simple;
- une approche local-first;
- des permissions granulaires;
- des contrats inter-projets;
- une separation claire entre discussion et decision;
- une compatibilite Codex/Claude;
- un focus sur la comprehension entre projets, pas seulement l'orchestration d'agents.

## 19. Risques produit

### Risque 1: Trop technique

Mitigation:

- interface visuelle;
- resumes humains;
- permissions en langage metier;
- assistant d'installation.

### Risque 2: Trop de bruit

Mitigation:

- pas de chat libre par defaut;
- messages typés;
- regroupement des questions;
- mode quiet;
- notifications seulement pour blockers/decisions.

### Risque 3: Securite

Mitigation:

- read-only par defaut;
- permissions strictes;
- redaction secrets;
- audit log;
- validation humaine.

### Risque 4: Integration fragile avec Codex/Claude

Mitigation:

- commencer avec CLI + MCP;
- hooks optionnels;
- instructions manuelles en fallback;
- adapters versionnes.

### Risque 5: Les utilisateurs preferent GitHub/Slack

Mitigation:

- integration future GitHub/Slack;
- montrer une valeur differente: comprehension visuelle, contrats, permissions.

## 20. Indicateurs de succes

Pour le MVP:

- temps pour connecter deux projets: moins de 5 minutes;
- nombre de copier-coller evites;
- nombre d'incompatibilites detectees;
- nombre de questions resolues;
- nombre de decisions tracees;
- comprehension par un non-dev apres lecture du resume;
- reduction des erreurs d'integration dans la demo.

## 21. Pitch court

AgentRoom permet a deux projets et leurs agents IA de se comprendre.

Au lieu de copier-coller du contexte entre Codex, Claude et plusieurs repos, chaque projet expose ce qu'il fournit, ce qu'il attend et ce qu'il accepte de partager. Les agents peuvent poser des questions, signaler les incompatibilites, proposer des decisions et garder une trace claire. L'interface visuelle rend tout comprehensible meme pour les non-developpeurs.

## 22. Pitch long

Les developpeurs utilisent de plus en plus Codex, Claude et d'autres agents IA pour coder. Mais des qu'un projet depend d'un autre, les agents travaillent en silos. Un agent ne sait pas ce que l'autre projet attend, quelles API sont disponibles, quels dossiers il peut lire, quelles decisions ont ete prises ou quelles integrations risquent de casser.

AgentRoom cree une salle de comprehension entre projets. Chaque projet publie une fiche, des contrats, des attentes et des permissions. Les agents peuvent se poser des questions structurees, demander l'acces a certains fichiers, proposer des decisions et mettre a jour leurs plans. Les humains gardent le controle grace a une interface visuelle, des permissions claires et une timeline de decisions.

Le resultat: moins de copier-coller, moins d'integrations cassees, plus de transparence, et une collaboration IA plus comprehensible pour les equipes techniques comme non techniques.

## 23. Prochaine etape recommandee

Construire un prototype en 7 jours:

Jour 1:
- CLI `npx agentroom@latest`.
- Creation `.agentroom/`.
- Detection projet simple.

Jour 2:
- Project Card automatique.
- Permissions Markdown.

Jour 3:
- SQLite event store.
- Questions/reponses.

Jour 4:
- Web UI locale avec deux cartes projet.
- Liste des questions.

Jour 5:
- MCP server minimal.
- Outils `ask_question`, `answer_question`, `record_decision`.

Jour 6:
- Contrats JSON simples.
- Detection Provides vs Expects.

Jour 7:
- Demo WordPress headless + SaaS.
- Resume humain.
- Polish onboarding.

## 24. Decision de cadrage

La version 1 doit etre:

- locale;
- visuelle;
- read-only;
- orientee comprehension;
- limitee a deux projets;
- compatible Codex/Claude via MCP ou instructions;
- centree sur questions, contrats, decisions et permissions.

La version 1 ne doit pas essayer de devenir une plateforme autonome complete.

Le slogan interne:

> AgentRoom: the shared understanding layer for AI-coded projects.

