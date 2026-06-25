To secure a remote desktop solution—especially when accessing it from a public
untrusted computer like a library—traditional username/password authentication
is actually a major security risk. Public computers are highly susceptible to
keyloggers, session hijacking, and shoulder surfing.

The absolute best combination of **uncompromising security** and **frictionless
user friendliness** is the **Mobile Phone QR Gateway (Passwordless
Mobile-as-a-Key)**, matching exactly how modern secure applications like
WhatsApp Web, Discord, and Telegram handle browser-based authentication.

Here is the deep dive into how to architect this, how the library edge case
behaves, and how to build it directly into your existing $0 AWS serverless
framework.

---

### The Library Edge Case: Step-by-Step Workflow

When User 1 sits down at a public library computer, they should **never have to
type a password, an email, or a 2FA SMS code.** #### Step 1: The Public Web App
Initiation User 1 opens your public web app URL (`rdp.yourdomain.com`) on the
library PC. Instead of an empty login form, the page instantly establishes a
temporary WebSocket connection to your AWS API Gateway. The serverless backend
generates a short-lived, cryptographically secure `PendingSessionID` and sends
it to the library browser. The browser renders this as a **dynamic QR Code**
that refreshes every 30 seconds.

#### Step 2: Mobile Authorization (The Phone as a Key)

User 1 pulls out their mobile phone and opens your web app (where they are
permanently logged in on their personal device) or a dedicated progressive web
app (PWA).

1. The user taps "Scan to Connect" and points their phone camera at the library
   screen.
2. The phone reads the `PendingSessionID` from the QR code.
3. The phone prompts the user for local biometrics (FaceID or TouchID).

#### Step 3: Device Selection and Handshake

Once biometrics pass, the phone sends a secure, authenticated HTTPS POST request
to your AWS Lambda backend saying: _"I am User 1, and I explicitly authorize the
library's `PendingSessionID` to access my account."_

On the phone screen, a list of User 1’s active home agents appears (e.g., "Home
Desktop", "Home Lab Server"). User 1 taps **"Home Desktop"**.

#### Step 4: P2P Tunnel Establishment

The AWS signaling server matches the library PC's open WebSocket with the
authorized session.

1. The signaling server pings the **Home Desktop Agent** via its persistent
   WebSocket connection.
2. The Home Agent and the Library PC begin exchanging WebRTC SDP configuration
   profiles (ICE candidates) over the WebSocket channel.
3. A direct peer-to-peer, end-to-end encrypted (DTLS-SRTP) WebRTC pipeline opens
   between the library PC and the home computer. The library tab immediately
   starts rendering the desktop stream.

---

### Is it possible to do a One-Time Setup on the Home Computer?

Yes, and it is highly recommended to protect against **Man-in-the-Middle (MitM)
attacks**.

If an attacker somehow compromises your AWS signaling server, they could
theoretically swap the WebRTC SDP packets during the handshake and redirect the
library PC's connection to a malicious proxy. To prevent this, you can implement
a one-time local pairing setup:

1. **The Pairing Phase:** When first installing the Desktop Agent on the home
   computer, it generates a unique cryptographic keypair (Ed25519 or RSA). It
   displays a setup QR code on the monitor. The user scans it once with their
   phone. The phone now permanently stores the **Home Agent's Public Key**.
2. **The Verification Phase:** In the library edge case, when the phone approves
   the session, it grabs the Home Agent's public key from its local storage,
   encrypts a one-time random secret token (a "Session Salt"), and sends it up
   through the signaling channel. Only the genuine Home Agent can decrypt this
   token using its private key. The library PC and the Home Agent use this
   decrypted token to authenticate each other directly inside the WebRTC Data
   Channel before allowing any mouse/keyboard controls to execute.

---

### Implementation Tech Stack for Auth ($0 Infra Compliant)

To implement this without breaking your $0 budget, you can use these
developer-friendly tools:

#### 1. Authentication Provider (The Identity Layer)

Don't build user accounts, password resets, and session tokens from scratch. Use
**Clerk** or **Auth0**.

- **Why:** Both offer incredibly robust **Free Tiers** (Clerk allows up to
  10,000 monthly active users for free).
- **How it fits:** Your mobile web app integrates with Clerk. When the phone
  scans the QR code, it passes Clerk’s secure JWT (Json Web Token) to your AWS
  Lambda endpoint to securely prove the user's identity.

#### 2. QR Generation & WebSocket Routing (The Signaling Layer)

- **Library Client:** Uses a simple frontend JavaScript library like
  `qrcode.react` to render the dynamic QR code containing the WebSocket URL and
  `PendingSessionID`.
- **AWS API Gateway (WebSockets):** When the phone authorizes the session, a
  Lambda function executes an AWS API Gateway Management API call
  (`@connections/send-to-connection`) targeting the library PC's unique
  connection handle, instantly triggering the login state transition without
  long-polling.

### Summary of Why This Wins

- **Highest User Friendliness:** The user approaches any public terminal, points
  their phone, blinks for FaceID, and they are controlling their home PC in
  under 5 seconds. No passwords typed, no credentials left behind in the library
  browser's history or cookies.
- **Highest Security:** Phishing-resistant. Even if someone stands behind the
  user and takes a picture of the QR code, it is useless without the
  biometric-backed phone authorization layer.
- **Cost-Efficient:** It relies purely on client-side cryptography, standard
  browser camera APIs, and temporary serverless WebSocket triggers—keeping your
  cloud infrastructure completely within the $0 free tiers.
