package san_metric

import (
	"google.golang.org/protobuf/reflect/protoreflect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
)

// Field is one NUMBER field of a metric, as the metric declares it: its proto name, what kind of number it is, and
// whether a report may rank by it.
type Field struct {
	Name     string
	StatType analytic_basev1.FieldStatType
	CanSort  bool
}

// Fields lists a metric's number fields, in declaration order — what a metric can be read for and ranked by. A field
// with no field_stat_type is not a number (an id, a key) and is left out.
func Fields(metric protoreflect.MessageDescriptor) []Field {
	fields := metric.Fields()
	out := make([]Field, 0, fields.Len())

	for i := range fields.Len() {
		field := fields.Get(i)

		statType := statTypeOf(field)
		if statType == analytic_basev1.FieldStatType_FIELD_STAT_TYPE_UNSPECIFIED {
			continue
		}

		sort := sortOptionOf(field)

		out = append(out, Field{
			Name:     string(field.Name()),
			StatType: statType,
			CanSort:  sort != nil && sort.GetCanSort(),
		})
	}

	return out
}
