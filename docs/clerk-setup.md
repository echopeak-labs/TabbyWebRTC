# Clerk setup for TabbyWebRTC

Mobile auth uses Clerk. Desktop streaming does not. You need three values from one Clerk application:

| Value | Used by | Env var |
|---|---|---|
| Publishable key (`pk_test_…` / `pk_live_…`) | Frontend (mobile) | `CLERK_PUBLISHABLE_KEY` → `VITE_CLERK_PUBLISHABLE_KEY` |
| Frontend API URL / Issuer (`https://….clerk.accounts.dev`) | testServer + Lambda | `CLERK_ISSUER` |
| JWKS URL (`https://….clerk.accounts.dev/.well-known/jwks.json`) | testServer + Lambda | `CLERK_JWKS_URL` |

---

## 1. Create the Clerk application

1. Sign up / sign in at [https://dashboard.clerk.com](https://dashboard.clerk.com).
2. Create an application (e.g. `TabbyWebRTC`). Leave it on the default **Development** instance for local work.
3. Pick at least one sign-in method (Email + password or Email code is enough for local dev).
4. Open **API Keys** and copy the **Publishable key** (`pk_test_…`).
5. Note the Frontend API URL from the same page (host ends in `clerk.accounts.dev` in development). That URL is `CLERK_ISSUER`.
6. JWKS is always: `{CLERK_ISSUER}/.well-known/jwks.json`.

Example for a development instance:

```text
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_ISSUER=https://your-app-xx.clerk.accounts.dev
CLERK_JWKS_URL=https://your-app-xx.clerk.accounts.dev/.well-known/jwks.json
```

---

## 2. Local usage (official Clerk model)

Use a **Development** instance (`pk_test_…`). Clerk designs these for local auth; you do **not** configure a dashboard “allowed origins” list for localhost.

Per Clerk docs:

- [Instances / Environments](https://clerk.com/docs/guides/development/managing-environments) — development instances use a relaxed posture and URL-based session syncing (`__clerk_db_jwt`) between your app (e.g. `localhost`) and Clerk’s `*.accounts.dev` Frontend API. Cookies alone cannot bridge that cross-site gap in dev.
- [React (Vite) quickstart](https://clerk.com/docs/react/getting-started/quickstart) — set `VITE_CLERK_PUBLISHABLE_KEY`, wrap with `ClerkProvider`, open `http://localhost:5173`. No domain allowlist step.
- [Using production keys locally](https://clerk.com/docs/guides/development/troubleshooting/using-production-keys-in-development) — **`pk_live_` does not work on localhost.** Production enforces origin validation against your configured production domain. Do not use live keys for `yarn dev` / phone-on-LAN testing.

### What you need for this repo

1. Stay on the **Development** instance while developing.
2. Put the publishable key in env (next section). Vite is already started with `--host 0.0.0.0` so phones can reach it.
3. On a phone (same Wi‑Fi), open `http://<LAN-IP>:5173` — same `pk_test_` key; development session syncing applies to that origin the same way as localhost.
4. Keep `CLERK_ISSUER` / `CLERK_JWKS_URL` on the **same** development Frontend API host as the publishable key.

### Not required for TabbyWebRTC local mobile

| Clerk feature | When it matters | This project |
|---|---|---|
| Dashboard production domain / origin validation | Production (`pk_live_`) | Skip for local |
| `allowedRedirectOrigins` on `ClerkProvider` | Satellite / multi-domain redirects | Single mobile origin; not needed |
| `authorizedParties` on backend JWT verify | Stricter `azp` checks | testServer/Lambda verify issuer + JWKS only today |

If you ever need production keys on a machine, follow Clerk’s guide: map a subdomain of the production domain to `127.0.0.1`, serve **HTTPS on port 443**, and use that hostname — not `localhost` and not a raw LAN IP.

---

## 3. Wire local development (`yarn dev`)

### Frontend

Vite loads `components/frontend/.env` (and `.env.local` if present) via `envDir` in `vite.config.ts`.

```bash
cp components/frontend/.env.example components/frontend/.env
```

Set:

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

Optional override: export `CLERK_PUBLISHABLE_KEY` in the shell; `dev-frontend-local.sh` maps it to `VITE_CLERK_PUBLISHABLE_KEY` only when non-empty (so an empty shell var does not wipe `.env`).

`yarn dev` still overrides `VITE_WS_URL` / `VITE_REST_URL` with the detected LAN IP so phones can reach the test server.

Missing key: mobile shows “Mobile auth is not configured” instead of crashing.

### testServer

```bash
cp components/testServer/.env.example components/testServer/.env
```

Set real values:

```env
CLERK_JWKS_URL=https://your-app-xx.clerk.accounts.dev/.well-known/jwks.json
CLERK_ISSUER=https://your-app-xx.clerk.accounts.dev
TABBYWEBRTC_JWT_SECRET=dev-secret-change-in-prod
```

Nest `ConfigModule` loads this file. Pairing and approve (`POST /agents/pair`, `POST /auth/approve`) verify the Clerk JWT against JWKS + issuer.

---

## 4. Smoke-test the mobile path

1. `yarn dev`
2. On a phone (same Wi‑Fi), open `http://<LAN-IP>:5173`
3. Sign in via Clerk
4. You should land on `/agents`
5. Pair / approve flows send `Authorization: Bearer <clerkJwt>` to the testServer

If approve/pair returns 401 `INVALID_CLERK_JWT`, issuer or JWKS does not match the application that issued the publishable key.

---

## 5. AWS / production (optional)

Create `components/infra/.env` before `yarn cdk:deploy:dev` / `scripts/deploy-dev.sh`:

```env
CLERK_JWKS_URL=https://your-app-xx.clerk.accounts.dev/.well-known/jwks.json
CLERK_ISSUER=https://your-app-xx.clerk.accounts.dev
TABBYWEBRTC_JWT_SECRET=...
TURN_SECRET=...
TURN_URLS=...
ACM_CERTIFICATE_ARN=...
```

GitHub Actions expects secrets:

- `CLERK_PUBLISHABLE_KEY` → frontend build (`VITE_CLERK_PUBLISHABLE_KEY`)
- `CLERK_JWKS_URL`
- `CLERK_ISSUER`

For production, create/switch to a Clerk **production** instance (`pk_live_…` and the production Frontend API host), set the production domain in the Clerk Dashboard, and point infra/GitHub secrets at that instance’s issuer + JWKS. See [Deploy to production](https://clerk.com/docs/guides/development/deployment/production).

---

## What is already integrated (no extra Clerk SDK work)

- Mobile: `@clerk/clerk-react` in `MobileRouter` / sign-in / scan / approve / agents
- Paired agents stored in Clerk `unsafeMetadata.pairedAgents` via `clerk-client.ts`
- Backend: `jose` remote JWKS verify in `testServer` and `infra/lambda`
- Desktop viewer: no Clerk; uses TabbyWebRTC JWT after mobile approve

---

## Checklist

- [ ] Clerk **Development** app created (`pk_test_…`)
- [ ] Publishable key, issuer, JWKS copied (same instance)
- [ ] `VITE_CLERK_PUBLISHABLE_KEY` in `components/frontend/.env` (or `CLERK_PUBLISHABLE_KEY` in shell)
- [ ] `components/testServer/.env` has matching `CLERK_ISSUER` + `CLERK_JWKS_URL`
- [ ] Sign-in works on `http://localhost:5173`
- [ ] Phone can sign in at `http://<LAN-IP>:5173`
- [ ] (Prod) separate production instance + infra `.env` / GitHub secrets
