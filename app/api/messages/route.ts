import { NextRequest, NextResponse } from "next/server";

type Attachment = {
  name: string;
  type: string;
  size: number;
  data: string; // base64 string
};

type MessagePayload = {
  id: string;
  threadId: string;
  senderId: string;
  recipientId: string;
  ciphertext: string;
  iv: string;
  createdAt: string;
  attachment?: Attachment | null;
  status?: "sent" | "delivered" | "read";
  readBy?: string[];
  metadata?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Runtime validation helpers
// ---------------------------------------------------------------------------

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const isString = (v: unknown): v is string => typeof v === "string";
const isNonEmptyString = (v: unknown): v is string =>
  isString(v) && v.trim().length > 0;
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(isString);

function validateAttachment(v: unknown): Attachment | null {
  if (v == null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const a = v as Record<string, unknown>;
  if (
    isString(a.name) &&
    isString(a.type) &&
    typeof a.size === "number" &&
    isString(a.data)
  ) {
    return { name: a.name, type: a.type, size: a.size, data: a.data };
  }
  return null;
}

// Validated shapes for each client message type
type ValidatedSendMessage = {
  type: "message";
  id: string;
  threadId: string;
  senderId: string;
  recipientId: string;
  ciphertext: string;
  iv: string;
  createdAt: string;
  attachment: Attachment | null;
  readBy: string[];
  metadata: Record<string, unknown>;
};

type ValidatedTyping = {
  type: "typing";
  userId: string;
  threadId: string;
};

type ValidatedReadReceipt = {
  type: "read-receipt";
  messageId: string;
  userId: string;
};

type ValidatedModerate = {
  type: "moderate";
  messageId: string;
  action: "delete" | "flag";
  moderatorId: string;
  reason?: string;
};

type ValidatedPing = { type: "ping" };

type ValidatedClientMessage =
  | ValidatedSendMessage
  | ValidatedTyping
  | ValidatedReadReceipt
  | ValidatedModerate
  | ValidatedPing;

function validateClientMessage(
  raw: unknown,
): ValidationResult<ValidatedClientMessage> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Payload must be a JSON object" };
  }

  const obj = raw as Record<string, unknown>;

  if (!isNonEmptyString(obj.type)) {
    return { ok: false, error: "Missing or empty 'type' field" };
  }

  switch (obj.type) {
    case "message": {
      if (!isNonEmptyString(obj.senderId))
        return { ok: false, error: "message: 'senderId' is required" };
      if (!isNonEmptyString(obj.ciphertext))
        return { ok: false, error: "message: 'ciphertext' is required" };
      if (!isNonEmptyString(obj.iv))
        return { ok: false, error: "message: 'iv' is required" };

      const value: ValidatedSendMessage = {
        type: "message",
        id: isNonEmptyString(obj.id) ? obj.id : crypto.randomUUID(),
        threadId: isNonEmptyString(obj.threadId) ? obj.threadId : "general",
        senderId: obj.senderId,
        recipientId: isNonEmptyString(obj.recipientId)
          ? obj.recipientId
          : "all",
        ciphertext: obj.ciphertext,
        iv: obj.iv,
        createdAt: isNonEmptyString(obj.createdAt)
          ? obj.createdAt
          : new Date().toISOString(),
        attachment: validateAttachment(obj.attachment),
        readBy: isStringArray(obj.readBy) ? obj.readBy : [obj.senderId],
        metadata:
          typeof obj.metadata === "object" &&
          obj.metadata !== null &&
          !Array.isArray(obj.metadata)
            ? (obj.metadata as Record<string, unknown>)
            : {},
      };
      return { ok: true, value };
    }

    case "typing": {
      if (!isNonEmptyString(obj.userId))
        return { ok: false, error: "typing: 'userId' is required" };
      if (!isNonEmptyString(obj.threadId))
        return { ok: false, error: "typing: 'threadId' is required" };
      return {
        ok: true,
        value: { type: "typing", userId: obj.userId, threadId: obj.threadId },
      };
    }

    case "read-receipt": {
      if (!isNonEmptyString(obj.messageId))
        return { ok: false, error: "read-receipt: 'messageId' is required" };
      if (!isNonEmptyString(obj.userId))
        return { ok: false, error: "read-receipt: 'userId' is required" };
      return {
        ok: true,
        value: {
          type: "read-receipt",
          messageId: obj.messageId,
          userId: obj.userId,
        },
      };
    }

    case "moderate": {
      if (!isNonEmptyString(obj.messageId))
        return { ok: false, error: "moderate: 'messageId' is required" };
      if (obj.action !== "delete" && obj.action !== "flag")
        return {
          ok: false,
          error: "moderate: 'action' must be 'delete' or 'flag'",
        };
      if (!isNonEmptyString(obj.moderatorId))
        return { ok: false, error: "moderate: 'moderatorId' is required" };
      return {
        ok: true,
        value: {
          type: "moderate",
          messageId: obj.messageId,
          action: obj.action,
          moderatorId: obj.moderatorId,
          reason: isString(obj.reason) ? obj.reason : undefined,
        },
      };
    }

    case "ping":
      return { ok: true, value: { type: "ping" } };

    default:
      return { ok: false, error: `Unknown message type: '${obj.type}'` };
  }
}

type ServerState = {
  clients: Set<WebSocket>;
  history: MessagePayload[];
};

const getState = (): ServerState => {
  const globalRef = globalThis as unknown as { __messageState?: ServerState };
  if (!globalRef.__messageState) {
    globalRef.__messageState = { clients: new Set<WebSocket>(), history: [] };
  }
  return globalRef.__messageState;
};

/**
 * upgradeWebSocket — runtime-aware WebSocket upgrade helper.
 *
 * Supported runtimes:
 *  1. Deno Deploy / Deno-based edge  — uses `Deno.upgradeWebSocket(request)`.
 *  2. Cloudflare Workers / WinterCG  — some runtimes expose `request.webSocket`;
 *     we call `.accept()` and synthesise a 101 response.
 *  3. Node.js (standard Next.js)     — raw socket hijacking is NOT available
 *     inside route handlers. Handle upgrades in a custom server (e.g. the `ws`
 *     package) and proxy messages to this handler's business logic instead.
 *     This path throws so the caller can return a 501 to the client.
 *
 * Adding a new runtime:
 *  - Detect a unique global or request property for that runtime.
 *  - Implement the upgrade and return `{ socket, response }`.
 *  - Document it here.
 */
const upgradeWebSocket = (
  request: Request,
): { socket: WebSocket; response: Response } => {
  // --- Deno Deploy / Deno edge runtime ---
  const denoUpgrade = (
    globalThis as unknown as {
      Deno?: {
        upgradeWebSocket: (r: Request) => {
          socket: WebSocket;
          response: Response;
        };
      };
    }
  )?.Deno?.upgradeWebSocket;
  if (typeof denoUpgrade === "function") {
    return denoUpgrade(request);
  }

  // --- WinterCG / runtimes that attach webSocket directly to the request ---
  const anyRequest = request as unknown as {
    webSocket?: WebSocket & { accept(): void };
  };
  if (anyRequest?.webSocket) {
    anyRequest.webSocket.accept();
    return {
      socket: anyRequest.webSocket as WebSocket,
      response: new Response(null, { status: 101 }),
    };
  }

  // --- Unsupported runtime (e.g. standard Node.js Next.js) ---
  throw new Error(
    "WebSocket upgrade is not supported in this runtime. " +
      "Use a custom Node.js server with the `ws` package, or deploy to a Deno-compatible edge runtime.",
  );
};

const broadcast = (data: unknown) => {
  const payload = JSON.stringify(data);
  const { clients } = getState();
  clients.forEach((socket) => {
    try {
      socket.send(payload);
    } catch (err) {
      console.error("Failed to send message to client", err);
      try {
        socket.close();
      } catch {
        // ignore
      }
      clients.delete(socket);
    }
  });
};

const handleMessageEvent = (socket: WebSocket, raw: string) => {
  const state = getState();
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = validateClientMessage(parsed);

    if (!result.ok) {
      socket.send(JSON.stringify({ type: "error", message: result.error }));
      return;
    }

    const msg = result.value;

    if (msg.type === "message") {
      const message: MessagePayload = {
        id: msg.id,
        threadId: msg.threadId,
        senderId: msg.senderId,
        recipientId: msg.recipientId,
        ciphertext: msg.ciphertext,
        iv: msg.iv,
        createdAt: msg.createdAt,
        attachment: msg.attachment,
        status: "sent",
        readBy: msg.readBy,
        metadata: msg.metadata,
      };
      state.history.push(message);
      broadcast({ type: "message", data: message });
    } else if (msg.type === "typing") {
      broadcast({ type: "typing", userId: msg.userId, threadId: msg.threadId });
    } else if (msg.type === "read-receipt") {
      const { messageId, userId } = msg;
      state.history = state.history.map((m) =>
        m.id === messageId
          ? {
              ...m,
              status: "read",
              readBy: Array.from(new Set([...(m.readBy || []), userId])),
            }
          : m,
      );
      broadcast({ type: "read-receipt", messageId, userId });
    } else if (msg.type === "moderate") {
      const { messageId, action, moderatorId, reason } = msg;
      if (action === "delete") {
        state.history = state.history.filter((m) => m.id !== messageId);
      }
      broadcast({ type: "moderated", messageId, action, moderatorId, reason });
    } else if (msg.type === "ping") {
      socket.send(JSON.stringify({ type: "pong", ts: Date.now() }));
    }
  } catch (err) {
    console.error("Invalid payload", err);
    socket.send(
      JSON.stringify({ type: "error", message: "Invalid JSON payload" }),
    );
  }
};

export async function GET(request: NextRequest) {
  const upgradeHeader = request.headers.get("upgrade");

  if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
    try {
      const { socket, response } = upgradeWebSocket(request);
      const state = getState();

      socket.addEventListener("open", () => {
        state.clients.add(socket);
        socket.send(
          JSON.stringify({ type: "history", data: state.history.slice(-200) }), // cap initial history
        );
      });

      socket.addEventListener("message", (event: MessageEvent) => {
        const raw = typeof event.data === "string" ? event.data : "";
        handleMessageEvent(socket, raw);
      });

      socket.addEventListener("close", () => {
        state.clients.delete(socket);
      });

      socket.addEventListener("error", () => {
        state.clients.delete(socket);
      });

      return response;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "WebSocket upgrade failed";
      const isUnsupportedRuntime = message.includes(
        "not supported in this runtime",
      );
      console.error("WebSocket upgrade failed", err);
      return NextResponse.json(
        { error: message },
        { status: isUnsupportedRuntime ? 501 : 400 },
      );
    }
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.toLowerCase().trim();
  const threadId = searchParams.get("threadId") || undefined;
  const state = getState();
  const filtered = state.history.filter((msg) => {
    const inThread = threadId ? msg.threadId === threadId : true;
    if (!q) return inThread;
    return (
      inThread &&
      (msg.metadata?.plainText as string | undefined)?.toLowerCase().includes(q)
    );
  });

  return NextResponse.json({ messages: filtered });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = validateClientMessage(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (result.value.type !== "message") {
    return NextResponse.json(
      { error: "POST only accepts 'message' type payloads" },
      { status: 400 },
    );
  }

  const msg = result.value;
  const state = getState();
  const message: MessagePayload = {
    id: msg.id,
    threadId: msg.threadId,
    senderId: msg.senderId,
    recipientId: msg.recipientId,
    ciphertext: msg.ciphertext,
    iv: msg.iv,
    createdAt: new Date().toISOString(),
    attachment: msg.attachment,
    status: "sent",
    readBy: msg.readBy,
    metadata: msg.metadata,
  };
  state.history.push(message);
  broadcast({ type: "message", data: message });
  return NextResponse.json({ ok: true, message });
}

export const dynamic = "force-dynamic";
export const runtime = "edge";
