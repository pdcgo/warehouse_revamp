package san_config

import (
	"encoding"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"time"
)

const envTag = "env"

var (
	textUnmarshalerType = reflect.TypeOf((*encoding.TextUnmarshaler)(nil)).Elem()
	durationType        = reflect.TypeOf(time.Duration(0))
	timeType            = reflect.TypeOf(time.Time{})
)

// EnvSecretProvider fills fields tagged `env:"NAME"` from the process environment.
//
//	type Config struct {
//	    Port     int           `env:"PORT"      yaml:"port"`
//	    Database struct {
//	        Host string        `env:"DB_HOST"   yaml:"host"`
//	    }                      `yaml:"database"`
//	    Timeout  time.Duration `env:"TIMEOUT"   yaml:"timeout"`  // "30s"
//	    Origins  []string      `env:"ORIGINS"   yaml:"origins"`  // "a,b,c"
//	}
//
// A variable that is NOT set leaves its field untouched. That is the layering contract: env
// sits on top of a YAML base and overrides only what it genuinely defines. An env var that is
// set but EMPTY is respected as an empty value — "set to nothing" is a deliberate act,
// distinct from "not set".
type EnvSecretProvider struct {
	// Prefix is prepended to every tag name: prefix "APP_" + tag "PORT" reads APP_PORT.
	Prefix string

	// lookup is the environment. Swappable so tests need not mutate the real process env.
	lookup func(string) (string, bool)
}

func NewEnvSecretProvider(prefix string) *EnvSecretProvider {
	return &EnvSecretProvider{Prefix: prefix}
}

// Unmarshal implements [ConfigProvider].
func (p *EnvSecretProvider) Unmarshal(dst any) error {
	err := validateTarget(dst)
	if err != nil {
		return err
	}

	lookup := p.lookup
	if lookup == nil {
		lookup = osLookupEnv
	}

	return p.walk(reflect.ValueOf(dst).Elem(), lookup)
}

func (p *EnvSecretProvider) walk(target reflect.Value, lookup func(string) (string, bool)) error {
	targetType := target.Type()

	for i := range target.NumField() {
		field := targetType.Field(i)
		value := target.Field(i)

		if !value.CanSet() {
			continue // unexported
		}

		// Recurse into nested structs so a nested config carries its own env tags.
		if isNestedStruct(field.Type) {
			if value.Kind() == reflect.Pointer {
				if value.IsNil() {
					value.Set(reflect.New(field.Type.Elem()))
				}

				value = value.Elem()
			}

			err := p.walk(value, lookup)
			if err != nil {
				return err
			}

			continue
		}

		name := field.Tag.Get(envTag)
		if name == "" || name == "-" {
			continue
		}

		raw, found := lookup(p.Prefix + name)
		if !found {
			continue // unset — leave whatever the layer below put there
		}

		err := setValue(value, raw)
		if err != nil {
			return fmt.Errorf("%s: %w", p.Prefix+name, err)
		}
	}

	return nil
}

// isNestedStruct reports whether we should descend into fieldType looking for more env tags.
// A struct that can parse itself from text (encoding.TextUnmarshaler), and time.Time, are
// LEAVES — descending into them would be nonsense.
func isNestedStruct(fieldType reflect.Type) bool {
	if fieldType.Kind() == reflect.Pointer {
		fieldType = fieldType.Elem()
	}

	if fieldType.Kind() != reflect.Struct {
		return false
	}

	if fieldType == timeType {
		return false
	}

	return !reflect.PointerTo(fieldType).Implements(textUnmarshalerType)
}

func setValue(value reflect.Value, raw string) error {
	if value.Kind() == reflect.Pointer {
		if value.IsNil() {
			value.Set(reflect.New(value.Type().Elem()))
		}

		value = value.Elem()
	}

	// Let a type parse itself when it knows how.
	if value.CanAddr() {
		unmarshaler, ok := value.Addr().Interface().(encoding.TextUnmarshaler)
		if ok {
			return unmarshaler.UnmarshalText([]byte(raw))
		}
	}

	switch value.Kind() {
	case reflect.String:
		value.SetString(raw)

	case reflect.Bool:
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return err
		}

		value.SetBool(parsed)

	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		// time.Duration is an int64 underneath — accept "30s", not just a raw count.
		if value.Type() == durationType {
			parsed, err := time.ParseDuration(raw)
			if err != nil {
				return err
			}

			value.SetInt(int64(parsed))

			return nil
		}

		parsed, err := strconv.ParseInt(raw, 10, value.Type().Bits())
		if err != nil {
			return err
		}

		value.SetInt(parsed)

	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		parsed, err := strconv.ParseUint(raw, 10, value.Type().Bits())
		if err != nil {
			return err
		}

		value.SetUint(parsed)

	case reflect.Float32, reflect.Float64:
		parsed, err := strconv.ParseFloat(raw, value.Type().Bits())
		if err != nil {
			return err
		}

		value.SetFloat(parsed)

	case reflect.Slice:
		return setSlice(value, raw)

	default:
		return fmt.Errorf("unsupported type %s", value.Type())
	}

	return nil
}

// setSlice parses a comma-separated list. An empty string means an EMPTY slice, not a
// one-element slice containing "".
func setSlice(value reflect.Value, raw string) error {
	if raw == "" {
		value.Set(reflect.MakeSlice(value.Type(), 0, 0))

		return nil
	}

	parts := strings.Split(raw, ",")
	slice := reflect.MakeSlice(value.Type(), len(parts), len(parts))

	for i, part := range parts {
		err := setValue(slice.Index(i), strings.TrimSpace(part))
		if err != nil {
			return fmt.Errorf("element %d: %w", i, err)
		}
	}

	value.Set(slice)

	return nil
}
