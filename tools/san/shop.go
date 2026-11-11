package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"slices"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"github.com/urfave/cli/v3"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// rolloutPage is the page size of every list the rollout walks — the most CommonPagination takes.
const rolloutPage = 200

// NewShopGrants is selling_service as the operations tool needs it: the shop list, the grant list and ShopUserAdd. The
// role reader is user_service's cached resolver — the same one the server wires — because ShopUserAdd refuses anyone
// who is not a member of the shop's team or is suspended (refuseUngrantable). Nothing else is wired: no command here
// places an order, so stock, credit, fees, labels and exports stay nil, and its events fall to EmptySender.
func NewShopGrants(db *gorm.DB, resolver access_interceptors.RoleResolver) *selling_v1.Service {
	return selling_v1.NewService(db, nil, nil, nil, nil, sanRoleReader{resolver: resolver}, nil, nil, nil, nil, nil)
}

// sanRoleReader answers selling's RoleReader from user_service's resolver — the server's adapter, in this binary.
type sanRoleReader struct {
	resolver access_interceptors.RoleResolver
}

func (r sanRoleReader) Roles(ctx context.Context, userID, teamID uint64) (role_basev1.Role, role_basev1.Role, error) {
	access, err := r.resolver.Resolve(ctx, userID, teamID)
	if err != nil {
		return role_basev1.Role_ROLE_UNSPECIFIED, role_basev1.Role_ROLE_UNSPECIFIED, err
	}

	return access.Role, access.RootRole, nil
}

func (r sanRoleReader) Member(ctx context.Context, userID, teamID uint64) (selling_v1.TeamMember, error) {
	access, err := r.resolver.Resolve(ctx, userID, teamID)
	if err != nil {
		return selling_v1.TeamMember{}, err
	}

	return selling_v1.TeamMember{Role: access.Role, Suspended: access.Suspended}, nil
}

// shopCommand is selling_service's operator actions: today, the rollout grant of a-write-needs-a-grant-or-a-manager.
func shopCommand() *cli.Command {
	return &cli.Command{
		Name:  "shop",
		Usage: "selling_service shop operations",
		Commands: []*cli.Command{
			{
				Name:      "grant-current-cs",
				Usage:     "grant every current CS every live shop of their team — the rollout of the shop write gate, once",
				ArgsUsage: " ",
				Description: "One-shot, and safe to run again (a-write-needs-a-grant-or-a-manager: \"in the release that turns the\n" +
					"gate on, every current CS is granted every shop of their team\"). For every live selling team (team_service\n" +
					"TeamList) it reads the team's current CS — role CS, not suspended, not erased (user_service UserList) — and\n" +
					"the team's open shops (ShopList) with who already holds each (ShopUserList), then grants each missing\n" +
					"(shop, CS) pair through ShopUserAdd, so membership is re-checked and the primary rule applies: an existing\n" +
					"primary is never touched, and a shop with none gets the first CS granted (lowest user id) as its primary\n" +
					"(the-primary-cs-is-a-flag-on-a-grant). A grant that exists is skipped, so a second run adds nothing.\n" +
					"Owners and admins get nothing — they write on every shop without one. --dry-run writes nothing and prints\n" +
					"exactly what a real run would add.",
				Flags: []cli.Flag{
					&cli.BoolFlag{Name: "dry-run", Usage: "print what would be granted, write nothing"},
				},
				Action: runShopGrantCurrentCS,
			},
		},
	}
}

func runShopGrantCurrentCS(ctx context.Context, cmd *cli.Command) error {
	return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
		dryRun := cmd.Bool("dry-run")

		report, err := san.GrantCurrentCS(ctx, dryRun, log.Writer())
		if err != nil {
			return err
		}

		log.Printf("[%s] %s", san.target, report.Summary(dryRun))

		return nil
	})
}

// RolloutReport is what one run of the rollout did, or — in a dry run — would do.
type RolloutReport struct {
	Teams     int // live selling teams walked
	CSUsers   int // current CS across them, a person in two teams counted in each
	Shops     int // live shops across them
	Added     int // grants written (or, dry, that would be)
	Skipped   int // (shop, CS) pairs already granted — left as they are
	Primaries int // of Added, the grants that became their shop's primary CS
}

// Summary is the one line an operator reads.
func (r RolloutReport) Summary(dryRun bool) string {
	head, added, primary := "shop grant-current-cs", "added", "became"
	if dryRun {
		head, added, primary = "shop grant-current-cs DRY RUN, nothing written", "would be added", "would become"
	}

	return fmt.Sprintf("%s: %d teams, %d CS users, %d live shops — %d grants %s (%d %s a shop's primary CS), %d skipped (already granted)",
		head, r.Teams, r.CSUsers, r.Shops, r.Added, added, r.Primaries, primary, r.Skipped)
}

// errRolloutUnmigrated refuses a database that does not hold the tables the rollout reads — a wrong --dsn, or a fresh
// database nobody migrated. Without it, the run would "succeed" with 0 teams and look like a rollout that happened.
var errRolloutUnmigrated = errors.New("this database has no selling/user/team schema — wrong --dsn, or run `san migrate up-all` first")

// rolloutCS is one current CS of a team.
type rolloutCS struct {
	id       uint64
	username string
}

// GrantCurrentCS is the rollout grant. Every read and the write go through the owning service's handler — team_service
// for the teams, user_service for the members, selling_service for the shops and the grants — so no service's table is
// read by another's code, and every grant is the one the shop's access screen would make. Each request is validated
// first: a handler called directly gets no validation interceptor (HARD RULE 3b).
//
// Each grant line is written to out as it happens, so an interrupted run still says what it did.
func (s *San) GrantCurrentCS(ctx context.Context, dryRun bool, out io.Writer) (RolloutReport, error) {
	var report RolloutReport

	for _, table := range []string{"teams", "user_team_roles", "shops", "shop_users"} {
		if !s.db.WithContext(ctx).Migrator().HasTable(table) {
			return report, fmt.Errorf("%w (no %s table)", errRolloutUnmigrated, table)
		}
	}

	teams, err := s.sellingTeams(ctx)
	if err != nil {
		return report, err
	}

	for _, team := range teams {
		cs, err := s.currentCS(ctx, team.GetId())
		if err != nil {
			return report, err
		}

		shops, err := s.liveShops(ctx, team.GetId())
		if err != nil {
			return report, err
		}

		report.Teams++
		report.CSUsers += len(cs)
		report.Shops += len(shops)

		fmt.Fprintf(out, "team %d %s: %d CS, %d live shops\n", team.GetId(), team.GetName(), len(cs), len(shops))

		for _, shop := range shops {
			granted, err := s.shopGrants(ctx, team.GetId(), shop.GetId())
			if err != nil {
				return report, err
			}

			hasPrimary := shop.GetPrimaryUserId() != 0

			for _, person := range cs {
				if granted[person.id] {
					report.Skipped++

					continue
				}

				// The handler's own rule, predicted for the line: a new grant on a shop with no primary becomes it.
				note := ""
				if !hasPrimary {
					note = " — becomes its primary CS"
					hasPrimary = true
					report.Primaries++
				}

				if !dryRun {
					err = s.addShopGrant(ctx, team.GetId(), shop.GetId(), person.id)
					if err != nil {
						return report, fmt.Errorf("grant %s (#%d) on %s (#%d): %w", person.username, person.id, shop.GetName(), shop.GetId(), err)
					}
				}

				report.Added++

				verb := "granted"
				if dryRun {
					verb = "would grant"
				}

				fmt.Fprintf(out, "  %s %s (#%d) on %s (#%d)%s\n", verb, person.username, person.id, shop.GetName(), shop.GetId(), note)
			}
		}
	}

	return report, nil
}

// sellingTeams is every live selling team, by id — team_service's TeamList.
func (s *San) sellingTeams(ctx context.Context) ([]*teamv1.TeamRowItem, error) {
	var teams []*teamv1.TeamRowItem

	for page := uint32(1); ; page++ {
		req := &teamv1.TeamListRequest{
			Filter:      &teamv1.TeamListFilter{TeamType: teamv1.TeamType_TEAM_TYPE_SELLING},
			Sort:        &teamv1.TeamListFilterSort{S: &teamv1.TeamListFilterSort_Team{Team: teamv1.TeamRowSort_TEAM_ROW_SORT_ID}, SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC},
			DataRequest: []teamv1.TeamListDataType{teamv1.TeamListDataType_TEAM_LIST_DATA_TYPE_TEAM},
			Page:        &commonv1.CommonPagination{Page: page, Limit: rolloutPage},
		}

		res, err := callHandler(ctx, req, s.teams.TeamList)
		if err != nil {
			return nil, fmt.Errorf("team list: %w", err)
		}

		rows := map[uint64]*teamv1.TeamRowItem{}
		for _, item := range res.GetItems() {
			for id, row := range item.GetTeam().GetMapData() {
				rows[id] = row
			}
		}

		for _, id := range res.GetIds() {
			if rows[id] != nil {
				teams = append(teams, rows[id])
			}
		}

		if page >= res.GetPageInfo().GetTotalPage() {
			break
		}
	}

	slices.SortFunc(teams, func(a, b *teamv1.TeamRowItem) int { return cmpID(a.GetId(), b.GetId()) })

	return teams, nil
}

// currentCS is the team's current customer service — role CS, and neither suspended nor erased, exactly as the grant
// picker offers them (a-suspended-user-is-never-picked) — through user_service's UserList, lowest id first.
func (s *San) currentCS(ctx context.Context, teamID uint64) ([]rolloutCS, error) {
	var cs []rolloutCS

	for page := uint32(1); ; page++ {
		req := &userv1.UserListRequest{
			TeamId: teamID,
			Filter: &userv1.UserListFilter{ExcludeSuspended: true},
			DataRequest: []userv1.UserListDataType{
				userv1.UserListDataType_USER_LIST_DATA_TYPE_USER,
				userv1.UserListDataType_USER_LIST_DATA_TYPE_MEMBERSHIP,
			},
			Page: &commonv1.CommonPagination{Page: page, Limit: rolloutPage},
		}

		res, err := callHandler(ctx, req, s.users.UserList)
		if err != nil {
			return nil, fmt.Errorf("team %d members: %w", teamID, err)
		}

		users := map[uint64]*userv1.User{}
		roles := map[uint64]role_basev1.Role{}

		for _, item := range res.GetItems() {
			for id, user := range item.GetUser().GetMapData() {
				users[id] = user
			}

			for id, membership := range item.GetMembership().GetMapData() {
				roles[id] = membership.GetRole()
			}
		}

		for _, id := range res.GetIds() {
			if roles[id] == role_basev1.Role_ROLE_SELLING_CS {
				cs = append(cs, rolloutCS{id: id, username: users[id].GetUsername()})
			}
		}

		if page >= res.GetPageInfo().GetTotalPage() {
			break
		}
	}

	slices.SortFunc(cs, func(a, b rolloutCS) int { return cmpID(a.id, b.id) })

	return slices.CompactFunc(cs, func(a, b rolloutCS) bool { return a.id == b.id }), nil
}

// liveShops is the team's OPEN shops — ShopList's `status` OPEN, never a closed one (a-shop-is-closed-never-deleted) —
// each carrying its primary CS.
func (s *San) liveShops(ctx context.Context, teamID uint64) ([]*sellingv1.Shop, error) {
	byID := map[uint64]*sellingv1.Shop{}

	for page := uint32(1); ; page++ {
		req := &sellingv1.ShopListRequest{
			TeamId:      teamID,
			Filter:      &sellingv1.ShopListFilter{Status: sellingv1.ShopListStatus_SHOP_LIST_STATUS_OPEN},
			DataRequest: []sellingv1.ShopListDataType{sellingv1.ShopListDataType_SHOP_LIST_DATA_TYPE_SHOP},
			Page:        &commonv1.CommonPagination{Page: page, Limit: rolloutPage},
		}

		res, err := callHandler(ctx, req, s.shops.ShopList)
		if err != nil {
			return nil, fmt.Errorf("team %d shops: %w", teamID, err)
		}

		for _, item := range res.GetItems() {
			for id, shop := range item.GetShop().GetMapData() {
				byID[id] = shop
			}
		}

		if page >= res.GetPageInfo().GetTotalPage() {
			break
		}
	}

	shops := make([]*sellingv1.Shop, 0, len(byID))
	for _, shop := range byID {
		shops = append(shops, shop)
	}

	slices.SortFunc(shops, func(a, b *sellingv1.Shop) int { return cmpID(a.GetId(), b.GetId()) })

	return shops, nil
}

// shopGrants is who already holds the shop — selling_service's ShopUserList.
func (s *San) shopGrants(ctx context.Context, teamID, shopID uint64) (map[uint64]bool, error) {
	granted := map[uint64]bool{}

	for page := uint32(1); ; page++ {
		req := &sellingv1.ShopUserListRequest{
			TeamId: teamID,
			Filter: &sellingv1.ShopUserListFilter{ShopId: shopID},
			Page:   &commonv1.CommonPagination{Page: page, Limit: rolloutPage},
		}

		res, err := callHandler(ctx, req, s.shops.ShopUserList)
		if err != nil {
			return nil, fmt.Errorf("shop %d grants: %w", shopID, err)
		}

		for _, id := range res.GetIds() {
			granted[id] = true
		}

		if page >= res.GetPageInfo().GetTotalPage() {
			break
		}
	}

	return granted, nil
}

// addShopGrant is ShopUserAdd — the very call the shop's access screen makes.
func (s *San) addShopGrant(ctx context.Context, teamID, shopID, userID uint64) error {
	req := &sellingv1.ShopUserAddRequest{TeamId: teamID, ShopId: shopID, UserId: userID}

	_, err := callHandler(ctx, req, s.shops.ShopUserAdd)

	return err
}

// callHandler validates a request as the server's interceptor would, then calls the handler directly.
func callHandler[Req, Res any](
	ctx context.Context,
	req *Req,
	handler func(context.Context, *connect.Request[Req]) (*connect.Response[Res], error),
) (*Res, error) {
	msg, ok := any(req).(proto.Message)
	if !ok {
		return nil, fmt.Errorf("%T is not a proto message", req)
	}

	err := protovalidate.Validate(msg)
	if err != nil {
		return nil, err
	}

	res, err := handler(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func cmpID(a, b uint64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	default:
		return 0
	}
}
