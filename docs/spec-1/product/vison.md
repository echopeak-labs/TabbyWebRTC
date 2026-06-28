# Product vision / primary goal

Create a webapp and desktop app in which allows capturing displays framebuffers
and per-app framebuffers and allows them to be rendered via a browser tabs via
webrtc.

It is critical that the infra is cost effective as much as possible! Ideally
free.

Use this as more of the product vision: docs/spec/idea-summery.md

## High-level requirements

- Use rust as the backend service, the RDP service/server.
- Support Windows, macOS and Linux. Prioritize linux.
- Create a front-end webapp to allow the user to connect to a display and/or a
  speicifc application.
- Create a CI/CD pipeline to deploy the backend infra / CDK stack
- Create AWS CDK stack and nessasary cloudflare scripts to make this project
  work
- Implement user freindly authentication using mobile device as the key. See
  docs/spec/secuirty-and-auth.md
- Implement the functionally of authenticated sessions, see
  docs/spec/ephemeral-session.md
- Add the ability to send a thumbnail screenshot of each display to the UI once
  during connection/auth and every 5 mins as long as the auth session is active.
- Display resolution and aspect ratio should be replicated / updated when the UI
  is asking the backend to stream the given display. Lets tab user has Tab 1.
  For simplicity sake, it makes sense to stream the display at native
  aspect/resulution and on the UI side, add CSS and JS logic to deal with the UI
  containment and mouse callibration math.
- Implement near-native mouse and keyboard expirence. See
  docs/spec/starting-spec.md

## Out of scope

- The desktop agent should not adjust the display settings in any way

## Unkowns and Edge cases

- What happens if the user has Tab 1 open and is activly streaming/viewing
  display #1 and opens a new tab and tries to stream/view display #1? It makes
  sense that logic is needed to gray out a display or app when they are in use
  in another tab. IN other words, only 1 display/app framebuffer can be rendered
  per tab.
- Display resolution / aspect ratio mismatch and mouse calerbration. What if
  Display #1 is a widescreen 4k display and the user is trying to view it in a
  tab on a monitor that is 16:9 1080P? And vice versa?

## Components

There are 4 major components to this project. Each of these components being a
seperate folder

### Desktop agent

- This is a rust app and designed to ran as a stand alone app
- This app will need to be able to stream N number of displays to N number of
  browser tabs
- Keyboard, mouse inputs should be received from the UI in order to repeat the
  event
- Create a system in which to process events like:
  - commands (open process manager)
  - keyboard events
  - mouse events

### Front-end

#### Tech stack

React, typescript, tailwindcss, shadcn, shadcn/react. react-motion,
react-router.

##### UI & feel

Theme is Onynx and Amber. UI is user-freindly & sleek

#### Goals

- This is a simple webapp that allows the user to connect to the agent to stream
  the display.
- The landing page will need to include a "Connect" section and above it, locall
  connections via network.
- Create a launchpad UI in which is rendered once authenticated. This UI will
  show a 2 column layout with displays as thumnails on the left and a scrollable
  list on the right. Each display thumnail will be a card with the name of the
  display (Display #1, Display #2, etc) acording to the ordering to the host.
  The thumbnail is retrieved once during the authentication and once every 5
  mins.
- Keyboard, mouse inputs should be sent to the backend agent for processing
- Add a control bar in which to execute commands/shortcuts like:
  - Open Process manager (equivlent to ctl+alt+del).
  - Power Options (sleep, restart, shutdown)
  - Past to clipboard (takes clipboard content and sends it to the backend agent
    for processing)

### Backend & infra

- Use AWS & AWS CDK

### CI/CD, scripts

- use GH actions
