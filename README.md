# Vention Pendulum

A distributed pendulum simulation. Each pendulum runs as its own Node.js server, and a React web UI shows and controls them.

## Prerequisites

- Node.js (v18+) and npm
- A single host: nodes bind to `127.0.0.1` only, and node discovery is local-machine-only (see [Known limitations](#known-limitations))

## Installing and running

### Install dependencies

```sh
cd nodes && npm install
cd ../web && npm install
```

### Run a pendulum node

```sh
cd nodes
npm start [-- --x <number> --length <number> --mass <number> --angle <number>]
```

Each node binds to the first free port starting at `7700`.

### Run the web UI

```sh
cd web
npm run dev
```

It opens on Vite's default port (`5173`) and discovers running nodes by scanning `127.0.0.1:7700` upward.

### Run the full demo with one script

```sh
./scripts/start-demo.sh
```

Builds the nodes once, then starts five node processes and the web UI as background jobs of the script, printing the UI URL when they're up. `Ctrl+C` stops all of them. This is a convenience script for local development and manual testing, not a process manager: it's plain bash (`&`/`wait`/`trap`), with no `concurrently`, Docker, or Windows-specific equivalent.

### Example: driving a node with curl

Start a node with a long pendulum at 45°:

```sh
cd nodes
npm start -- --angle=45 --length=200
```

In another terminal, inspect it, start it, and change its configuration:

```sh
curl http://localhost:7700/status          # identity, pendulum state, config, lifecycle
curl -X POST http://localhost:7700/start   # start swinging
curl -X POST http://localhost:7700/pause   # freeze in place; /start resumes
curl -X POST http://localhost:7700/stop    # halt; /start swings again from the initial angle
curl http://localhost:7700/config
curl -X PUT http://localhost:7700/config \
  -H 'Content-Type: application/json' \
  -d '{"angle": 30, "mass": 35}'            # resets the pendulum to the new initial angle
```

The node's terminal redraws a one-line status summary (angle, bob position and lifecycle) twice a second, and prints protocol events (peers joining, leader elections, collisions, STOP and RESTART) on separate lines above it.

### Example: five pendulums that collide

Start five nodes, each in its own terminal and in this order, so they take ports `7700` to `7704` and hang 100 units apart:

```sh
cd nodes
npm start                                 # node-7700
npm start -- --length=80 --angle=50       # node-7701
npm start -- --angle=30                   # node-7702
npm start                                 # node-7703
npm start                                 # node-7704
```

The nodes find each other and elect `node-7704`, the highest ID, as leader. Start them all, either with **Start** in the web UI or with curl:

```sh
for port in 7700 7701 7702 7703 7704; do curl -s -X POST localhost:$port/start & done; wait
```

`node-7701` swings faster than its neighbours, and about 9 seconds later its bob hits `node-7702`'s. The leader then stops every node, collects RESTART from all of them, and 5 seconds later they all swing again from their initial angles. Because the setup is the same, the cycle repeats.

To watch a node's view of the cluster (term, leader, peers, RESTART barrier):

```sh
curl http://localhost:7700/protocol-status
```

Killing a node does not stop the others: its peers suspect it after 2 seconds of silence and drop it after 10. If it was the leader, the highest remaining node takes over.

## Architecture

The system has two kinds of process: **pendulum nodes** (Node.js/TypeScript/Express) and a **web UI** (React/Vite), each independently started as described above.

Each node owns exactly one pendulum's simulation and runs it at a fixed 60 Hz timestep, regardless of whether anything is watching. On startup a node claims the first free port from `7700` upward, derives its ID from that port (`node-7701`), and probes the lower ports to find existing peers. From that point on, nodes talk directly to each other over HTTP: they exchange heartbeats and positions, elect a leader once a term, and route collision reports through the leader, which alone issues STOP and RESTART. This is peer-to-peer membership with leader-coordinated lifecycle transitions, not a fully leaderless design or a separate coordinator service.

The web UI never simulates or coordinates anything itself. It discovers nodes by polling `127.0.0.1:7700` and upward over HTTP, then polls each discovered node's `/status` for state to render as SVG, and issues `/config`, `/start`, `/pause`, and `/stop` calls (individually or across all nodes) in response to user actions. It is a client/controller, and every configuration and lifecycle change is applied by calling the same REST endpoints a `curl` script would use.

Full contracts live in [`docs/interfaces.md`](docs/interfaces.md) (CLI, HTTP API, UI/discovery behavior) and [`docs/coordination.md`](docs/coordination.md) (membership, election, collision detection, STOP/RESTART). Motion and collision math are in [`docs/physics.md`](docs/physics.md).

## Physics model

Each pendulum is a simplified idealization, not a full rigid-body simulation:

- The rod is rigid and massless, and does not participate in collision detection — only the spherical bob does. Hinge points can't collide either.
- There's no friction, damping, or air resistance, so an undisturbed pendulum swings forever at constant amplitude. There's no wind (a possible future bonus goal, out of scope today).
- Motion uses the full nonlinear pendulum equation (`α = -(g/L)sin(θ)`), not a small-angle approximation.
- Bobs are spherical and share one unit density, so radius is derived from mass (`r = ∛(3m/4π)`) rather than set independently.
- Collisions are detected, not resolved: overlapping bobs trigger the STOP/RESTART protocol instead of bouncing or exchanging momentum.

Full details, including units and the fixed-timestep integrator, are in [`docs/physics.md`](docs/physics.md).

## Technical decisions and trade-offs

- **HTTP polling, not WebSockets.** Both node-to-node messaging and UI-to-node updates are plain JSON-over-HTTP requests on a fixed interval, per [`interfaces.md`](docs/interfaces.md). This keeps every interaction request/response and easy to test with `curl` or `supertest`, at the cost of update latency and steady request volume compared to a push-based transport.
- **Single host only.** Nodes bind to `127.0.0.1` and discovery is a local port scan; there is no `--peers` flag or multi-host membership. This matches the challenge's scope and avoids designing a discovery protocol the project doesn't need yet.
- **Latest-known-state collision detection.** Each node caches the most recent `POSITION` it has seen from each peer (by sequence number) and checks its own bob against that cache; there's no synchronized clock or interpolation between updates. This is simple and robust to message loss or reordering, at the cost of checking against slightly stale peer positions.
- **Peer geometry from `JOIN_RESPONSE`, not from every `POSITION`.** A node learns peer length/anchor once, at join time, and assumes it stays fixed for the session, rather than re-sending full config on every position broadcast. This keeps position messages small; a peer that changes its length or hinge mid-run will be checked against its old geometry until it rejoins.
- **Leader/lease/election for lifecycle, peer-to-peer for everything else.** Only STOP/RESTART decisions go through a leader; position sharing and collision detection are fully peer-to-peer and keep working even while an election is in progress.

## Known limitations

- Single-host operation only: all nodes and the UI must run on the same machine (`127.0.0.1`).
- Collision detection is an approximation based on each peer's latest known position, not a synchronized simulation step.
- The design supports any number of nodes (`N >= 2`) and isn't hard-coded to five, but the standard demo and multi-node tests use five.
- No persistence: node configuration and simulation state live in memory and reset when a node restarts.
- STOP/RESTART is routed through an elected leader with a quorum-based RESTART barrier, rather than the spec's literal wording of every node broadcasting STOP/RESTART directly and waiting for all peers; this trades strict spec wording for tolerance of a dead node during restart.

## Running the tests

Install dependencies in both `nodes` and `web` first, then from the repository root:

```sh
npm test                # all tests: node servers, then web UI
npm run test:nodes      # node server tests only
npm run test:web        # web UI tests only
npm run test:coverage   # all tests with coverage reports and minimum thresholds
```

For watch mode during development, run `npm run test:watch` inside `nodes` or `web`.

The node tests include multi-process coordination tests that start real nodes on ports `7700` and up, so stop any running nodes first. They take about 30 seconds, most of it waiting out the 10-second peer timeout.
