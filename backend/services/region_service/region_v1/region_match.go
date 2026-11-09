package region_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"

	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_service_models"
)

// matchCandidateLimit bounds the first read: desa rows whose name STARTS WITH the asked desa. The commonest desa name in
// the seed (Sidomulyo) names 98 desa, so a thousand is far above any real name, and a pathological one is refused as
// "no match" rather than read whole.
const matchCandidateLimit = 1000

// The kabupaten level's two kinds, read off a name's prefix. Every level-2 name in the seed starts with one of them.
const (
	kindAny       = ""
	kindKabupaten = "kabupaten"
	kindKota      = "kota"
)

// kabupatenPrefixes are the spellings a marketplace writes the kind in, longest first so "kab. " wins over "kab ".
// "administrasi" follows the kind on Jakarta's six (Kota Administrasi Jakarta Pusat), and nobody types it.
var kabupatenPrefixes = []struct {
	prefix string
	kind   string
}{
	{"kabupaten ", kindKabupaten},
	{"kab. ", kindKabupaten},
	{"kab.", kindKabupaten},
	{"kab ", kindKabupaten},
	{"kota ", kindKota},
}

// RegionMatch answers the draft address's pre-fill (the-cs-edits-the-whole-address-before-create, *Pre-filled when
// certain*): the ONE desa four plain names point at, or none.
//
// EXACT, after normalising what a person would not call a difference: case, runs of spaces, and the kabupaten level's
// Kabupaten / Kab. / Kab / Kota prefix (a prefix the caller wrote must agree with the place's — "Kab. Bogor" is never
// Kota Bogor; no prefix matches either). Nothing fuzzy: a near miss pre-filled would look like a person's pick, so it
// is left for the person. Several matches (a name with no prefix fitting a Kota and a Kabupaten, or two desa of one name
// in one kecamatan) answer no match too.
//
// Two queries, never N+1: the desa candidates through `regions_name_lower_idx` (a prefix LIKE, so a stored trailing
// space cannot hide a row), then every exact candidate's ancestors at once by primary key.
func (s *Service) RegionMatch(
	ctx context.Context,
	req *connect.Request[regionv1.RegionMatchRequest],
) (*connect.Response[regionv1.RegionMatchResponse], error) {
	provinsi := normaliseName(req.Msg.GetProvinsiName())
	kabupaten := splitKabupaten(req.Msg.GetKabupatenName())
	kecamatan := normaliseName(req.Msg.GetKecamatanName())
	desa := normaliseName(req.Msg.GetDesaName())

	// A blank level names an area, not a place — validation refuses it on the wire; a direct caller gets no match.
	if provinsi == "" || kabupaten.base == "" || kecamatan == "" || desa == "" {
		return connect.NewResponse(&regionv1.RegionMatchResponse{}), nil
	}

	var candidates []region_service_models.Region

	err := s.db.
		WithContext(ctx).
		Where("level = ? AND LOWER(name) LIKE ?", region_service_models.LevelDesa, escapeLike(desa)+"%").
		Order("code ASC").
		Limit(matchCandidateLimit).
		Find(&candidates).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	codes := make([]string, 0, len(candidates)*3)
	seen := make(map[string]bool, len(candidates)*3)
	exact := make([]string, 0, len(candidates))

	for _, candidate := range candidates {
		if normaliseName(candidate.Name) != desa {
			continue
		}

		exact = append(exact, candidate.Code)

		// Desa of one name share provinsi and kabupaten often — each ancestor is asked for once.
		for _, code := range ancestorCodes(candidate.Code) {
			if !seen[code] {
				seen[code] = true
				codes = append(codes, code)
			}
		}
	}

	byCode, err := s.loadByCodes(s.db.WithContext(ctx), codes)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var matched []string

	for _, code := range exact {
		ancestry := buildAncestry(byCode, code)

		if normaliseName(ancestry.GetProvinsiName()) != provinsi ||
			normaliseName(ancestry.GetKecamatanName()) != kecamatan ||
			!kabupaten.fits(splitKabupaten(ancestry.GetKabupatenName())) {
			continue
		}

		matched = append(matched, code)
	}

	out := &regionv1.RegionMatchResponse{Matches: uint32(min(len(matched), 2))}
	if len(matched) == 1 {
		out.Match = buildAncestry(byCode, matched[0])
	}

	return connect.NewResponse(out), nil
}

// normaliseName is the comparison form of a region name: lower case, trimmed, every run of spaces one space.
func normaliseName(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), " "))
}

// kabupatenName is a level-2 name split into its kind (from its prefix, or kindAny when it has none) and the rest.
type kabupatenName struct {
	kind string
	base string
}

func splitKabupaten(name string) kabupatenName {
	normal := normaliseName(name)

	for _, p := range kabupatenPrefixes {
		if !strings.HasPrefix(normal, p.prefix) {
			continue
		}

		base := strings.TrimSpace(strings.TrimPrefix(normal, p.prefix))
		base = strings.TrimPrefix(base, "administrasi ")

		return kabupatenName{kind: p.kind, base: base}
	}

	return kabupatenName{kind: kindAny, base: normal}
}

// fits says whether the asked name names the place's level-2 region: the same rest, and the same kind when the asker
// wrote one.
func (asked kabupatenName) fits(place kabupatenName) bool {
	if asked.base != place.base {
		return false
	}

	return asked.kind == kindAny || asked.kind == place.kind
}
