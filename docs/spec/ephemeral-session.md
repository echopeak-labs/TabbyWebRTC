To achieve this exact userflow, standard browser storage mechanisms present a
conflict. LocalStorage and persistent cookies survive when all tabs are closed,
which violates your security rule. Conversely, SessionStorage is completely
isolated to a single tab, meaning a new tab opens up completely empty, violating
your user experience rule.

The optimal strategy to solve this is **Ephemeral Session Cloning via the
BroadcastChannel API paired with SessionStorage**.

This approach keeps the authentication token strictly inside the browser's
volatile memory. It allows active tabs to securely copy the session token to
newly opened tabs, but the moment the last remaining tab is closed, the data is
permanently wiped from the client machine.

---

### The Architecture: Step by Step

The BroadcastChannel API allows scripts from the same origin (`app.myapp.com`)
to send messages back and forth across different tabs or windows.

#### Phase 1: The First Tab Bootstrap

1. The user visits `app.myapp.com` for the first time.
2. The frontend initializes a BroadcastChannel instance named `auth_sync`.
3. Before rendering the UI, the tab sends out a message to the channel:
   `{ type: "REQUEST_AUTH_TOKEN" }`.
4. The tab waits for a brief window, around 100 to 200 milliseconds. Because no
   other tabs are open, the message goes unanswered.
5. The tab concludes it is the primary instance, displays the connect button,
   and triggers your QR/mobile authentication flow.
6. Once authenticated, the token is saved into this tab's **SessionStorage**.
   The user is redirected to the Launchpad UI.

#### Phase 2: Opening Subsequent Tabs

1. The user opens Tab 2 and navigates to `app.myapp.com`.
2. Tab 2 initializes the same `auth_sync` BroadcastChannel and immediately
   broadcasts: `{ type: "REQUEST_AUTH_TOKEN" }`.
3. Tab 1, which is running in the background, hears this request. It pulls the
   valid token from its own SessionStorage and broadcasts back:
   `{ type: "PROVIDE_AUTH_TOKEN", token: "xyz_secure_jwt" }`.
4. Tab 2 receives the token, writes it to its own **SessionStorage**, skips the
   login screen entirely, and renders the Launchpad UI instantly.
5. The user selects an app like Slack. Tab 2 uses the cloned token to
   authenticate its own unique WebRTC PeerConnection back to the Desktop Agent.

#### Phase 3: The Void Event (All Tabs Closed)

1. If the user closes Tab 1, Tab 2 still holds the token in its own
   SessionStorage lifecycle.
2. If the user opens Tab 3, Tab 2 will now be the one to supply the token via
   the broadcast channel.
3. If the user closes **all tabs**, every discrete instance of SessionStorage is
   instantly destroyed by the browser engine.
4. When the user opens a completely new tab later, the
   `{ type: "REQUEST_AUTH_TOKEN" }` broadcast goes unanswered. The user is
   safely presented with the initial login screen.

---

### The Frontend Implementation Blueprint

This concise JavaScript script handles the entire cross-tab orchestration
lifecycle at the entry point of your web app.

```javascript
// auth-sync.js - Place at the absolute top of your application entry point

const AUTH_CHANNEL_NAME = "auth_sync";
const tokenChannel = new BroadcastChannel(AUTH_CHANNEL_NAME);

function initializeAppAuth() {
  return new Promise((resolve) => {
    // Check if this specific tab already possesses the token
    let currentToken = sessionStorage.getItem("auth_token");

    if (currentToken) {
      // Token exists locally in this tab, proceed to Launchpad UI
      return resolve(currentToken);
    }

    // Set up a one-time listener to capture tokens from other active tabs
    const handleAuthResponse = (event) => {
      if (event.data && event.data.type === "PROVIDE_AUTH_TOKEN") {
        sessionStorage.setItem("auth_token", event.data.token);
        tokenChannel.removeEventListener("message", handleAuthResponse);
        clearTimeout(authTimeout);
        resolve(event.data.token);
      }
    };

    tokenChannel.addEventListener("message", handleAuthResponse);

    // Broadcast out to all other open tabs requesting the token
    tokenChannel.postMessage({ type: "REQUEST_AUTH_TOKEN" });

    // If no active tab responds within 150ms, assume this is the first tab
    const authTimeout = setTimeout(() => {
      tokenChannel.removeEventListener("message", handleAuthResponse);
      resolve(null); // Resolves to null, triggering the Login/Connect UI
    }, 150);
  });
}

// Background listener: Keeps running to service future tabs
tokenChannel.addEventListener("message", (event) => {
  if (!event.data) return;

  const storedToken = sessionStorage.getItem("auth_token");

  // If another tab wants a token and we have one, give it to them
  if (event.data.type === "REQUEST_AUTH_TOKEN" && storedToken) {
    tokenChannel.postMessage({
      type: "PROVIDE_AUTH_TOKEN",
      token: storedToken,
    });
  }
});

// App Initiation Hook
initializeAppAuth().then((token) => {
  if (token) {
    // Render Launchpad UI and allow user to spin up WebRTC tracks
    renderLaunchpad(token);
  } else {
    // Render Connect Button / QR Scanner Workflow
    renderConnectUI();
  }
});
```

---

### Key Architectural Advantages

- **No Server-Side State Required:** Your serverless AWS backend does not need
  to maintain complex session states or databases tracking open windows. The
  tabs coordinate state completely client-side.
- **Strict Privacy Isolation:** Because you are using SessionStorage, the token
  is never written to disk. It resides purely in volatile RAM, mitigating
  token-theft vulnerabilities on shared public workstations.
- **Granular WebRTC Control:** While the _auth token_ is shared across tabs, the
  actual _WebRTC PeerConnections_ remain isolated. Tab 1 handles the video track
  for Display 1, Tab 2 handles the standalone framebuffer for Slack, and Tab 3
  handles Display 2. Each tab initiates its own signaling handshake securely
  using the same cloned credential.
