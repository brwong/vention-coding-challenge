import { HOST, MESSAGE_TIMEOUT_MS } from "../constants";

/** The parts of a peer's configuration that collision detection needs. */
export interface PeerConfig {
  x: number;
  length: number;
  mass: number;
}

export interface PeerAddress {
  nodeId: string;
  port: number;
}

// Message shapes follow docs/coordination.md. JOIN and JOIN_RESPONSE also
// carry the sender's configuration so peers can place each other's bobs.

export interface JoinMessage {
  type: "JOIN";
  nodeId: string;
  port: number;
  config: PeerConfig;
}

export interface JoinResponse {
  type: "JOIN_RESPONSE";
  nodeId: string;
  port: number;
  config: PeerConfig;
  peers: PeerAddress[];
}

export interface HeartbeatMessage {
  type: "HEARTBEAT";
  nodeId: string;
  epoch: number; // newest stop epoch the sender knows of
}

export interface PositionMessage {
  type: "POSITION";
  pendulumId: string;
  angle: number; // radians
  seq: number; // per-node, monotonically increasing
}

export interface StopMessage {
  type: "STOP";
  epoch: number;
  from: string;
  reporter: string; // node that detected the collision; the same as `from`
}

export interface RestartMessage {
  type: "RESTART";
  epoch: number;
  from: string;
}

export type Message =
  | JoinMessage
  | HeartbeatMessage
  | PositionMessage
  | StopMessage
  | RestartMessage;

export type MessageType = Message["type"];

type FieldKind = "string" | "number" | "config";

const MESSAGE_FIELDS: Record<MessageType, Record<string, FieldKind>> = {
  JOIN: { nodeId: "string", port: "number", config: "config" },
  HEARTBEAT: { nodeId: "string", epoch: "number" },
  POSITION: { pendulumId: "string", angle: "number", seq: "number" },
  STOP: { epoch: "number", from: "string", reporter: "string" },
  RESTART: { epoch: "number", from: "string" },
};

export const MESSAGE_TYPES = Object.keys(MESSAGE_FIELDS) as MessageType[];

export class MessageError extends Error {}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasKind(value: unknown, kind: FieldKind): boolean {
  if (kind === "number") return isFiniteNumber(value);
  if (kind === "config") {
    if (typeof value !== "object" || value === null) return false;
    const config = value as Record<string, unknown>;
    return ["x", "length", "mass"].every((key) => isFiniteNumber(config[key]));
  }
  return typeof value === kind;
}

/** Checks that a /message body has a known type and the fields that type needs. */
export function parseMessage(body: unknown): Message {
  const type = (body as { type?: unknown } | null)?.type;
  if (!MESSAGE_TYPES.includes(type as MessageType)) {
    throw new MessageError(`Unknown message type: ${String(type)}`);
  }
  const fields = MESSAGE_FIELDS[type as MessageType];
  for (const [field, kind] of Object.entries(fields)) {
    if (!hasKind((body as Record<string, unknown>)[field], kind)) {
      throw new MessageError(`${String(type)} message needs a valid "${field}"`);
    }
  }
  return body as Message;
}

/** The node a message came from. */
export function senderOf(message: Message): string {
  switch (message.type) {
    case "POSITION":
      return message.pendulumId;
    case "STOP":
    case "RESTART":
      return message.from;
    default:
      return message.nodeId;
  }
}

/**
 * POSTs a message to the node on `port`. Returns the parsed reply, or null if
 * the node is unreachable, too slow or rejects the message: callers treat
 * peers as unreliable and rely on retries and timeouts instead.
 */
export async function sendMessage<T = unknown>(port: number, message: Message): Promise<T | null> {
  try {
    const response = await fetch(`http://${HOST}:${port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(MESSAGE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
