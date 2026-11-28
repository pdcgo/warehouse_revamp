import { spyOn } from "storybook/test";

// HOLDING ONE RPC'S ANSWER (#134, the-speed-audits-old-findings-are-fixed-smallest-first) — how a story proves what a
// screen asks WITHOUT waiting for an answer: hold that answer back, then see which reads have gone out meanwhile. A read
// that starts while the held one is still out does not wait on it; one that waits on it never starts. Every call goes
// on to the stub as usual once released.

type AnyMethod = (...args: never[]) => Promise<unknown>;

export interface HeldRpc {
  /** Lets the held answers through — and every later call at once. */
  release: () => void;
  /** Puts the client's method back (releasing first) — a story's `beforeEach` returns it. */
  restore: () => void;
}

/** Holds every answer of `client[method]` until `release()`. */
export function holdRpc<C extends object>(client: C, method: keyof C & string): HeldRpc {
  const methods = client as unknown as Record<string, AnyMethod>;
  const real = methods[method]!.bind(client);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = spyOn(methods, method).mockImplementation((async (...args: never[]) => {
    await gate;

    return real(...args);
  }) as AnyMethod);

  return {
    release: () => release(),
    restore: () => {
      release();
      spy.mockRestore();
    },
  };
}

/** The calls a spied client method (spyOn, holdRpc) has had, each its arguments. */
export function callsOf(method: unknown): unknown[][] {
  return (method as { mock: { calls: unknown[][] } }).mock.calls;
}
