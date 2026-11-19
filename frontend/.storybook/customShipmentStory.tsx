import type { Decorator } from "@storybook/react-vite";

import type { CustomShipmentCall } from "../src/features/customShipment/customShipmentPrototype";
import { CustomShipmentsPrototype } from "../src/features/customShipment/customShipmentPrototype";
import { customShipmentAnswer } from "./customShipmentFixtures";

// MOUNTS THE CUSTOM SHIPMENTS' PROTOTYPE (backlog #88) around a story — the shape the restock tags' prototype used (#87).
// A story with `parameters.live` gets NO provider: the page then draws exactly what it would in the app today, its
// one-line "not available" (the gate). `parameters.customShipmentActor` names whose writes these are — the warehouse's
// person on the warehouse's pages, Toko Melati's Eko otherwise.

/** Every write the screens sent in this story, in order — reset by `resetCustomShipmentCalls` in a meta's beforeEach. */
export const customShipmentCalls: CustomShipmentCall[] = [];

export function resetCustomShipmentCalls() {
  customShipmentCalls.length = 0;
}

export const withCustomShipments: Decorator = (Story, context) => {
  if (context.parameters.live) return <Story />;

  return (
    <CustomShipmentsPrototype
      initial={customShipmentAnswer()}
      actorUserId={(context.parameters.customShipmentActor as bigint | undefined) ?? 65n}
      onCall={(call) => customShipmentCalls.push(call)}
    >
      <Story />
    </CustomShipmentsPrototype>
  );
};
