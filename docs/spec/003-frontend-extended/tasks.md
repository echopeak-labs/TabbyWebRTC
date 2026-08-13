# Spec 003-frontend-extended — Agent Task Lists

Each section below corresponds to a spec file in
`docs/spec/003-frontend-extended/`. Tasks are ordered for sequential execution
within a spec. Check `agents.md` waves before starting.

Use `[ ]` / `[x]` to track individual task completion. No work is marked done
at spec creation.

---

## frontend/01-role-gate.md

- [ ] Add `ProductRole` type and `roleStore` (`host` \| `guest`) persisted to
      `localStorage` key `tabbywebrtc.productRole`
- [ ] Build fullscreen two-card `RoleGate` (Host / Guest) using Onyx/Amber
      shadcn cards; Guest is default focus
- [ ] Show `RoleGate` on desktop `/` only when unauthenticated and role unset
- [ ] Skip gate for `mobile-key` and for desktop sessions that already have a
      JWT (`DesktopAuthBootstrap` → launchpad)
- [ ] Guest choice renders existing `ConnectPage` (QR + LAN) unchanged
- [ ] Host choice leaves `/` ready for `HostSetupPage` (placeholder ok until
      `02`)
- [ ] Add “Change role” control that clears `productRole` and re-shows the gate
- [ ] Keyboard: Tab between cards, Enter/Space activates
- [ ] Copy: guests install nothing; host is the machine that runs the agent

---

## frontend/02-host-setup.md

- [ ] Add `HostSetupPage` rendered when `productRole === 'host'`
- [ ] Build `{VITE_REST_URL}/downloads/{platform}` links for all five platform
      keys; normalize trailing slash
- [ ] Use `<a href>` (or equivalent navigation), not `fetch` of installer bytes
- [ ] Highlight recommended platform from UA / `userAgentData`
- [ ] Optionally load `GET /updates/manifest.json` for version + sha256 labels
- [ ] If `VITE_REST_URL` is missing/placeholder, disable buttons and tell
      self-hosters to set RestEndpoint
- [ ] Write install + pair + “then continue as guest” steps (Linux deb, macOS
      pkg, Windows per-user MSI, no service)
- [ ] Wire “Continue as guest” and “Change role”
- [ ] Do not link to raw R2/S3 URLs
