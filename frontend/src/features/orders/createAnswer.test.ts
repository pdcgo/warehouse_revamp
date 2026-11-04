import { Code, ConnectError, createClient, createRouterTransport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { describe, expect, it } from "vitest";

import { OrderService } from "../../gen/warehouse/selling/v1/order_pb";
import { awaitAnswer, isNoAnswer } from "./createAnswer";

// THE THREE ANSWERS, read off the REAL transports rather than hand-made errors — so if Connect-ES ever changes how it
// surfaces a dropped connection, this fails instead of the form silently unlocking (or locking) on the wrong one.
//
// `npm run test:unit` (vitest.unit.config.ts — plain Node, no browser).

const BASE = "http://api.test";

/** The real browser transport, over a `fetch` the test decides. */
function overFetch(fetch: typeof globalThis.fetch) {
  return createClient(OrderService, createConnectTransport({ baseUrl: BASE, fetch }));
}

function create(client: ReturnType<typeof overFetch>) {
  return () => client.orderCreate({ idempotencyKey: "k", teamId: 1n });
}

function connectError(status: number, code: string, message: string) {
  return async () =>
    new Response(JSON.stringify({ code, message }), {
      status,
      headers: { "content-type": "application/json" },
    });
}

describe("awaitAnswer over the browser transport", () => {
  it("a fetch that rejects (the connection dropped) is no answer", async () => {
    const answer = await awaitAnswer(
      create(overFetch(() => Promise.reject(new TypeError("Failed to fetch")))),
    );

    expect(answer.kind).toBe("none");
    // How Connect-ES says it — the shape isNoAnswer reads.
    const err = (answer as { error: unknown }).error as ConnectError;
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe(Code.Unknown);
    expect(err.cause).toBeInstanceOf(TypeError);
  });

  it("a request aborted before any reply is no answer", async () => {
    const answer = await awaitAnswer(
      create(overFetch(() => Promise.reject(new DOMException("The user aborted a request.", "AbortError")))),
    );

    expect(answer.kind).toBe("none");
    expect(((answer as { error: unknown }).error as ConnectError).code).toBe(Code.Canceled);
  });

  it("a gateway's bare 504 (no Connect body) is no answer", async () => {
    const answer = await awaitAnswer(
      create(
        overFetch(
          async () =>
            new Response("<html>504 Gateway Timeout</html>", {
              status: 504,
              headers: { "content-type": "text/html" },
            }),
        ),
      ),
    );

    expect(answer.kind).toBe("none");
  });

  it("a gateway's bare 502 with no content type is no answer", async () => {
    const answer = await awaitAnswer(create(overFetch(async () => new Response("", { status: 502 }))));

    expect(answer.kind).toBe("none");
  });

  it("the server's Internal is an answer", async () => {
    const answer = await awaitAnswer(create(overFetch(connectError(500, "internal", "inventory did not answer"))));

    expect(answer.kind).toBe("error");
    expect(((answer as { error: unknown }).error as ConnectError).code).toBe(Code.Internal);
  });

  it("the server's own Unavailable (a Connect body) is an answer", async () => {
    const answer = await awaitAnswer(create(overFetch(connectError(503, "unavailable", "inventory is unavailable"))));

    expect(answer.kind).toBe("error");
    expect(((answer as { error: unknown }).error as ConnectError).code).toBe(Code.Unavailable);
  });

  it("a refusal (FailedPrecondition) is an answer", async () => {
    const answer = await awaitAnswer(create(overFetch(connectError(400, "failed_precondition", "not enough stock"))));

    expect(answer.kind).toBe("error");
  });

  it("the order is the order", async () => {
    const answer = await awaitAnswer(
      create(
        overFetch(
          async () =>
            new Response(JSON.stringify({ order: { id: "900" } }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        ),
      ),
    );

    expect(answer.kind).toBe("order");
    expect((answer as { value: { order?: { id: bigint } } }).value.order?.id).toBe(900n);
  });
});

describe("awaitAnswer over Storybook's router transport", () => {
  // The stub's two ways to fail Create (.storybook/orderAnswerStub.ts): a handler that throws is the SERVER answering;
  // an interceptor that throws a TypeError before the handler is the connection dropping.
  it("a handler's Internal is an answer, a client-side TypeError is none", async () => {
    let drop = false;
    const transport = createRouterTransport(
      ({ service }) => {
        service(OrderService, {
          orderCreate: () => {
            throw new ConnectError("the take timed out", Code.Internal);
          },
        });
      },
      {
        transport: {
          interceptors: [
            (next) => async (req) => {
              if (drop) throw new TypeError("Failed to fetch");
              return next(req);
            },
          ],
        },
      },
    );
    const client = createClient(OrderService, transport);
    const send = () => client.orderCreate({ idempotencyKey: "k", teamId: 1n });

    expect((await awaitAnswer(send)).kind).toBe("error");

    drop = true;
    expect((await awaitAnswer(send)).kind).toBe("none");
  });
});

describe("isNoAnswer", () => {
  it("a plain Error (a bug, not the network) is an answer", () => {
    expect(isNoAnswer(new Error("cannot read properties of undefined"))).toBe(false);
  });

  it("a raw TypeError is no answer", () => {
    expect(isNoAnswer(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("a server-sent Canceled (it has response headers) is an answer", () => {
    const err = new ConnectError("canceled by the server", Code.Canceled, new Headers({ "content-type": "application/json" }));

    expect(isNoAnswer(err)).toBe(false);
  });

  it("an Unavailable whose message only looks like a status is still read by its message", () => {
    expect(isNoAnswer(new ConnectError("HTTP 503", Code.Unavailable))).toBe(true);
    expect(isNoAnswer(new ConnectError("inventory is unavailable", Code.Unavailable))).toBe(false);
  });
});
