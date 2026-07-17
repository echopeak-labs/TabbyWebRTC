# Desktop Agent — Auto-Update SDD

## Scope

Defines the background auto-update system for the TabbyWebRTC desktop agent: periodic manifest polling, SHA-256 checksum validation, silent native installer execution, and process restart on macOS, Windows, and Linux.

---

## Update Server Contract

The agent consumes the API defined in `backend/05-update-distribution.md`:

| Request | Purpose |
|---|---|
| `GET {base_url}/updates/manifest.json` | Fetch latest version and artifact metadata |
| `GET {base_url}/downloads/{platform}` | Download the native installer for this machine |

`base_url` is the REST API root for the target environment (dev or prod stack). No direct R2 URLs are used.

---

## Configuration

Add to `desktop-agent/agent/src/config.rs`:

```toml
[updates]
enabled = true
base_url = "https://xxxxxxxx.execute-api.us-east-1.amazonaws.com/dev/"
channel = "dev"
```

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | bool | `true` | Master switch; when `false`, no update network activity |
| `base_url` | string | build-time env | REST API root URL for the update endpoints |
| `channel` | string | `"dev"` | Informational label (`dev` \| `prod`); must match the stack that owns `base_url` |

**Build-time default:** CI sets `TABBYWEBRTC_UPDATE_BASE_URL` when compiling release binaries. If unset at build time, the default in generated config TOML uses a placeholder that must be edited before auto-update works.

```rust
pub struct UpdatesSection {
    pub enabled: bool,
    #[serde(default = "default_update_base_url")]
    pub base_url: String,
    #[serde(default = "default_update_channel")]
    pub channel: String,
}

fn default_update_base_url() -> String {
    option_env!("TABBYWEBRTC_UPDATE_BASE_URL")
        .unwrap_or("https://REPLACE_DEV_REST_URL/")
        .to_string()
}
```

---

## Platform Key Detection

Map runtime OS/arch to manifest platform keys (must match CI matrix and backend/05):

```rust
pub fn platform_key() -> &'static str {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "linux-x86_64";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "linux-aarch64";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "macos-x86_64";
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "macos-aarch64";
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "windows-x86_64";
    #[cfg(not(any(/* all above */)))]
    compile_error!("unsupported platform for auto-update");
}
```

---

## Module Layout

```
desktop-agent/agent/src/
  updater.rs       # UpdateLoop, manifest fetch, download, verify, install, restart
  config.rs        # UpdatesSection added here
  agent.rs         # spawn UpdateLoop after startup
```

Add workspace dependencies to `desktop-agent/agent/Cargo.toml`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json", "stream"] }
semver = "1"
```

Reuse existing workspace crates: `sha2`, `rand`, `serde`, `serde_json`, `tokio`, `tracing`, `anyhow`.

---

## UpdateLoop

Spawn as a Tokio task from `agent.rs` after successful startup (post-pairing, alongside heartbeat). Do not run during first-run pairing flow.

```rust
pub async fn run_update_loop(
    config: UpdatesSection,
    idle_check: Arc<dyn Fn() -> bool + Send + Sync>,
) { ... }
```

`idle_check` returns `true` when no active WebRTC peer connections exist (query `StreamRegistry` subscriber counts via a callback wired in `agent.rs`).

### Loop timing

Before each manifest check, sleep a random duration:

```rust
let secs = rand::thread_rng().gen_range(7200..=14400); // 2–4 hours inclusive
tokio::time::sleep(Duration::from_secs(secs)).await;
```

First check also waits the random interval (no immediate check on startup).

### Check sequence

1. Skip if `config.enabled == false`.
2. `GET {base_url}/updates/manifest.json` with 30 s timeout.
3. Parse manifest JSON; extract `artifacts[platform_key()]`.
4. Compare `semver::Version::parse(&manifest.version)` against `semver::Version::parse(env!("CARGO_PKG_VERSION"))`.
5. If remote <= local, log at debug and return to sleep.
6. If remote > local and peers are active (`!idle_check()`), log info "update deferred, streams active" and return to sleep.
7. Download installer to temp directory:
   - Linux/macOS: `{std::env::temp_dir()}/tabbywebrtc-update/{filename}`
   - Windows: `%TEMP%\tabbywebrtc-update\{filename}`
8. Stream download from `GET {base_url}/downloads/{platform}`; log byte progress at info every 10 MB.
9. Verify SHA-256 of downloaded file matches `artifacts[platform].sha256` (lowercase hex). On mismatch: delete file, log error, abort.
10. Run silent install (see below).
11. Restart agent process.

---

## Silent Install

| OS | Command | Notes |
|---|---|---|
| Linux | `dpkg -i {path}` | Requires agent installed via `.deb` with root/service privileges |
| Windows | `msiexec /i "{path}" /quiet /norestart` | Spawns detached; current process exits after launch |
| macOS | `installer -pkg "{path}" -target /` | Requires root; typically run as LaunchDaemon service |

All install commands run via `tokio::process::Command`. Check exit status; log stderr on failure.

**Linux/macOS requirement:** Auto-update only works when the agent was installed via the native package (system install). Running the raw binary from a user directory is unsupported for auto-update.

---

## Process Restart

| OS | Strategy |
|---|---|
| Linux | `systemctl restart tabbywebrtc-agent` if systemd unit exists; else `exec()` replacement of current binary path |
| macOS | `launchctl kickstart -k system/com.tabbywebrtc.agent` if LaunchDaemon registered; else `exec()` |
| Windows | Spawn `cmd /C timeout /t 2 && net start TabbyWebRTCAgent` helper; exit current process |

Log "update applied, restarting" at info before exit.

---

## Threading Model Addition

Add to the threading diagram in `01-overview.md`:

```
├── Task: UpdateLoop              — polls manifest every 2–4 h; downloads and applies updates when idle
```

Insert into startup sequence after step 11 (Start HeartbeatLoop):

```
12. Start UpdateLoop (if updates.enabled).
13. Enter main event loop ...
```

---

## Amendments to `01-overview.md`

### Out of scope — revise

Remove the blanket rule "Write files outside its config directory." Replace with:

> The agent must not write persistent files outside its config directory, except:
> - Temporary installer downloads in the OS temp directory during auto-update.
> - Delegated system package installation via the platform package manager (requires system install).

### Binary overview — note

Add: "When installed via native package, the agent auto-updates silently every 2–4 hours."

---

## Error Handling

| Condition | Behavior |
|---|---|
| Network failure fetching manifest | Log warning, sleep next interval |
| Manifest parse error | Log error, sleep next interval |
| Download interrupted | Delete partial file, log error, sleep next interval |
| Checksum mismatch | Delete file, log error, do not install |
| Install command failure | Log error with stderr, do not restart |
| Unknown platform | Compile-time error; no runtime path |

Never panic the agent on update failure. The main streaming loop continues unaffected.

---

## Security

- All downloads go through API Gateway (TLS). No unsigned HTTP.
- SHA-256 verification is mandatory before any install command runs.
- No auto-update when `updates.enabled = false`.
- Manifest version must be strictly greater than embedded version (no downgrade via manifest).

---

## Dependencies

- `desktop-agent/01-overview.md` — config, agent run loop, startup sequence.
- `backend/05-update-distribution.md` — manifest schema and endpoint contract.
- `cicd/03-agent-release-distribution.md` — published installers in R2 (E2E blocked until first release).

---

## Acceptance Criteria

1. Agent at `0.1.0` with manifest at `0.2.0` downloads installer, verifies checksum, installs, and restarts.
2. Corrupted download (tampered bytes) fails checksum verification and does not install.
3. Update is deferred while at least one WebRTC stream is active; applies on the next interval after streams close.
4. `updates.enabled = false` produces zero outbound requests to update endpoints.
5. Random interval falls within 7200–14400 s (verified in unit test with injected RNG or mocked sleep).
6. Integration test with mock HTTP server returns fake manifest and artifact; checksum path verified without real install.

---

## Out of Scope

- Delta/incremental updates.
- Rollback to a previous version.
- User-facing update notifications or GUI.
- Auto-update for dev binary runs (non-package install).
- Code signing validation on the client (platform trust chain handles signed packages).
