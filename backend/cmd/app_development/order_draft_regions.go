package main

import (
	"context"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"

	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	region_v1 "github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_v1"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// draftRegionMatcher answers selling's RegionMatcher from region_service: the one place a draft's four region names
// name, for the order form's address pre-fill (the-cs-edits-the-whole-address-before-create, *Pre-filled when
// certain*). It calls the RegionMatch handler in-process, so the matching rule lives once, in the service that owns the
// region list.
type draftRegionMatcher struct {
	regions *region_v1.Service
}

func NewDraftRegionMatcher(regions *region_v1.Service) selling_v1.RegionMatcher {
	return &draftRegionMatcher{regions: regions}
}

func (m *draftRegionMatcher) MatchRegion(
	ctx context.Context,
	provinsi, kabupaten, kecamatan, desa string,
) (*sellingv1.OrderAddress, error) {
	req := &regionv1.RegionMatchRequest{
		ProvinsiName:  provinsi,
		KabupatenName: kabupaten,
		KecamatanName: kecamatan,
		DesaName:      desa,
	}

	// A handler called directly gets no validation interceptor. A name the request refuses (over 100 characters) names
	// no place in the region list, so it is no match, not an error.
	err := protovalidate.Validate(req)
	if err != nil {
		return nil, nil
	}

	resp, err := m.regions.RegionMatch(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, err
	}

	match := resp.Msg.GetMatch()
	if match == nil {
		return nil, nil
	}

	return &sellingv1.OrderAddress{
		ProvinsiCode:  match.GetProvinsiCode(),
		ProvinsiName:  match.GetProvinsiName(),
		KabupatenCode: match.GetKabupatenCode(),
		KabupatenName: match.GetKabupatenName(),
		KecamatanCode: match.GetKecamatanCode(),
		KecamatanName: match.GetKecamatanName(),
		DesaCode:      match.GetDesaCode(),
		DesaName:      match.GetDesaName(),
		KodePos:       match.GetKodePos(),
	}, nil
}
