import http from "node:http";
import minimist from "minimist";
import {
  BASE_PORT,
  DEFAULT_ANGLE_DEG,
  DEFAULT_LENGTH,
  DEFAULT_MASS,
  HOST,
  MAX_ANGLE_DEG,
  MAX_LENGTH,
  MAX_MASS,
  MAX_PORT_SEARCH,
  MIN_ANGLE_DEG,
  MIN_LENGTH,
  MIN_MASS,
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
  --length <number>  Pendulum length, ${MIN_LENGTH} to ${MAX_LENGTH} (default: ${DEFAULT_LENGTH})
  --mass <number>    Bob mass, ${MIN_MASS} to ${MAX_MASS} (default: ${DEFAULT_MASS})
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

function checkRange(name: string, value: number, min: number, max: number, unit = ""): void {
  if (value < min || value > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max}${unit}, got ${value}`);
  }
}

function checkLimits(
  { length, mass, angle }: Partial<CliOptions>,
  prefix: string,
): void {
  if (length !== undefined) checkRange(`${prefix}length`, length, MIN_LENGTH, MAX_LENGTH);
  if (mass !== undefined) checkRange(`${prefix}mass`, mass, MIN_MASS, MAX_MASS);
  if (angle !== undefined) {
    checkRange(`${prefix}angle`, angle, MIN_ANGLE_DEG, MAX_ANGLE_DEG, " degrees");
  }
}

/**
 * Validates a partial configuration update, such as a PUT /config body.
 * Throws ConfigError for unknown fields, non-numbers or out-of-range values.
 */
export function parseConfigUpdate(body: unknown): Partial<CliOptions> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ConfigError("Configuration must be a JSON object");
  }

  const unknown = Object.keys(body).filter(
    (key) => !(NUMERIC_FLAGS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) {
    throw new ConfigError(`Unknown field(s): ${unknown.join(", ")}`);
  }

  const update: Partial<CliOptions> = {};
  for (const field of NUMERIC_FLAGS) {
    const value = (body as Record<string, unknown>)[field];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ConfigError(`${field} must be a finite number`);
    }
    update[field] = value;
  }

  checkLimits(update, "");
  return update;
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

  checkLimits({ length, mass, angle }, "--");

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
