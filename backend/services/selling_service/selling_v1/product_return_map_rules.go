package selling_v1

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// THE RETURN MAP'S RULES (the-return-map-is-selling-services-and-read-by-ids) — what the write checks, and what order
// create checks. Both ask product_service the same question through the same port the order already uses to resolve a
// line's owner (ProductCatalog.Snapshots), so "whose product is this?" has one answer on every path.

// checkReturnMapOwners is the write's two refusals, from ONE owners lookup of both products:
//
//   - the borrowed product must be ANOTHER team's — an own product never touches the map
//     (an-own-line-never-touches-the-map), and a row pointing an own product at itself would occupy the only slot a
//     real map of it could ever have;
//   - our product must be THIS team's — a return never comes back as somebody else's goods
//     (a-return-never-clones-a-product).
//
// A borrowed product that resolves to nothing is NotFound: a map of a product nobody owns is a row nothing will ever
// read. A failed lookup refuses the write — a map written unchecked cannot be taken back (a-return-map-is-written-once).
func (s *Service) checkReturnMapOwners(ctx context.Context, teamID, sharedID, ownID uint64) error {
	ids := []uint64{sharedID}
	if ownID != sharedID {
		ids = append(ids, ownID)
	}

	owners, err := s.catalog.Snapshots(ctx, teamID, ids)
	if err != nil {
		return connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("the products' owners could not be looked up — nothing was mapped: %w", err))
	}

	shared, found := owners[sharedID]
	if !found {
		return connect.NewError(connect.CodeNotFound,
			fmt.Errorf("product %d does not exist, so it cannot be mapped for returns", sharedID))
	}

	if shared.TeamID == teamID {
		return connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("%s is this team's own product — only another team's product is mapped for returns",
				productLabel(sharedID, shared)))
	}

	own, found := owners[ownID]
	if !found || own.TeamID != teamID {
		return connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("%s is not one of this team's products — a return can only come back as your own",
				productLabel(ownID, own)))
	}

	return nil
}

// errReturnMapMissing is order create's refusal of a borrowed line with no map. The products follow it, named.
var errReturnMapMissing = errors.New("map these borrowed products for returns before ordering them")

// requireReturnMaps refuses an order carrying a BORROWED line the ordering team has not mapped for returns
// (a-borrowed-line-needs-its-map-at-create) — every such product named at once, so one attempt says everything that is
// missing.
//
// A line is borrowed when its owner is KNOWN and is not the ordering team. An own line is never looked up
// (an-own-line-never-touches-the-map), so an own-only order reads nothing here. A product whose owner did not resolve
// is not judged borrowed: it is a product nobody owns, which no return will ever bring back — and the take refuses it.
//
// One query, on the unique (team_id, shared_product_id) index. Before the order's transaction — a read, refused before
// anything is written or taken.
func (s *Service) requireReturnMaps(
	ctx context.Context,
	teamID uint64,
	items []*sellingv1.OrderItem,
	owners map[uint64]ProductSnapshot,
) error {
	var borrowed []uint64

	for _, id := range orderProductIDs(items) {
		owner := owners[id].TeamID
		if owner == 0 || owner == teamID {
			continue
		}

		borrowed = append(borrowed, id)
	}

	if len(borrowed) == 0 {
		return nil
	}

	var mapped []uint64

	err := s.db.
		WithContext(ctx).
		Model(&selling_service_models.ProductReturnMap{}).
		Where("team_id = ? AND shared_product_id IN ?", teamID, borrowed).
		Pluck("shared_product_id", &mapped).
		Error
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	has := make(map[uint64]bool, len(mapped))
	for _, id := range mapped {
		has[id] = true
	}

	var missing []string

	for _, id := range borrowed {
		if !has[id] {
			missing = append(missing, productLabel(id, owners[id]))
		}
	}

	if len(missing) > 0 {
		return connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("%w: %s", errReturnMapMissing, strings.Join(missing, ", ")))
	}

	return nil
}

// productLabel is how a refusal names a product to the person who has to act on it: its SKU, else its name, else its
// id — never a blank.
func productLabel(id uint64, snapshot ProductSnapshot) string {
	if snapshot.SKU != "" {
		return snapshot.SKU
	}

	if snapshot.Name != "" {
		return snapshot.Name
	}

	return "product " + strconv.FormatUint(id, 10)
}

func productReturnMapToProto(row *selling_service_models.ProductReturnMap) *sellingv1.ProductReturnMap {
	return &sellingv1.ProductReturnMap{
		TeamId:          row.TeamID,
		SharedProductId: row.SharedProductID,
		OwnProductId:    row.OwnProductID,
		CreatedAtUnix:   row.CreatedAt.Unix(),
	}
}
