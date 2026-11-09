// OrderCreate's ANSWER, scripted — the order form's lock and its Try Again (the-form-locks-until-it-is-answered,
// no-answer-is-only-a-lost-connection, a-try-again-always-warns).
//
// Each OrderCreate in turn takes the next entry of `next`; past the end it is answered as usual (stubTransport.ts):
//
// | entry              | what happens                                                                              |
// | ------------------ | ----------------------------------------------------------------------------------------- |
// | `slow`             | held — the form stays locked — until a story calls `releaseSlowAnswer()`                  |
// | `serverError`      | the SERVER answers Internal (thrown inside the handler, so it arrives as a real Connect   |
// |                    | error body with response headers)                                                         |
// | `lost`             | the connection drops before the server sees it: a TypeError from the client side, as     |
// |                    | `fetch` rejects — Connect-ES wraps it Unknown with that TypeError as its cause            |
// | `lostAfterPlacing` | the server PLACES the order, then the reply is lost — so the duplicate lookup now finds   |
// |                    | it on the same shop + ref (what Try Again usually meets)                                  |
//
// The client-side half is an INTERCEPTOR on the router transport: it runs in the browser's call, before the in-memory
// "server", which is exactly where a real fetch fails. `keys` records every key that LEFT the browser, lost ones too —
// `orderKeyScenario.sent` (sessionScenario.ts) only sees the ones that reached the server.
//
// ⚠ ITS OWN MODULE, so a story can import the scenario without pulling stubTransport.ts into `npm run typecheck`.
// preview.tsx's `beforeEach` resets it — and drops a request still held, so it never lands in the next story.

import { Code, ConnectError } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";

import type { OrderCreateRequest, OrderCreateResponse } from "../src/gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../src/gen/warehouse/selling/v1/order_pb";
import { duplicateRefScenario } from "./duplicateRefStub";

export type OrderAnswer = "slow" | "serverError" | "lost" | "lostAfterPlacing";

export const orderAnswerScenario = {
  next: [] as OrderAnswer[],
  /** Every key a Create sent from the browser, in order — lost ones included. */
  keys: [] as string[],
  /** Set by the interceptor for the handler: the next OrderCreate the server sees answers Internal. */
  serverErrorPending: false,
};

/** The message the server's scripted Internal carries — a story asserts the form shows it. */
export const SERVER_ERROR_MESSAGE = "the order could not be placed: inventory did not answer in time";

let held: { release: () => void; drop: () => void }[] = [];

/** Let every held (`slow`) Create through to the server. */
export function releaseSlowAnswer() {
  const now = held;
  held = [];
  now.forEach((h) => h.release());
}

export function resetOrderAnswerStub() {
  const now = held;
  held = [];
  now.forEach((h) => h.drop());
  orderAnswerScenario.next = [];
  orderAnswerScenario.keys = [];
  orderAnswerScenario.serverErrorPending = false;
}

/** A `beforeEach`: the next Creates are answered like this, in turn. */
export function withOrderAnswers(...answers: OrderAnswer[]) {
  return () => {
    orderAnswerScenario.next = [...answers];
  };
}

/** Called first inside the stub's OrderCreate handler: the server's own Internal, when the interceptor scripted one. */
export function refuseOrderCreateIfScripted() {
  if (!orderAnswerScenario.serverErrorPending) return;
  orderAnswerScenario.serverErrorPending = false;

  throw new ConnectError(SERVER_ERROR_MESSAGE, Code.Internal);
}

/** What `fetch` rejects with when the connection drops — the Fetch spec's TypeError. */
function lostConnection() {
  return new TypeError("Failed to fetch");
}

export const orderAnswerInterceptor: Interceptor = (next) => async (req) => {
  if (req.stream || req.service.typeName !== "warehouse.selling.v1.OrderService" || req.method.name !== "OrderCreate") {
    return next(req);
  }

  const message = req.message as OrderCreateRequest;
  orderAnswerScenario.keys = [...orderAnswerScenario.keys, message.idempotencyKey];

  switch (orderAnswerScenario.next.shift()) {
    case "slow":
      await new Promise<void>((resolve, reject) => {
        held.push({ release: resolve, drop: () => reject(lostConnection()) });
      });
      return next(req);

    case "serverError":
      orderAnswerScenario.serverErrorPending = true;
      return next(req);

    case "lost":
      throw lostConnection();

    case "lostAfterPlacing": {
      const res = await next(req);
      if (res.stream) return res;

      // Placed: the order now carries this shop + ref, as the server's row would — so Try Again's lookup names it.
      const orderId = (res.message as OrderCreateResponse).order?.id ?? 0n;
      duplicateRefScenario.extra = [
        ...duplicateRefScenario.extra,
        {
          orderId,
          teamId: message.teamId,
          shopId: message.shopId,
          ref: message.orderExternalRefId,
          status: OrderStatus.PENDING,
          createdAtUnix: BigInt(Math.floor(Date.now() / 1000)),
        },
      ];

      throw lostConnection();
    }

    default:
      return next(req);
  }
};
