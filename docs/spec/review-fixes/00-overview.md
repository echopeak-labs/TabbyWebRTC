# Review Fixes — Overview

## Scope

Remediation specs for gaps, security issues, and flawed logic found when
reviewing `docs/spec` against the implementation in `components/frontend`,
`components/infra`, and `components/desktop-agent`.

Source review: 2026-07-10. Finding IDs are stable across this folder and must be
referenced in PRs and `tasks.md`.

---

## Severity Key

| Severity   | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `critical` | Blocks end-to-end session or allows unauthenticated remote control  |
| `high`     | Major security hole or feature gap that breaks WAN / production use |
| `medium`   | Incomplete hardening, incomplete feature, or incorrect behavior     |
| `low`      | Defense-in-depth or polish                                          |

| Kind       | Meaning                                         |
| ---------- | ----------------------------------------------- |
| `security` | Vulnerability or missing auth/integrity control |
| `logic`    | Implemented but wrong / broken flow             |
| `gap`      | Specced or expected but missing                 |

---

## Finding Index

| ID     | Domain        | Sev      | Kind     | Title                                             | Spec                  |
| ------ | ------------- | -------- | -------- | ------------------------------------------------- | --------------------- |
| FE-01  | Frontend      | critical | logic    | Auth WS torn down before streaming                | `01-frontend.md`      |
| FE-02  | Frontend      | high     | gap      | `REQUEST_SOURCES` has no backend handler          | `01-frontend.md`      |
| FE-03  | Frontend      | high     | gap      | No JWT refresh or 401 session clear               | `01-frontend.md`      |
| FE-04  | Frontend      | medium   | logic    | Agent switch leaves stale agent-scoped JWT        | `01-frontend.md`      |
| FE-05  | Frontend      | medium   | logic    | Bitrate cap UI is a no-op                         | `01-frontend.md`      |
| FE-06  | Frontend      | low      | security | No CSP / security headers on SPA                  | `01-frontend.md`      |
| FE-07  | Frontend      | low      | gap      | Local network connect modal is a stub             | `01-frontend.md`      |
| INF-01 | Infra         | critical | security | `SDP_OFFER` is unauthenticated                    | `02-infra.md`         |
| INF-02 | Infra         | critical | security | `AGENT_REGISTER` ignores JWT-bound agentId        | `02-infra.md`         |
| INF-03 | Infra         | high     | security | Pending session expiry not enforced               | `02-infra.md`         |
| INF-04 | Infra         | high     | security | 365-day agent JWT with no revocation              | `02-infra.md`         |
| INF-05 | Infra         | high     | security | Open CORS + no rate limits on REST                | `02-infra.md`         |
| INF-06 | Infra         | medium   | security | `UNSUBSCRIBE` and ICE paths under-authenticated   | `02-infra.md`         |
| INF-07 | Infra         | medium   | security | Update downloads fully public                     | `02-infra.md`         |
| INF-08 | Infra         | medium   | gap      | Secrets in Lambda env, not Secrets Manager        | `02-infra.md`         |
| INF-09 | Infra         | low      | gap      | No `SESSION_EXPIRED` from production Lambda       | `02-infra.md`         |
| DA-01  | Desktop Agent | critical | logic    | Pairing JWT never reaches the agent               | `03-desktop-agent.md` |
| DA-02  | Desktop Agent | high     | security | Local HTTP server is open on LAN                  | `03-desktop-agent.md` |
| DA-03  | Desktop Agent | high     | security | Full input + power commands with no agent consent | `03-desktop-agent.md` |
| DA-04  | Desktop Agent | high     | gap      | Auto-update client not started                    | `03-desktop-agent.md` |
| DA-05  | Desktop Agent | medium   | gap      | Ed25519 pairing crypto unused end-to-end          | `03-desktop-agent.md` |
| DA-06  | Desktop Agent | medium   | gap      | Default release builds lack real capture          | `03-desktop-agent.md` |
| DA-07  | Desktop Agent | medium   | gap      | Agent has no TURN credentials                     | `03-desktop-agent.md` |
| DA-08  | Desktop Agent | low      | logic    | Pairing `POST /pair` accepts any LAN client       | `03-desktop-agent.md` |

---

## Priority Fix Order

1. **FE-01** — Keep auth WebSocket alive / re-bind session token on reconnect
2. **DA-01** — Deliver `agentJwt` to agent `POST /pair` after mobile pair
3. **INF-01 / INF-02** — Auth `SDP_OFFER`; bind `AGENT_REGISTER` to JWT `sub`
4. **FE-02** — Implement `REQUEST_SOURCES` (or push sources on register)
5. **INF-03 / DA-02** — Enforce pending expiry; auth local LAN routes

---

## Domain Specs

| File                  | Domain                                   |
| --------------------- | ---------------------------------------- |
| `01-frontend.md`      | Frontend remediation requirements        |
| `02-infra.md`         | Infra / backend remediation requirements |
| `03-desktop-agent.md` | Desktop agent remediation requirements   |
| `tasks.md`            | Checklist of all fix tasks               |

---

## Cross-Domain Dependencies

```
FE-01 (auth WS) ──► FE-02 (sources over signaling)
DA-01 (pairing delivery) ──► agent online ──► FE-02 / streaming
INF-01 + INF-02 ──► safe signaling before WAN E2E
DA-05 (encryptedSalt) ──► INF auth approve body + agent verify
DA-04 (updater) ──► backend/05 + cicd/03 (already review)
DA-07 (agent TURN) ──► backend/04 GET /turn-credentials
```

---

## Out of Scope for This Folder

- New product features not identified in the review
- Changing the overall auth model (Clerk mobile key + ephemeral desktop JWT)
- Code signing / notarization decisions already deferred in `agents.md` blockers
