package shipment_v1_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	shipment_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_v1"
)

// THE COURIER'S TRACKING LINK (an-orders-resi-links-to-the-couriers-tracking-page,
// the-tracking-link-prototype-is-accepted, a-tracking-link-must-carry-the-resi): root keeps one optional link per
// channel, `https://` and holding `{resi}`; List and ByIds carry it, a deleted channel's included.

const jneLink = "https://courier.example/track?awb={resi}"

// listedLink reads one channel's tracking_url back from ShipmentChannelList (deleted ones included).
func listedLink(t *testing.T, svc *shipment_v1.Service, id uint64) string {
	t.Helper()

	resp := list(t, svc, &shipmentv1.ShipmentChannelListFilter{IncludeDeleted: true}, 1, 200)

	for _, it := range resp.GetItems() {
		if c := it.GetChannel(); c != nil {
			got, ok := c.GetMapData()[id]
			if !ok {
				t.Fatalf("channel %d is not on the list", id)
			}

			return got.GetTrackingUrl()
		}
	}

	t.Fatal("the list has no CHANNEL slice")

	return ""
}

// byIdsChannel reads one channel back from ShipmentChannelByIds.
func byIdsChannel(t *testing.T, svc *shipment_v1.Service, id uint64) *shipmentv1.ShipmentChannel {
	t.Helper()

	resp, err := svc.ShipmentChannelByIds(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelByIdsRequest{
		Filter: &shipmentv1.ShipmentChannelByIdsFilter{Ids: []uint64{id}},
	}))
	if err != nil {
		t.Fatalf("ShipmentChannelByIds: %v", err)
	}

	for _, it := range resp.Msg.GetItems()[id].GetItems() {
		if c := it.GetChannel(); c != nil {
			return c.GetMapData()[id]
		}
	}

	t.Fatalf("channel %d did not resolve by id", id)

	return nil
}

// connectMessage is the refusal's own words, without the code connect prefixes.
func connectMessage(t *testing.T, err error) string {
	t.Helper()

	var cerr *connect.Error
	if !errors.As(err, &cerr) {
		t.Fatalf("not a connect error: %v", err)
	}

	return cerr.Message()
}

// storedLink is the row's own column — what the next read will serve.
func storedLink(t *testing.T, db *gorm.DB, id uint64) string {
	t.Helper()

	var link string

	err := db.
		Raw("SELECT tracking_url FROM shipment_channels WHERE id = ?", id).
		Scan(&link).
		Error
	if err != nil {
		t.Fatalf("read tracking_url: %v", err)
	}

	return link
}

func updateLink(svc *shipment_v1.Service, id uint64, name, link string) (*shipmentv1.ShipmentChannel, error) {
	resp, err := svc.ShipmentChannelUpdate(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelUpdateRequest{
		ChannelId:   id,
		Name:        name,
		TrackingUrl: link,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetChannel(), nil
}

// A new courier with its link: the create answers it, and List and ByIds read it back.
func TestShipmentChannelCreate_KeepsItsTrackingLink(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.ShipmentChannelCreate(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelCreateRequest{
		Code:        "ninja",
		Name:        "Ninja Xpress",
		TrackingUrl: "  https://ninja.example/track/{resi}  ",
	}))
	if err != nil {
		t.Fatalf("ShipmentChannelCreate: %v", err)
	}

	const want = "https://ninja.example/track/{resi}"

	got := resp.Msg.GetChannel()
	if got.GetTrackingUrl() != want {
		t.Fatalf("created tracking_url = %q, want %q (trimmed)", got.GetTrackingUrl(), want)
	}

	if link := listedLink(t, svc, got.GetId()); link != want {
		t.Errorf("List tracking_url = %q, want %q", link, want)
	}

	if link := byIdsChannel(t, svc, got.GetId()).GetTrackingUrl(); link != want {
		t.Errorf("ByIds tracking_url = %q, want %q", link, want)
	}
}

// The link is optional: a courier made without one has none, and every seeded courier starts with none (00003 seeds
// no address — they were never checked against the couriers' sites).
func TestShipmentChannelCreate_ALinkIsOptional(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	got := mustCreate(t, svc, "ninja", "Ninja Xpress")
	if got.GetTrackingUrl() != "" || storedLink(t, db, got.GetId()) != "" {
		t.Fatalf("a channel made with no link has %q", got.GetTrackingUrl())
	}

	var withLink int64

	err := db.
		Raw("SELECT COUNT(*) FROM shipment_channels WHERE tracking_url <> '' AND code IN ('jne', 'jnt', 'sicepat', 'pos')").
		Scan(&withLink).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if withLink != 0 {
		t.Fatalf("%d seeded couriers carry a link, want none", withLink)
	}
}

// Update sets the link, a second update changes it, and an empty one CLEARS it — every editable field is written as
// sent (the link is editable like name and desc; a-code-never-changes 🔄). The code never moves.
func TestShipmentChannelUpdate_SetsChangesAndClearsTheLink(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	jne := seeded(t, db, "jne")

	got, err := updateLink(svc, jne.ID, jne.Name, jneLink)
	if err != nil {
		t.Fatalf("set: %v", err)
	}

	if got.GetTrackingUrl() != jneLink || got.GetCode() != "jne" || storedLink(t, db, jne.ID) != jneLink {
		t.Fatalf("after set = %+v, stored %q", got, storedLink(t, db, jne.ID))
	}

	const changed = "https://courier.example/{resi}?lang=id"

	got, err = updateLink(svc, jne.ID, jne.Name, changed)
	if err != nil {
		t.Fatalf("change: %v", err)
	}

	if got.GetTrackingUrl() != changed || storedLink(t, db, jne.ID) != changed {
		t.Fatalf("after change = %q, stored %q", got.GetTrackingUrl(), storedLink(t, db, jne.ID))
	}

	got, err = updateLink(svc, jne.ID, jne.Name, "")
	if err != nil {
		t.Fatalf("clear: %v", err)
	}

	if got.GetTrackingUrl() != "" || storedLink(t, db, jne.ID) != "" {
		t.Fatalf("after clear = %q, stored %q — an empty link must clear it", got.GetTrackingUrl(), storedLink(t, db, jne.ID))
	}
}

// The refusals, each for its own reason — on create AND on update, and nothing is written.
func TestShipmentChannelTrackingLink_RefusesEachForItsOwnReason(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	jne := seeded(t, db, "jne")

	_, err := updateLink(svc, jne.ID, jne.Name, jneLink)
	if err != nil {
		t.Fatalf("seed the link: %v", err)
	}

	const (
		notHTTPS = "the tracking link must start with https://"
		noResi   = "the tracking link must hold {resi} where the resi goes"
		notAURL  = "the tracking link is not a web address"
	)

	cases := []struct {
		name string
		link string
		want string
	}{
		{"http", "http://courier.example/track?awb={resi}", notHTTPS},
		{"no scheme", "courier.example/track?awb={resi}", notHTTPS},
		{"script", "javascript:alert({resi})", notHTTPS},
		{"no resi", "https://courier.example/track", noResi},
		{"resi in capitals", "https://courier.example/track?awb={RESI}", noResi},
		{"https and nothing", "https://", noResi},
		{"a space in the host", "https:// courier.example/{resi}", notAURL},
		{"a space in the path", "https://courier.example/track {resi}", notAURL},
		{"no host", "https:///track/{resi}", notAURL},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.ShipmentChannelCreate(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelCreateRequest{
				Code:        "ninja",
				Name:        "Ninja Xpress",
				TrackingUrl: tc.link,
			}))
			if code := connectCode(t, err); code != connect.CodeInvalidArgument {
				t.Fatalf("create: code = %v, want InvalidArgument", code)
			}

			if msg := connectMessage(t, err); msg != tc.want {
				t.Errorf("create: message = %q, want %q", msg, tc.want)
			}

			var made int64

			err = db.
				Raw("SELECT COUNT(*) FROM shipment_channels WHERE code = 'ninja'").
				Scan(&made).
				Error
			if err != nil {
				t.Fatalf("count: %v", err)
			}

			if made != 0 {
				t.Fatal("a refused create still wrote the channel")
			}

			_, err = updateLink(svc, jne.ID, "JNE renamed", tc.link)
			if code := connectCode(t, err); code != connect.CodeInvalidArgument {
				t.Fatalf("update: code = %v, want InvalidArgument", code)
			}

			if msg := connectMessage(t, err); msg != tc.want {
				t.Errorf("update: message = %q, want %q", msg, tc.want)
			}

			if seen := seeded(t, db, "jne"); seen.Name != jne.Name || storedLink(t, db, jne.ID) != jneLink {
				t.Fatalf("a refused update still wrote: name %q, link %q", seen.Name, storedLink(t, db, jne.ID))
			}
		})
	}
}

// The edge cases the screen's rule takes (trackingLink.test.ts) — the server takes them too.
func TestShipmentChannelTrackingLink_TakesWhatTheScreenTakes(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	jne := seeded(t, db, "jne")

	for _, link := range []string{
		"https://courier.example/track?awb={resi}",
		"HTTPS://courier.example/{resi}",
		"https://courier.example/{resi}?awb={resi}",
		"https://{resi}",
	} {
		_, err := updateLink(svc, jne.ID, jne.Name, link)
		if err != nil {
			t.Errorf("%q refused: %v", link, err)
		}
	}
}

// A DELETED courier's link still opens for its old orders (a-deleted-channel-still-resolves-by-id): ByIds and the
// list with deleted channels both carry it, beside the flag.
func TestShipmentChannelTrackingLink_ADeletedChannelStillResolvesWithItsLink(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	pos := seeded(t, db, "pos")

	_, err := updateLink(svc, pos.ID, pos.Name, "https://pos.example/tracking?barcode={resi}")
	if err != nil {
		t.Fatalf("set: %v", err)
	}

	_, err = svc.ShipmentChannelDelete(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelDeleteRequest{ChannelId: pos.ID}))
	if err != nil {
		t.Fatalf("delete: %v", err)
	}

	got := byIdsChannel(t, svc, pos.ID)
	if !got.GetIsDeleted() || got.GetTrackingUrl() != "https://pos.example/tracking?barcode={resi}" {
		t.Fatalf("deleted pos by id = deleted %v, link %q — want flagged and still linked", got.GetIsDeleted(), got.GetTrackingUrl())
	}

	if link := listedLink(t, svc, pos.ID); link != "https://pos.example/tracking?barcode={resi}" {
		t.Fatalf("deleted pos on the list = %q", link)
	}
}

// The table refuses a link that breaks the rule even when a write skips the handler (00003's CHECK): not https, or
// no {resi}.
func TestShipmentChannelTrackingLink_TheTableRefusesABadLink(t *testing.T) {
	for _, link := range []string{"http://courier.example/{resi}", "https://courier.example/track"} {
		t.Run(link, func(t *testing.T) {
			db := san_testdb.DB(t)

			err := db.
				Exec("UPDATE shipment_channels SET tracking_url = ? WHERE code = 'jne'", link).
				Error
			if err == nil {
				t.Fatalf("the table took %q", link)
			}
		})
	}
}

// ROOT ONLY (only-root-manages-channels): the link is written by Create and Update alone, and both stay root's —
// exactly ROLE_ROOT, never public, never scoped to a team.
func TestShipmentChannelTrackingLink_OnlyRootWritesIt(t *testing.T) {
	for _, name := range []string{
		"warehouse.shipment.v1.ShipmentChannelCreateRequest",
		"warehouse.shipment.v1.ShipmentChannelUpdateRequest",
	} {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(name))
		if err != nil {
			t.Fatalf("descriptor %s: %v", name, err)
		}

		md := desc.(protoreflect.MessageDescriptor)

		if md.Fields().ByName("tracking_url") == nil {
			t.Fatalf("%s carries no tracking_url", name)
		}

		policy := san_auth.PolicyOf(md)
		if policy == nil {
			t.Fatalf("%s has no policy", name)
		}

		if policy.GetAllowAll() {
			t.Fatalf("%s is public", name)
		}

		if got := policy.GetRoles(); !slices.Equal(got, []role_basev1.Role{role_basev1.Role_ROLE_ROOT}) {
			t.Fatalf("%s roles = %v, want exactly ROLE_ROOT", name, got)
		}
	}
}
