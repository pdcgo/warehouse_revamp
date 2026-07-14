import { createClient } from "@connectrpc/connect";
import { AuthService, UserService } from "../gen/warehouse/user/v1/user_pb";
import { TeamService } from "../gen/warehouse/team/v1/team_pb";
import { ShippingService } from "../gen/warehouse/shipping/v1/shipping_pb";
import { transport } from "../transport";

// One client per service, created once. The transport attaches the bearer token; the CURRENT
// TEAM is never attached automatically — it is a message field, so each caller passes it.
export const authClient = createClient(AuthService, transport);
export const userClient = createClient(UserService, transport);
export const teamClient = createClient(TeamService, transport);
export const shippingClient = createClient(ShippingService, transport);

// rpcError turns a Connect error into something a human can read.
export function rpcError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
