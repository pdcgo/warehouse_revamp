package inventory_v1

import "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1/inventoryv1connect"

// OpnamePrototype serves warehouse.inventory.v1.OpnameService while it is a PROTOTYPE: every RPC answers
// Unimplemented, and the screens run against the Storybook stub until the owner accepts the design
// (docs/development_lifecycle.md, design_accept; docs/business/inventory/opname.md).
//
// It is mounted so the routes in the app reach a real service and show its error state instead of a 404, and so the
// service appears in reflection with the access interceptor already in front of it.
//
// ⚠ The backend step DELETES this type. The handlers become methods on *Service, one file per RPC, and service.go
// gains the compile-time assertion the other services have — so a forgotten RPC fails the build instead of silently
// staying Unimplemented, which is exactly what embedding this handler would hide. The same step retires
// InventoryService.StockOpname and the one-rack page it serves.
type OpnamePrototype struct {
	inventoryv1connect.UnimplementedOpnameServiceHandler
}
