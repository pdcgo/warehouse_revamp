package user_v1_test

import (
	"context"
	"errors"
	"strconv"
	"testing"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// sentEvents records what a service published; `fail` makes every publish fail, as a broker that is down would.
type sentEvents struct {
	events []*eventsv1.Event
	fail   bool
}

func (s *sentEvents) send(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	err := protovalidate.Validate(event)
	if err != nil {
		return err
	}

	s.events = append(s.events, event)

	if s.fail {
		return errors.New("the broker is down")
	}

	return nil
}

func newServiceWithEvents(t *testing.T, db *gorm.DB, sent *sentEvents) *user_v1.Service {
	t.Helper()

	resolver := access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager())

	return user_v1.NewService(db, testSigner(), resolver, testTeams(), &fakePhotos{}, san_caches.NewSkipCacheManager(), sent.send)
}

// removing-a-member-drops-their-shop-access: a removal is announced once, after it commits — naming the team, the
// person and who removed them, keyed on its membership-log row and dated by it.
func TestTeamUserUpdate_ARemovalIsAnnounced(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &sentEvents{}
	svc := newServiceWithEvents(t, db, sent)

	owner, ownerID := asMember(t, db, "sellowner", sellTeam, role_basev1.Role_ROLE_SELLING_OWNER)
	cs := memberOf(t, db, "sellcs", sellTeam, role_basev1.Role_ROLE_SELLING_CS)

	_, err := svc.TeamUserUpdate(owner, remove(sellTeam, cs))
	if err != nil {
		t.Fatalf("remove: %v", err)
	}

	if len(sent.events) != 1 {
		t.Fatalf("%d events, want one MemberRemoved", len(sent.events))
	}

	event := sent.events[0]
	removed := event.GetMemberRemoved()

	if removed.GetTeamId() != sellTeam || removed.GetUserId() != cs || removed.GetActorId() != ownerID {
		t.Fatalf("announced %+v, want team %d, user %d, by %d", removed, sellTeam, cs, ownerID)
	}

	var row user_service_models.TeamMemberLog

	err = db.Where("team_id = ? AND user_id = ?", sellTeam, cs).Order("id DESC").First(&row).Error
	if err != nil {
		t.Fatalf("the log row: %v", err)
	}

	if event.GetEventId() != "team-member-log:"+strconv.FormatUint(row.ID, 10) {
		t.Fatalf("event id %q, want the log row's", event.GetEventId())
	}

	if !event.GetOccurredAt().AsTime().Equal(row.CreatedAt) {
		t.Fatalf("occurred %v, want the log row's %v", event.GetOccurredAt().AsTime(), row.CreatedAt)
	}
}

// Nothing removed, nothing announced: a refused removal, and the removal of somebody who is not a member.
func TestTeamUserUpdate_NoRemovalNoAnnouncement(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &sentEvents{}
	svc := newServiceWithEvents(t, db, sent)

	cs, _ := asMember(t, db, "sellcs", sellTeam, role_basev1.Role_ROLE_SELLING_CS)
	owner := memberOf(t, db, "sellowner", sellTeam, role_basev1.Role_ROLE_SELLING_OWNER)
	stranger := insertUser(t, db, "stranger", "pw12345678")

	_, err := svc.TeamUserUpdate(cs, remove(sellTeam, owner))
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("Customer Service removing the Owner: %v, want PermissionDenied", err)
	}

	_, err = svc.TeamUserUpdate(asRoot(t, db), remove(sellTeam, stranger))
	if err != nil {
		t.Fatalf("removing a non-member: %v, want the no-op", err)
	}

	if len(sent.events) != 0 {
		t.Fatalf("announced %d removals that did not happen", len(sent.events))
	}
}

// A broker that is down never undoes a removal: the person is out of the team, and the failure is logged.
func TestTeamUserUpdate_ARemovalStandsWhenTheBrokerIsDown(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &sentEvents{fail: true}
	svc := newServiceWithEvents(t, db, sent)

	cs := memberOf(t, db, "sellcs", sellTeam, role_basev1.Role_ROLE_SELLING_CS)

	_, err := svc.TeamUserUpdate(asRoot(t, db), remove(sellTeam, cs))
	if err != nil {
		t.Fatalf("remove with the broker down: %v, want success", err)
	}

	if role := roleOf(t, db, sellTeam, cs); role != role_basev1.Role_ROLE_UNSPECIFIED {
		t.Fatalf("still %s in the team", role)
	}
}
