# Frontend — Host Setup & Agent Downloads SDD

## Scope

Host-role page: download the desktop agent via existing REST download
endpoints, plus setup/pairing instructions. Depends on `01-role-gate.md`.

Download contract: `001-init/backend/05-update-distribution.md` and
`002-win32-support/backend/01-windows-downloads.md`. The SPA must **not**
link to raw R2/S3 object URLs.

---

## Page

Rendered at `/` when `productRole === 'host'` and the user is not
authenticated.

Layout (Onyx/Amber, full viewport, scrollable):

1. Title: “Set up the host”
2. Short paragraph: this machine (or the PC you will install on) runs the
   desktop agent. Guests only open this webapp in a browser.
3. Recommended download highlighted from `navigator.userAgent` / `userAgentData`.
4. Full platform list as cards with a download button each.
5. Setup steps (install, pair, run).
6. Footer links: “I’m a guest” (sets role guest) and “Change role”.

---

## Download URLs

Base: `import.meta.env.VITE_REST_URL` (no trailing-slash assumption — normalize).

```
GET {VITE_REST_URL}/downloads/{platform}
GET {VITE_REST_URL}/updates/manifest.json   // optional labels
```

| Platform key | Label | Typical artifact |
|---|---|---|
| `linux-x86_64` | Linux x86_64 | `.deb` |
| `linux-aarch64` | Linux ARM64 | `.deb` |
| `macos-x86_64` | macOS Intel | `.pkg` |
| `macos-aarch64` | macOS Apple Silicon | `.pkg` |
| `windows-x86_64` | Windows 11 x64 | `.msi` |

Buttons are `<a href={url} rel="noopener">` (or `window.location.assign`) so
the browser follows redirects (presigned GET after W32-10). Do **not**
`fetch()` the installer into memory.

If `VITE_REST_URL` is missing or still a placeholder:

- Disable download buttons.
- Show: set `VITE_REST_URL` to the deployed `RestEndpoint` (this app is meant
  to be self-hosted after clone + CDK deploy).

Optional: `GET /updates/manifest.json` to show version + SHA-256 next to each
button. On fetch failure, still show buttons using the path table above.

---

## Setup Instructions (in-page)

Numbered steps, platform-aware when a recommended OS is detected; all platforms
remain visible.

1. Download the installer for the **host** OS (the machine whose screens will
   be captured).
2. Install:
   - Linux: install the `.deb` (`sudo dpkg -i …` or equivalent); binary
     `tabbywebrtc-agent`.
   - macOS: open the `.pkg`.
   - Windows: run the per-user `.msi` (no admin / no Windows service — 002).
3. Run the agent on that machine. First run prints pairing instructions if no
   JWT is in the OS keychain.
4. Pair with the **mobile key** (Clerk) using the agent pair URL / QR from 001
   (`POST /agents/pair` flow). Do not invent a new pairing protocol.
5. After the agent is online, click “Continue as guest” on this or another
   browser to scan the Connect QR and stream.

Do not instruct the user to install the agent on a viewer-only Mac/PC.

---

## Recommended Platform Heuristic

| Detection | Highlight |
|---|---|
| Windows | `windows-x86_64` |
| macOS + ARM | `macos-aarch64` |
| macOS + Intel | `macos-x86_64` |
| Linux + aarch64 | `linux-aarch64` |
| Linux other / unknown | `linux-x86_64` |

Unknown UA: highlight none; list all equally.

---

## Security

- Downloads are public (INF-07). Do not attach session JWTs to installer URLs.
- Do not execute or unpack the binary in the browser.
- Do not display raw bucket URLs or credentials.
- Windows copy must not tell users to install a service or run as SYSTEM.

---

## Acceptance Criteria

1. Host page lists all five platform download links under `{VITE_REST_URL}/downloads/…`.
2. Clicking a link starts a browser download (or follows 302) of the installer.
3. Recommended platform is visually distinct when UA is known.
4. Setup steps cover install + pair + then guest QR.
5. Missing REST URL fails closed (no broken S3 links).
6. “Continue as guest” / “Change role” work without reload loops.

---

## Out of Scope

- Authenticode / notarization copy beyond “unsigned builds may warn”.
- Changing Lambda/R2 (owned by 001/002).
- Auto-detecting a running local agent and skipping download (LAN probe stays
  on Guest `ConnectPage`).
