// Package san_metric reads the analytic options a metric declares on its proto message
// (warehouse.analytic_base.v1 — docs/business/analytic/rpc_provide.md) and refuses to boot on one that is malformed.
//
// It ships functions, not a flow: a service's MetricSearch / MetricData handler decides what to do with a metric; this
// package only answers what the metric declared.
package san_metric

import (
	"errors"
	"fmt"
	"slices"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
)

// ErrNotSortable is a sort naming a field that is not on the metric or does not carry `can_sort`. The handler answers
// it as InvalidArgument: the caller asked for a sort the metric never offered.
var ErrNotSortable = errors.New("san_metric: the field cannot be sorted by")

// OptionOf reads the (metric) option off a message. A nil result means the message is not a metric.
func OptionOf(descriptor protoreflect.MessageDescriptor) *analytic_basev1.MetricOption {
	opts, ok := descriptor.Options().(*descriptorpb.MessageOptions)
	if !ok || opts == nil {
		return nil
	}

	if !proto.HasExtension(opts, analytic_basev1.E_Metric) {
		return nil
	}

	option, _ := proto.GetExtension(opts, analytic_basev1.E_Metric).(*analytic_basev1.MetricOption)

	return option
}

// sortOptionOf reads the (metric_sort) option off a field. A nil result means the field carries none.
func sortOptionOf(field protoreflect.FieldDescriptor) *analytic_basev1.SortOption {
	opts, ok := field.Options().(*descriptorpb.FieldOptions)
	if !ok || opts == nil {
		return nil
	}

	if !proto.HasExtension(opts, analytic_basev1.E_MetricSort) {
		return nil
	}

	option, _ := proto.GetExtension(opts, analytic_basev1.E_MetricSort).(*analytic_basev1.SortOption)

	return option
}

// statTypeOf reads the (field_stat_type) option off a field. A field that carries none reads as UNSPECIFIED.
func statTypeOf(field protoreflect.FieldDescriptor) analytic_basev1.FieldStatType {
	opts, ok := field.Options().(*descriptorpb.FieldOptions)
	if !ok || opts == nil {
		return analytic_basev1.FieldStatType_FIELD_STAT_TYPE_UNSPECIFIED
	}

	statType, _ := proto.GetExtension(opts, analytic_basev1.E_FieldStatType).(analytic_basev1.FieldStatType)

	return statType
}

// SortField finds the field a MetricSort names — by its PROTO name (a-sort-field-is-its-proto-name) — and returns it
// with its SortOption, so the handler reads `rank_min_sample` off the same lookup. A field that is missing, or does not
// carry `can_sort`, is ErrNotSortable.
func SortField(
	metric protoreflect.MessageDescriptor,
	name string,
) (protoreflect.FieldDescriptor, *analytic_basev1.SortOption, error) {
	field := metric.Fields().ByName(protoreflect.Name(name))
	if field == nil {
		return nil, nil, fmt.Errorf("%w: %s has no field %q", ErrNotSortable, metric.FullName(), name)
	}

	option := sortOptionOf(field)
	if option == nil || !option.GetCanSort() {
		return nil, nil, fmt.Errorf("%w: %s.%s does not carry can_sort", ErrNotSortable, metric.FullName(), name)
	}

	return field, option, nil
}

// ValidateDescriptors asserts, at STARTUP, that every metric in the binary is well-formed. Each of these is silent at
// runtime otherwise:
//
//   - an empty or repeated metric_id => two services answer for one column, and the frontend keeps whichever it read
//     last (a-metric-id-is-a-name-not-a-route).
//   - no GROUP_TYPE_SUMMARY => the table has no headline for that metric (every-metric-has-a-summary).
//   - a required filter that is not supported => the filter strip never offers it, so no request can ever succeed.
//   - metric_sort on a field that is not a single number => the ranking query cannot order by it.
//   - a number field with no field_stat_type => the screen cannot tell an amount from a count, so it can neither format
//     the cell nor pick the graph the column goes in (every-number-field-carries-a-stat-type).
//   - rank_min_sample on a field that is not a RATIO => a minimum sample means nothing on a count or an amount.
//
// Call this from main, beside san_auth.ValidateDescriptors. A malformed metric should stop the process, not serve a
// report that quietly disagrees with itself.
func ValidateDescriptors() error {
	return validateFiles(protoregistry.GlobalFiles)
}

func validateFiles(files *protoregistry.Files) error {
	owners := map[string]protoreflect.FullName{}

	var err error

	files.RangeFiles(func(file protoreflect.FileDescriptor) bool {
		err = validateMessages(file.Messages(), owners)

		return err == nil
	})

	return err
}

func validateMessages(messages protoreflect.MessageDescriptors, owners map[string]protoreflect.FullName) error {
	for i := range messages.Len() {
		message := messages.Get(i)

		err := validateMetric(message, owners)
		if err != nil {
			return err
		}

		err = validateMessages(message.Messages(), owners)
		if err != nil {
			return err
		}
	}

	return nil
}

func validateMetric(message protoreflect.MessageDescriptor, owners map[string]protoreflect.FullName) error {
	option := OptionOf(message)
	if option == nil {
		return validateFields(message, false)
	}

	id := option.GetMetricId()
	if id == "" {
		return fmt.Errorf("san_metric: %s declares (metric) with no metric_id", message.FullName())
	}

	owner, taken := owners[id]
	if taken {
		return fmt.Errorf(
			"san_metric: metric_id %q is declared by both %s and %s — an id must be unique across every service",
			id, owner, message.FullName(),
		)
	}

	owners[id] = message.FullName()

	groups := option.GetSupportedGroupBy()
	if !slices.Contains(groups, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY) {
		return fmt.Errorf(
			"san_metric: %s (%q) does not list GROUP_TYPE_SUMMARY — every metric has a headline",
			message.FullName(), id,
		)
	}

	if slices.Contains(groups, analytic_basev1.GroupType_GROUP_TYPE_UNSPECIFIED) {
		return fmt.Errorf("san_metric: %s (%q) lists GROUP_TYPE_UNSPECIFIED as a group", message.FullName(), id)
	}

	supported := option.GetSupportedFilters()
	if slices.Contains(supported, analytic_basev1.FilterType_FILTER_TYPE_UNSPECIFIED) {
		return fmt.Errorf("san_metric: %s (%q) lists FILTER_TYPE_UNSPECIFIED as a filter", message.FullName(), id)
	}

	for _, required := range option.GetRequiredFilters() {
		if !slices.Contains(supported, required) {
			return fmt.Errorf(
				"san_metric: %s (%q) requires %s but does not support it — no request could ever carry it",
				message.FullName(), id, required,
			)
		}
	}

	return validateFields(message, true)
}

// validateFields checks the (metric_sort) and (field_stat_type) of every field on a message. Outside a metric both
// are refused outright: nothing would ever read them. Inside one, every single number must say what kind it is.
func validateFields(message protoreflect.MessageDescriptor, isMetric bool) error {
	fields := message.Fields()

	for i := range fields.Len() {
		field := fields.Get(i)

		option := sortOptionOf(field)
		statType := statTypeOf(field)
		singleNumber := field.Cardinality() != protoreflect.Repeated && isNumber(field.Kind())

		if !isMetric {
			if option != nil || statType != analytic_basev1.FieldStatType_FIELD_STAT_TYPE_UNSPECIFIED {
				return fmt.Errorf(
					"san_metric: %s.%s carries metric_sort or field_stat_type but %s is not a metric — nothing reads it",
					message.FullName(), field.Name(), message.FullName(),
				)
			}

			continue
		}

		if !singleNumber {
			if option != nil || statType != analytic_basev1.FieldStatType_FIELD_STAT_TYPE_UNSPECIFIED {
				return fmt.Errorf(
					"san_metric: %s.%s carries metric_sort or field_stat_type but is not a single number — a table cannot show or order it",
					message.FullName(), field.Name(),
				)
			}

			continue
		}

		if statType == analytic_basev1.FieldStatType_FIELD_STAT_TYPE_UNSPECIFIED {
			return fmt.Errorf(
				"san_metric: %s.%s carries no field_stat_type — the screen cannot tell a count from an amount",
				message.FullName(), field.Name(),
			)
		}

		if option.GetRankMinSample() < 0 {
			return fmt.Errorf("san_metric: %s.%s has a negative rank_min_sample", message.FullName(), field.Name())
		}

		if option.GetRankMinSample() > 0 && statType != analytic_basev1.FieldStatType_FIELD_STAT_TYPE_RATIO {
			return fmt.Errorf(
				"san_metric: %s.%s carries rank_min_sample but is %s, not a RATIO — a minimum sample means nothing there",
				message.FullName(), field.Name(), statType,
			)
		}
	}

	return nil
}

func isNumber(kind protoreflect.Kind) bool {
	switch kind {
	case protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Sfixed32Kind,
		protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind,
		protoreflect.Uint32Kind, protoreflect.Fixed32Kind,
		protoreflect.Uint64Kind, protoreflect.Fixed64Kind,
		protoreflect.FloatKind, protoreflect.DoubleKind:
		return true
	default:
		return false
	}
}
