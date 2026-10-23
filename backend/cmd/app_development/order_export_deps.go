package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"

	"connectrpc.com/connect"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1/documentv1connect"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1/userv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// ── selling's export — the file, and the names its rows need (one-export-is-the-list-as-a-file) ─────────────────

type orderExports struct {
	documents documentv1connect.DocumentServiceClient
	http      *internalHTTPClient
	teams     teamv1connect.TeamServiceClient
	users     userv1connect.UserServiceClient
}

// NewOrderExportStore is OrderExport's store: document_service for the file, team_service and user_service for the
// names. Every client FORWARDS THE CALLER'S TOKEN (san_auth.ForwardBearer), so the file is stored as the person who
// exported it, under their team, and the names are what that person may read.
//
// Its own team and user clients rather than the shared ones: those carry no forwarding, and the by-ids reads are
// allow_only_authenticated.
func NewOrderExportStore(
	cfg *Config,
	client *internalHTTPClient,
	documents documentv1connect.DocumentServiceClient,
) selling_v1.OrderExportStore {
	forward := connect.WithInterceptors(san_auth.ForwardBearer())

	return &orderExports{
		documents: documents,
		http:      client,
		teams:     teamv1connect.NewTeamServiceClient(client, cfg.InternalBaseURL, forward),
		users:     userv1connect.NewUserServiceClient(client, cfg.InternalBaseURL, forward),
	}
}

// Store uploads the file as an ORDER_EXPORT and returns its expiring signed link.
func (a *orderExports) Store(ctx context.Context, teamID uint64, filename string, content []byte) (string, error) {
	documentID, err := uploadDocument(ctx, a.documents, a.http, documentUpload{
		teamID:       teamID,
		resourceType: documentv1.DocumentResourceType_DOCUMENT_RESOURCE_TYPE_ORDER_EXPORT,
		contentType:  xlsxType,
		filename:     filename,
		content:      content,
	})
	if err != nil {
		return "", err
	}

	link, err := a.documents.GetDownloadUrl(ctx, connect.NewRequest(&documentv1.GetDownloadUrlRequest{
		TeamId:     teamID,
		DocumentId: documentID,
	}))
	if err != nil {
		return "", err
	}

	return link.Msg.GetUrl(), nil
}

func (a *orderExports) TeamNames(ctx context.Context, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}
	if len(ids) == 0 {
		return out, nil
	}

	resp, err := a.teams.TeamByIds(ctx, connect.NewRequest(&teamv1.TeamByIdsRequest{
		Filter:      &teamv1.TeamByIdsFilter{Ids: ids},
		DataRequest: []teamv1.TeamByIdsDataType{teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_GENERAL},
	}))
	if err != nil {
		return nil, err
	}

	for _, list := range resp.Msg.GetItems() {
		for _, item := range list.GetItems() {
			for id, general := range item.GetGeneral().GetMapData() {
				out[id] = general.GetName()
			}
		}
	}

	return out, nil
}

func (a *orderExports) UserNames(ctx context.Context, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}
	if len(ids) == 0 {
		return out, nil
	}

	resp, err := a.users.UserByIDs(ctx, connect.NewRequest(&userv1.UserByIDsRequest{
		Filter:      &userv1.UserByIdsFilter{Ids: ids},
		DataRequest: []userv1.UserByIdsDataType{userv1.UserByIdsDataType_USER_BY_IDS_DATA_TYPE_GENERAL},
	}))
	if err != nil {
		return nil, err
	}

	for _, list := range resp.Msg.GetItems() {
		for _, item := range list.GetItems() {
			for id, general := range item.GetGeneral().GetMapData() {
				out[id] = general.GetName()
			}
		}
	}

	return out, nil
}

// ── documents — the two-phase upload, as a client ───────────────────────────────────────────────────────────────

// documentUpload is one file a service stores in document_service.
type documentUpload struct {
	teamID       uint64
	resourceType documentv1.DocumentResourceType
	contentType  string
	filename     string
	content      []byte
}

// uploadDocument is RequestUpload → PUT → ConfirmUpload, exactly as a browser runs it — a service is document_service's
// client, never a second door into its storage. It returns the stored document's id.
func uploadDocument(
	ctx context.Context,
	documents documentv1connect.DocumentServiceClient,
	client *internalHTTPClient,
	file documentUpload,
) (string, error) {
	upload, err := documents.RequestUpload(ctx, connect.NewRequest(&documentv1.RequestUploadRequest{
		TeamId:       file.teamID,
		ResourceType: file.resourceType,
		ContentType:  file.contentType,
		SizeBytes:    int64(len(file.content)),
		Filename:     file.filename,
	}))
	if err != nil {
		return "", err
	}

	put, err := http.NewRequestWithContext(ctx, upload.Msg.GetMethod(), upload.Msg.GetUploadUrl(), bytes.NewReader(file.content))
	if err != nil {
		return "", err
	}

	for name, value := range upload.Msg.GetHeaders() {
		put.Header.Set(name, value)
	}

	resp, err := client.Do(put)
	if err != nil {
		return "", fmt.Errorf("uploading %s: %w", file.filename, err)
	}

	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()

	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("uploading %s: the store answered %s", file.filename, resp.Status)
	}

	confirmed, err := documents.ConfirmUpload(ctx, connect.NewRequest(&documentv1.ConfirmUploadRequest{
		UploadToken: upload.Msg.GetUploadToken(),
	}))
	if err != nil {
		return "", err
	}

	return confirmed.Msg.GetDocument().GetId(), nil
}
