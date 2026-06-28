# TabbyRDP

Stream your desktop displays and individual application windows to a browser tab over WebRTC — with near-native keyboard and mouse control, mobile-device authentication, and cost-conscious cloud infrastructure.

## What it does

TabbyRDP pairs a lightweight **desktop agent** (Rust) with a **browser-based viewer** (React). After you authenticate with your phone, the launchpad shows live thumbnails of each display alongside a scrollable list of capturable apps. Pick a source, open a tab, and interact as if you were sitting at the machine.

- **Display and per-app capture** — stream full monitors or individual application framebuffers
- **Mobile auth key** — sign in and approve sessions from your phone (QR scan + biometric confirm)
- **Launchpad** — two-column UI with display thumbnails (refreshed on connect and every 5 minutes) and an app list
- **Remote input** — keyboard, mouse, scroll, clipboard paste, and system commands (Ctrl+Alt+Del, sleep, restart, shutdown)
- **Source locking** — only one browser tab can stream a given display or app at a time
- **Cross-platform agent** — Windows, macOS, and Linux (Linux is the primary development target)

The desktop agent never changes display settings on the host.

## Architecture

| Component | Location | Role |
|---|---|---|
| Desktop agent | `desktop-agent/` | Rust service — screen capture, input injection, WebRTC peer |
| Web viewer | `frontend/` | React + TypeScript app — auth, launchpad, stream viewer |
| Backend | `infra/` | AWS CDK stack — WebSocket signaling, REST auth, TURN credentials, update distribution |
| CI/CD | `.github/workflows/`, `scripts/` | GitHub Actions pipelines and developer tooling |

Signaling and session management run on AWS Lambda with DynamoDB. The static frontend deploys to Cloudflare Pages. Agent installers are distributed via Cloudflare R2 behind the REST API.

## Getting started

### Prerequisites

- Node.js 22+
- Rust stable toolchain
- AWS CLI v2 (for backend deploy and local SAM)

### Setup

```bash
npm run setup
```

Edit `frontend/.env.local` and `infra/.env` with your Clerk and AWS values, then start the dev servers:

```bash
npm run dev:backend    # signaling API on :3001
npm run dev:frontend   # Vite dev server on :5173
```

### Build everything

```bash
npm run build
```

Individual targets:

```bash
npm run build:frontend
npm run build:infra
npm run build:agent
```

### Package the desktop agent (current host platform)

```bash
npm run package:agent
```

Installers are written to `desktop-agent/packaged/`.

### Tests

```bash
npm test
```

## Desktop agent downloads

Latest dev installers are served via the API Gateway REST endpoint after the dev stack is deployed.

| Platform | Latest installer |
|---|---|
| Linux x86_64 | `https://REPLACE_DEV_REST_URL/downloads/linux-x86_64` |
| Linux arm64 | `https://REPLACE_DEV_REST_URL/downloads/linux-aarch64` |
| macOS Intel | `https://REPLACE_DEV_REST_URL/downloads/macos-x86_64` |
| macOS Apple Silicon | `https://REPLACE_DEV_REST_URL/downloads/macos-aarch64` |
| Windows x86_64 | `https://REPLACE_DEV_REST_URL/downloads/windows-x86_64` |

Manifest: `https://REPLACE_DEV_REST_URL/updates/manifest.json`

Replace `REPLACE_DEV_REST_URL` with the `RestEndpoint` CDK output from `TabbyRDPDev` after first deploy.

## Project scripts

| Command | Description |
|---|---|
| `npm run setup` | One-time local dev environment setup |
| `npm run dev:frontend` | Start Vite dev server |
| `npm run dev:backend` | Start local signaling via SAM |
| `npm run build` | Build frontend, infra, and agent |
| `npm run package:agent` | Build release binary and package installer for this host |
| `npm run test` | Run frontend typecheck, infra Jest tests, and agent cargo tests |
| `npm run cdk:synth` | Synthesize dev CDK stack |
| `npm run cdk:deploy:dev` | Deploy dev stack |
| `npm run cdk:deploy:prod` | Deploy prod stack |

## License

MIT
