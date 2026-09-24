import { EventEmitter } from "node:events";
import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConfigError,
  USAGE,
  listenOnAvailablePort,
  loadConfig,
  nodeIdForPort,
  parseCliArgs,
  parseConfigUpdate,
  portFromNodeId,
} from "./config";
import { BASE_PORT, DEFAULT_ANGLE_DEG, DEFAULT_LENGTH, DEFAULT_MASS, SPACING } from "./constants";

describe("parseCliArgs", () => {
  it("uses the defaults when no flags are given", () => {
    expect(parseCliArgs([])).toEqual({
      x: undefined,
      length: DEFAULT_LENGTH,
      mass: DEFAULT_MASS,
      angle: DEFAULT_ANGLE_DEG,
    });
    expect([DEFAULT_LENGTH, DEFAULT_MASS, DEFAULT_ANGLE_DEG]).toEqual([100, 4200, 20]);
  });

  it("parses each flag", () => {
    expect(parseCliArgs(["--angle", "45"])?.angle).toBe(45);
    expect(parseCliArgs(["--length", "200", "--mass", "2000"])).toMatchObject({
      length: 200,
      mass: 2000,
    });
    expect(parseCliArgs(["--x=250"])?.x).toBe(250);
  });

  it("accepts negative values after a space or an equals sign", () => {
    expect(parseCliArgs(["--x", "100", "--angle", "-30"])).toMatchObject({ x: 100, angle: -30 });
    expect(parseCliArgs(["--angle=-30"])?.angle).toBe(-30);
    expect(parseCliArgs(["--x", "-50"])?.x).toBe(-50);
  });

  it("accepts the limits themselves", () => {
    expect(parseCliArgs(["--angle", "180"])?.angle).toBe(180);
    expect(parseCliArgs(["--angle", "-180"])?.angle).toBe(-180);
    expect(parseCliArgs(["--length", "10", "--mass", "35"])).toMatchObject({ length: 10, mass: 35 });
  });

  it("returns null for --help and -h", () => {
    expect(parseCliArgs(["--help"])).toBeNull();
    expect(parseCliArgs(["-h"])).toBeNull();
    expect(USAGE).toContain("--angle");
  });

  it.each([
    [["--length", "-10"], /length must be between/],
    [["--length", "0"], /length must be between/],
    [["--length", "500"], /length must be between/],
    [["--mass", "0"], /mass must be between/],
    [["--mass", "-5"], /mass must be between/],
    [["--angle", "200"], /angle must be between/],
    [["--angle", "-181"], /angle must be between/],
    [["--angle", "abc"], /must be a number/],
    [["--angle", "12abc"], /must be a number/],
    [["--angle"], /must be a number/],
    [["--length", "Infinity"], /must be a number/],
    [["--length", "1e999"], /finite/],
    [["--angle", "10", "--angle", "20"], /more than once/],
    [["--port", "7800"], /Unknown option/],
    [["extra"], /Unexpected argument/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(ConfigError);
    expect(() => parseCliArgs(argv)).toThrow(message);
  });
});

describe("parseConfigUpdate", () => {
  it("accepts any subset of the configurable fields", () => {
    expect(parseConfigUpdate({})).toEqual({});
    expect(parseConfigUpdate({ x: -20, length: 150, mass: 500, angle: -90 })).toEqual({
      x: -20,
      length: 150,
      mass: 500,
      angle: -90,
    });
  });

  it.each([
    [null, /JSON object/],
    [[1, 2], /JSON object/],
    [{ length: -10 }, /length must be between/],
    [{ mass: 0 }, /mass must be between/],
    [{ angle: 200 }, /angle must be between/],
    [{ angle: "30" }, /angle must be a finite number/],
    [{ x: null }, /x must be a finite number/],
    [{ port: 7800 }, /Unknown field/],
  ])("rejects %j", (body, message) => {
    expect(() => parseConfigUpdate(body)).toThrow(message);
  });
});

describe("node IDs", () => {
  it("derives the node ID from the port and back", () => {
    expect(nodeIdForPort(7703)).toBe("node-7703");
    expect(portFromNodeId("node-7703")).toBe(7703);
    expect(portFromNodeId("leader")).toBeNull();
  });
});

describe("port auto-discovery", () => {
  /** Replaces http.createServer with a fake whose ports below `firstFree` are taken. */
  function mockPortsInUse(firstFree: number) {
    const attempts: number[] = [];
    const server = new EventEmitter() as EventEmitter & { listen: (port: number) => void };
    server.listen = (port: number) => {
      attempts.push(port);
      setImmediate(() => {
        if (port < firstFree) {
          server.emit("error", Object.assign(new Error("in use"), { code: "EADDRINUSE" }));
        } else {
          server.emit("listening");
        }
      });
    };
    vi.spyOn(http, "createServer").mockReturnValue(server as unknown as http.Server);
    return attempts;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("binds to the base port when it is free", async () => {
    mockPortsInUse(BASE_PORT);
    expect((await listenOnAvailablePort()).port).toBe(7700);
  });

  it("moves on to 7701 when 7700 is taken", async () => {
    const attempts = mockPortsInUse(7701);
    expect((await listenOnAvailablePort()).port).toBe(7701);
    expect(attempts).toEqual([7700, 7701]);
  });

  it("skips every taken port up to the first free one", async () => {
    const attempts = mockPortsInUse(7706);
    expect((await listenOnAvailablePort()).port).toBe(7706);
    expect(attempts).toEqual([7700, 7701, 7702, 7703, 7704, 7705, 7706]);
  });

  it("gives up on errors other than a taken port", async () => {
    const server = new EventEmitter() as EventEmitter & { listen: () => void };
    server.listen = () =>
      setImmediate(() =>
        server.emit("error", Object.assign(new Error("denied"), { code: "EACCES" })),
      );
    vi.spyOn(http, "createServer").mockReturnValue(server as unknown as http.Server);
    await expect(listenOnAvailablePort()).rejects.toThrow("denied");
  });

  it("names the node after its port and spaces hinges by join order", async () => {
    mockPortsInUse(7703);
    const loaded = await loadConfig(["--angle", "10"]);
    expect(loaded?.config).toMatchObject({
      port: 7703,
      nodeId: "node-7703",
      joinOrder: 3,
      x: 3 * SPACING,
      angle: 10,
    });
  });

  it("keeps an explicit --x", async () => {
    mockPortsInUse(7703);
    expect((await loadConfig(["--x", "42"]))?.config.x).toBe(42);
  });

  it("does not bind a port for --help or invalid flags", async () => {
    const createServer = vi.spyOn(http, "createServer");
    expect(await loadConfig(["--help"])).toBeNull();
    await expect(loadConfig(["--mass", "0"])).rejects.toThrow(ConfigError);
    expect(createServer).not.toHaveBeenCalled();
  });
});
