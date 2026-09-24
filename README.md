# Vention Pendulum

A distributed pendulum simulation. Each pendulum runs as its own Node.js server, and a React web UI shows and controls them.

## Running a pendulum node

```sh
cd nodes
npm install
npm start [-- --x <number> --length <number> --mass <number> --angle <number>]
```

Each node binds to the first free port starting at `7700`.

## Running the web UI

```sh
cd web
npm install
npm run dev
```
