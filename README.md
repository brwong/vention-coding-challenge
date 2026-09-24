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

The node's terminal redraws a one-line status summary every second.

## Running the web UI

```sh
cd web
npm install
npm run dev
```
