# Vention Pendulum

A distributed pendulum simulation. Each pendulum runs as its own Node.js server, and a React web UI shows and controls them.

## Running a pendulum node

```sh
cd nodes
npm install
npm start [-- --x <number> --length <number> --mass <number> --angle <number>]
```

Each node binds to the first free port starting at `7700`.

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

## Running the web UI

```sh
cd web
npm install
npm run dev
```

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
