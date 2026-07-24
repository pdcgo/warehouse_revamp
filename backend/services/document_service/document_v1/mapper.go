package document_v1

import (
	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_service_models"
)

func toProto(d *document_service_models.Document) *documentv1.Document {
	return &documentv1.Document{
		Id:           d.ID,
		TeamId:       d.TeamID,
		ResourceType: resourceTypeFromText(d.ResourceType),
		Filename:     d.Filename,
		MimeType:     d.MimeType,
		SizeBytes:    d.SizeBytes,
		PublicUrl:    d.PublicURL,
		ThumbnailUrl: d.ThumbnailURL,
	}
}
