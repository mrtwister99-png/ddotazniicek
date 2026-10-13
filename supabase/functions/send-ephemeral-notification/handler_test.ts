import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import {
  createEphemeralNotificationHandler,
  type EphemeralNotificationDependencies,
  type ExpoPushMessage,
} from "./handler.ts";

const ownerId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const otherUserId = "33333333-3333-4333-8333-333333333333";
const deliveryId = "44444444-4444-4444-8444-444444444444";
const responseId = "55555555-5555-4555-8555-555555555555";

function makeDependencies(
  overrides: Partial<EphemeralNotificationDependencies> = {},
): EphemeralNotificationDependencies {
  return {
    getAuthenticatedUser: async (token) => {
      if (token === "owner-token") {
        return { id: ownerId };
      }
      if (token === "user-token") {
        return { id: userId };
      }
      return null;
    },
    getOwnerId: async () => ownerId,
    getDelivery: async () => ({
      userId,
      category: "questionnaire",
    }),
    getResponseUserId: async () => userId,
    getPushTokens: async (recipientId) => [`push:${recipientId}`],
    sendPushNotifications: async (messages) =>
      messages.map(() => ({ ok: true })),
    logger: { error: () => {} },
    ...overrides,
  };
}

function postNotification(
  token: string,
  body: Record<string, unknown>,
): Request {
  return new Request("https://example.test/functions/v1/notification", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("owner can send a message to one recipient", async () => {
  const recipients: string[] = [];
  const sentMessages: ExpoPushMessage[] = [];
  const handler = createEphemeralNotificationHandler(makeDependencies({
    getPushTokens: async (recipientId) => {
      recipients.push(recipientId);
      return [`push:${recipientId}`];
    },
    sendPushNotifications: async (messages) => {
      sentMessages.push(...messages);
      return messages.map(() => ({ ok: true }));
    },
  }));

  const response = await handler(postNotification("owner-token", {
    kind: "message",
    recipientUserId: userId,
    message: "Please review this.",
    url: "/zprava",
  }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { sent: 1, failed: 0 });
  assertEquals(recipients, [userId]);
  assertEquals(sentMessages.length, 1);
  assertEquals(sentMessages[0].to, `push:${userId}`);
  assertEquals(sentMessages[0].body, "Please review this.");
  assertEquals(sentMessages[0].data.url, "/zprava");
  assertEquals(sentMessages[0].categoryId, "dotaznicek_open");
  assertEquals(sentMessages[0].ttl, 86400);
});

Deno.test(
  "owner can send each delivery category only to its recipient with a matching route",
  async () => {
    const cases = [
      ["questionnaire", `/dotaznik/${deliveryId}`],
      ["advertisement", `/reklama/${deliveryId}`],
      ["special_questionnaire", `/specialni-dotaznik/${deliveryId}`],
    ] as const;
    const sentMessages: ExpoPushMessage[] = [];

    for (const [category, url] of cases) {
      const handler = createEphemeralNotificationHandler(makeDependencies({
        getDelivery: async () => ({ userId, category }),
        sendPushNotifications: async (messages) => {
          sentMessages.push(...messages);
          return messages.map(() => ({ ok: true }));
        },
      }));
      const response = await handler(postNotification("owner-token", {
        kind: "delivery",
        recipientUserId: userId,
        message: "New task",
        url,
      }));
      assertEquals(response.status, 200);
      assertEquals(await response.json(), { sent: 1, failed: 0 });
    }

    assertEquals(
      sentMessages.map((message) => message.data.url),
      cases.map(([, url]) => url),
    );
  },
);

Deno.test("normal user reply is always routed to the owner", async () => {
  const recipients: string[] = [];
  const handler = createEphemeralNotificationHandler(makeDependencies({
    getPushTokens: async (recipientId) => {
      recipients.push(recipientId);
      return [`push:${recipientId}`];
    },
  }));

  const response = await handler(postNotification("user-token", {
    kind: "message",
    message: "I have a question.",
    url: "/zprava",
  }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { sent: 1, failed: 0 });
  assertEquals(recipients, [ownerId]);
});

Deno.test("response push only accepts the caller's response", async () => {
  const responseOwners = new Map([
    [responseId, userId],
  ]);
  const recipients: string[] = [];
  const handler = createEphemeralNotificationHandler(makeDependencies({
    getResponseUserId: async (id) => responseOwners.get(id) ?? null,
    getPushTokens: async (recipientId) => {
      recipients.push(recipientId);
      return [`push:${recipientId}`];
    },
  }));

  const ownResponse = await handler(postNotification("user-token", {
    kind: "response",
    url: `/vysledky/${responseId}`,
  }));
  assertEquals(ownResponse.status, 200);
  assertEquals(await ownResponse.json(), { sent: 1, failed: 0 });
  assertEquals(recipients, [ownerId]);

  const foreignResponse = await handler(postNotification("user-token", {
    kind: "response",
    url: `/vysledky/${deliveryId}`,
  }));
  assertEquals(foreignResponse.status, 403);
  assertEquals(await foreignResponse.json(), { error: "Not allowed" });
  assertEquals(recipients, [ownerId]);
});

Deno.test("rejects arbitrary recipient and unsupported URL", async () => {
  const recipients: string[] = [];
  const handler = createEphemeralNotificationHandler(makeDependencies({
    getPushTokens: async (recipientId) => {
      recipients.push(recipientId);
      return [`push:${recipientId}`];
    },
  }));

  const arbitraryRecipient = await handler(postNotification("user-token", {
    kind: "message",
    recipientUserId: otherUserId,
    message: "Not for that user.",
    url: "/zprava",
  }));
  assertEquals(arbitraryRecipient.status, 403);

  const unsupportedUrl = await handler(postNotification("owner-token", {
    kind: "message",
    recipientUserId: userId,
    message: "Unsupported deep link.",
    url: "/profile",
  }));
  assertEquals(unsupportedUrl.status, 400);
  assertEquals(recipients, []);
});

Deno.test("does not persist or log message body", async () => {
  const messageBody = "Transient only: private message.";
  const logArgs: unknown[][] = [];
  const handler = createEphemeralNotificationHandler(makeDependencies({
    logger: {
      error: (...args) => logArgs.push(args),
    },
  }));

  const response = await handler(postNotification("owner-token", {
    kind: "message",
    recipientUserId: userId,
    message: messageBody,
    url: "/zprava",
  }));
  const responseBody = await response.text();

  assertEquals(response.status, 200);
  assert(!responseBody.includes(messageBody));
  assert(!JSON.stringify(logArgs).includes(messageBody));
});

Deno.test("reports Expo delivery failures", async () => {
  const handler = createEphemeralNotificationHandler(makeDependencies({
    getPushTokens: async () => ["push:good", "push:bad"],
    sendPushNotifications: async () => [{ ok: true }, { ok: false }],
  }));

  const response = await handler(postNotification("owner-token", {
    kind: "message",
    recipientUserId: userId,
    message: "Partial delivery.",
    url: "/zprava",
  }));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { sent: 1, failed: 1 });
});
