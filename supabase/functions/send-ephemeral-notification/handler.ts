const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGE_LENGTH = 500;
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NotificationKind = "message" | "delivery" | "response";
export type DeliveryCategory =
  | "questionnaire"
  | "advertisement"
  | "special_questionnaire";

export function isDeliveryCategory(
  value: unknown,
): value is DeliveryCategory {
  return value === "questionnaire" ||
    value === "advertisement" ||
    value === "special_questionnaire";
}

export interface ExpoPushMessage {
  to: string;
  sound: "default";
  title: string;
  body: string;
  data: { kind: NotificationKind; url: string };
  categoryId: "dotaznicek_open";
  ttl: number;
}

export interface EphemeralNotificationDependencies {
  getAuthenticatedUser(
    accessToken: string,
  ): Promise<{ id: string } | null>;
  getOwnerId(): Promise<string | null>;
  getDelivery(
    deliveryId: string,
  ): Promise<{ userId: string; category: DeliveryCategory } | null>;
  getResponseUserId(responseId: string): Promise<string | null>;
  getPushTokens(userId: string): Promise<readonly string[]>;
  sendPushNotifications(
    messages: readonly ExpoPushMessage[],
  ): Promise<readonly { ok: boolean }[]>;
  logger: Pick<Console, "error">;
}

interface NotificationRequest {
  kind: NotificationKind;
  recipientUserId?: string;
  message?: string;
  url: string;
}

interface PushTarget {
  userId: string;
  kind: NotificationKind;
  message: string;
  url: string;
  title: string;
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "authorization, apikey, content-type, x-client-info",
      "access-control-allow-methods": "POST, OPTIONS",
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MAX_BODY_BYTES
  ) {
    return null;
  }
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function normalizeUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function parseRequest(value: unknown): NotificationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  const url = record.url;
  const message = record.message;
  const recipientUserId = record.recipientUserId;

  if (
    (kind !== "message" && kind !== "delivery" && kind !== "response") ||
    typeof url !== "string" ||
    url.length === 0 ||
    url.length > 256 ||
    (message !== undefined && typeof message !== "string") ||
    (typeof message === "string" && message.length > MAX_MESSAGE_LENGTH)
  ) {
    return null;
  }
  if (
    recipientUserId !== undefined &&
    normalizeUuid(recipientUserId) === null
  ) {
    return null;
  }
  if (
    (kind === "message" || kind === "delivery") &&
    (typeof message !== "string" || message.trim().length === 0)
  ) {
    return null;
  }
  if (kind === "response" && message !== undefined) {
    return null;
  }

  return {
    kind,
    url,
    ...(typeof recipientUserId === "string"
      ? { recipientUserId: recipientUserId.toLowerCase() }
      : {}),
    ...(typeof message === "string" ? { message: message.trim() } : {}),
  };
}

function deliveryRoute(url: string): {
  deliveryId: string;
  category: DeliveryCategory;
} | null {
  const match = url.match(
    /^\/(dotaznik|reklama|specialni-dotaznik)\/([0-9a-f-]{36})$/,
  );
  if (!match) {
    return null;
  }
  const deliveryId = normalizeUuid(match[2]);
  if (!deliveryId) {
    return null;
  }
  const category: DeliveryCategory = match[1] === "dotaznik"
    ? "questionnaire"
    : match[1] === "reklama"
    ? "advertisement"
    : "special_questionnaire";
  return { deliveryId, category };
}

function responseRoute(url: string): string | null {
  const match = url.match(/^\/vysledky\/([0-9a-f-]{36})$/);
  return match ? normalizeUuid(match[1]) : null;
}

function createPushMessages(
  target: PushTarget,
  pushTokens: readonly string[],
): ExpoPushMessage[] {
  return pushTokens.map((token) => ({
    to: token,
    sound: "default",
    title: target.title,
    body: target.message,
    data: { kind: target.kind, url: target.url },
    categoryId: "dotaznicek_open",
    ttl: PUSH_TTL_SECONDS,
  }));
}

async function resolveTarget(
  input: NotificationRequest,
  callerId: string,
  ownerId: string,
  dependencies: EphemeralNotificationDependencies,
): Promise<PushTarget | Response> {
  const isOwner = callerId === ownerId;
  if (input.kind === "message") {
    const message = input.message;
    if (!message) {
      return jsonResponse(400, { error: "Message text is required" });
    }
    if (input.url !== "/zprava") {
      return jsonResponse(400, { error: "Unsupported notification route" });
    }
    if (isOwner) {
      if (!input.recipientUserId || input.recipientUserId === ownerId) {
        return jsonResponse(400, { error: "A recipient is required" });
      }
      return {
        userId: input.recipientUserId,
        kind: input.kind,
        message,
        url: input.url,
        title: "Zpráva od správce",
      };
    }
    if (
      input.recipientUserId !== undefined &&
      input.recipientUserId !== ownerId
    ) {
      return jsonResponse(403, { error: "Not allowed" });
    }
    return {
      userId: ownerId,
      kind: input.kind,
      message,
      url: input.url,
      title: "Zpráva od uživatele",
    };
  }

  if (input.kind === "delivery") {
    if (!isOwner) {
      return jsonResponse(403, { error: "Not allowed" });
    }
    const recipientId = input.recipientUserId;
    const route = deliveryRoute(input.url);
    const message = input.message;
    if (!recipientId || !route || !message) {
      return jsonResponse(400, { error: "Unsupported delivery route" });
    }
    const delivery = await dependencies.getDelivery(route.deliveryId);
    if (!delivery) {
      return jsonResponse(404, { error: "Delivery not found" });
    }
    if (
      delivery.userId.toLowerCase() !== recipientId ||
      delivery.category !== route.category
    ) {
      return jsonResponse(403, { error: "Not allowed" });
    }
    return {
      userId: recipientId,
      kind: input.kind,
      message,
      url: input.url,
      title: "Nový úkol",
    };
  }

  if (isOwner) {
    return jsonResponse(403, { error: "Not allowed" });
  }
  if (
    input.recipientUserId !== undefined &&
    input.recipientUserId !== ownerId
  ) {
    return jsonResponse(403, { error: "Not allowed" });
  }
  const responseId = responseRoute(input.url);
  if (!responseId) {
    return jsonResponse(400, { error: "Unsupported response route" });
  }
  const responseUserId = await dependencies.getResponseUserId(responseId);
  if (!responseUserId || responseUserId.toLowerCase() !== callerId) {
    return jsonResponse(403, { error: "Not allowed" });
  }
  return {
    userId: ownerId,
    kind: input.kind,
    message: "Uživatel odeslal odpověď.",
    url: input.url,
    title: "Nová odpověď",
  };
}

export function createEphemeralNotificationHandler(
  dependencies: EphemeralNotificationDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers":
            "authorization, apikey, content-type, x-client-info",
          "access-control-allow-methods": "POST, OPTIONS",
        },
      });
    }
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const accessToken = getBearerToken(request);
    if (!accessToken || accessToken.length > 8192) {
      return jsonResponse(401, { error: "Authentication required" });
    }
    const contentType = request.headers.get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      return jsonResponse(400, { error: "Invalid request" });
    }

    let bodyText: string | null;
    try {
      bodyText = await readBoundedBody(request);
    } catch {
      return jsonResponse(400, { error: "Invalid request" });
    }
    if (bodyText === null) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return jsonResponse(400, { error: "Invalid request" });
    }
    const input = parseRequest(body);
    if (!input) {
      return jsonResponse(400, { error: "Invalid request" });
    }

    try {
      const caller = await dependencies.getAuthenticatedUser(accessToken);
      const callerId = normalizeUuid(caller?.id);
      if (!callerId) {
        return jsonResponse(401, { error: "Authentication required" });
      }
      const configuredOwnerId = await dependencies.getOwnerId();
      const ownerId = normalizeUuid(configuredOwnerId);
      if (!ownerId) {
        throw new Error("owner identity is unavailable");
      }

      const target = await resolveTarget(
        input,
        callerId,
        ownerId,
        dependencies,
      );
      if (target instanceof Response) {
        return target;
      }

      const pushTokens = [
        ...new Set(
          (await dependencies.getPushTokens(target.userId))
            .map((token) => token.trim())
            .filter((token) => token.length > 0),
        ),
      ];
      if (pushTokens.length === 0) {
        return jsonResponse(409, { error: "No registered push tokens" });
      }
      const messages = createPushMessages(target, pushTokens);

      let results: readonly { ok: boolean }[];
      try {
        results = await dependencies.sendPushNotifications(messages);
      } catch {
        dependencies.logger.error("Expo push delivery failed");
        return jsonResponse(502, { sent: 0, failed: messages.length });
      }
      if (
        results.length !== messages.length ||
        results.some((result) => typeof result.ok !== "boolean")
      ) {
        dependencies.logger.error("Expo returned invalid delivery results");
        return jsonResponse(502, { sent: 0, failed: messages.length });
      }
      const sent = results.filter((result) => result.ok).length;
      return jsonResponse(200, {
        sent,
        failed: results.length - sent,
      });
    } catch (error) {
      dependencies.logger.error(
        "ephemeral notification request failed",
        error instanceof Error ? error.message : "unknown error",
      );
      return jsonResponse(500, { error: "Unable to send notification" });
    }
  };
}
