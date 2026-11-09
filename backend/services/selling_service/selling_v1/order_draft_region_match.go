package selling_v1

import (
	"context"
	"log/slog"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// RegionMatcher finds the ONE region_service place a draft's four region names name — region_service's RegionMatch
// (exact on every level after normalising case, spacing and the Kabupaten / Kab. / Kota prefix) — for the order form's
// address pre-fill (the-cs-edits-the-whole-address-before-create, *Pre-filled when certain*). nil, nil = no unique
// match. An interface this service owns, so selling_service never imports region_service: the composition root answers
// it in-process (cmd/app_development/order_draft_regions.go).
type RegionMatcher interface {
	MatchRegion(ctx context.Context, provinsi, kabupaten, kecamatan, desa string) (*sellingv1.OrderAddress, error)
}

// draftRegionMatch is OrderDraftDetail's `region_match`: the place the draft's names match, or nil — when a level is
// blank (a match on fewer levels names an area, not a place), when no matcher is wired, and when the lookup fails. A
// pre-fill is a convenience, so a failed one leaves the form's dropdowns empty for the person to pick rather than
// failing the draft's read; the failure is logged.
func (s *Service) draftRegionMatch(
	ctx context.Context,
	address *selling_service_models.OrderDraftAddress,
) *sellingv1.OrderAddress {
	if s.regions == nil || address == nil {
		return nil
	}

	if address.ProvinsiName == "" || address.KabupatenName == "" || address.KecamatanName == "" ||
		address.DesaName == "" {
		return nil
	}

	match, err := s.regions.MatchRegion(ctx, address.ProvinsiName, address.KabupatenName, address.KecamatanName,
		address.DesaName)
	if err != nil {
		slog.WarnContext(ctx, "order draft: the address pre-fill lookup failed — the form opens with empty dropdowns",
			"order_draft_id", address.OrderDraftID, "error", err)

		return nil
	}

	return match
}
