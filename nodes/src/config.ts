import http from "node:http";
import minimist from "minimist";
import {
  BASE_PORT,
  DEFAULT_ANGLE_DEG,
  DEFAULT_LENGTH,
  DEFAULT_MASS,
  HOST,
  MAX_ANGLE_DEG,
  MAX_PORT_SEARCH,
  MIN_ANGLE_DEG,
} from "./constants";

export interface Config {
  x?: number; // hinge x-coordinate (optional, assigned from join order if omitted)
  length: number; // pendulum length (default: DEFAULT_LENGTH)
  mass: number; // bob mass (default: DEFAULT_MASS)
  angle: number; // initial angle in degrees (default: DEFAULT_ANGLE_DEG)
  port: number; // auto-discovered, not user-configurable
  nodeId: string; // derived from port: `node-7701`
}

export type CliOptions = Omit<Config, "port" | "nodeId">;

export interface LoadedConfig {
  config: Config;
  // Already listening on `config.port`; attach request handlers to it rather
  // than binding again, so no other process can claim the port in between.
  server: http.Server;
}

export class ConfigError extends Error {}

export const USAGE = `Usage: npm start -- [options]

Starts a pendulum node on the first free port from ${BASE_PORT}.

Options:
  --x <number>       Hinge x-coordinate (default: assigned from join order)
  --length <number>  Pendulum length, > 0 (default: ${DEFAULT_LENGTH})
  --mass <number>    Bob mass, > 0 (default: ${DEFAULT_MASS})
  --angle <number>   Initial angle in degrees, ${MIN_ANGLE_DEG} to ${MAX_ANGLE_DEG} (default: ${DEFAULT_ANGLE_DEG})
  -h, --help         Show this help`;

const NUMERIC_FLAGS = ["x", "length", "mass", "angle"] as const;
const DECIMAL_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const NEGATIVE_NUMBER = /^-(\d|\.\d)/;

// minimist reads `--angle -20` as flag `--angle` plus short flags `-2 -0`,
// so rewrite it as `--angle=-20` first.
function joinNegativeValues(argv: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const isNumericFlag = NUMERIC_FLAGS.some((flag) => arg === `--${flag}`);
    if (isNumericFlag && next !== undefined && NEGATIVE_NUMBER.test(next)) {
      result.push(`${arg}=${next}`);
      i++;
    } else {
      result.push(arg);
    }
  }
  return result;
}

function parseNumber(flag: string, raw: unknown): number {
  if (Array.isArray(raw)) {
    throw new ConfigError(`--${flag} was given more than once`);
  }
  const text = String(raw).trim();
  if (!DECIMAL_NUMBER.test(text)) {
    throw new ConfigError(`--${flag} must be a number, got "${text}"`);
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new ConfigError(`--${flag} must be a finite number, got "${text}"`);
  }
  return value;
}

/** Parses and validates CLI flags. Returns null when `--help` was requested. */
export function parseCliArgs(argv: string[]): CliOptions | null {
  const args = minimist(joinNegativeValues(argv), {
    string: [...NUMERIC_FLAGS],
    boolean: ["help"],
    alias: { h: "help" },
  });

  if (args.help) return null;

  const known = new Set<string>(["_", "help", "h", ...NUMERIC_FLAGS]);
  const unknown = Object.keys(args).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    const names = unknown.map((key) => (key.length === 1 ? `-${key}` : `--${key}`));
    throw new ConfigError(`Unknown option(s): ${names.join(", ")}`);
  }
  if (args._.length > 0) {
    throw new ConfigError(`Unexpected argument(s): ${args._.join(" ")}`);
  }

  const read = (flag: (typeof NUMERIC_FLAGS)[number]) =>
    args[flag] === undefined ? undefined : parseNumber(flag, args[flag]);

  const x = read("x");
  const length = read("length") ?? DEFAULT_LENGTH;
  const mass = read("mass") ?? DEFAULT_MASS;
  const angle = read("angle") ?? DEFAULT_ANGLE_DEG;

  if (length <= 0) throw new ConfigError(`--length must be greater than 0, got ${length}`);
  if (mass <= 0) throw new ConfigError(`--mass must be greater than 0, got ${mass}`);
  if (angle < MIN_ANGLE_DEG || angle > MAX_ANGLE_DEG) {
    throw new ConfigError(
      `--angle must be between ${MIN_ANGLE_DEG} and ${MAX_ANGLE_DEG} degrees, got ${angle}`,
    );
  }

  return { x, length, mass, angle };
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}

/** Binds a new HTTP server to the first free port starting at BASE_PORT. */
export async function listenOnAvailablePort(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer();
  for (let port = BASE_PORT; port < BASE_PORT + MAX_PORT_SEARCH; port++) {
    try {
      await listen(server, port);
      return { server, port };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  throw new ConfigError(
    `No free port found in ${BASE_PORT}-${BASE_PORT + MAX_PORT_SEARCH - 1}`,
  );
}

/**
 * Parses CLI flags and binds to the first free port. Returns null when
 * `--help` was requested. Throws ConfigError for invalid input.
 */
export async function loadConfig(argv = process.argv.slice(2)): Promise<LoadedConfig | null> {
  const options = parseCliArgs(argv);
  if (options === null) return null;

  const { server, port } = await listenOnAvailablePort();
  return {
    config: { ...options, port, nodeId: `node-${port}` },
    server,
  };
}
