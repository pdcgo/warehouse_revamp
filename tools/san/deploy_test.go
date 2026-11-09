package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Every deployable must point at something that exists: a service directory, and an entry point Cloud Build can
// compile. A row whose Main is wrong fails in Cloud Build, minutes into an upload; this fails in a second.
func TestEveryDeployableHasItsServiceAndEntryPoint(t *testing.T) {
	root, err := findRepoRoot()
	if err != nil {
		t.Fatalf("findRepoRoot: %v", err)
	}

	for _, d := range deployables {
		_, err = os.Stat(filepath.Join(root, "backend", "services", d.Name))
		if err != nil {
			t.Errorf("%s: no backend/services/%s: %v", d.Name, d.Name, err)
		}

		_, err = os.Stat(filepath.Join(root, filepath.FromSlash(d.Main), "main.go"))
		if err != nil {
			t.Errorf("%s: no main.go in %s: %v", d.Name, d.Main, err)
		}
	}
}

// Cloud Run names are lowercase letters, digits and hyphens, start with a letter, at most 49 characters. And two
// rows must never share one — a deploy of the second would replace the first.
var cloudRunName = regexp.MustCompile(`^[a-z]([-a-z0-9]{0,47}[a-z0-9])?$`)

func TestCloudRunNamesAreValidAndUnique(t *testing.T) {
	seen := map[string]string{}

	for _, d := range deployables {
		if !cloudRunName.MatchString(d.CloudRun) {
			t.Errorf("%s: %q is not a valid Cloud Run service name", d.Name, d.CloudRun)
		}

		other, dup := seen[d.CloudRun]
		if dup {
			t.Errorf("%s and %s both deploy to %s", other, d.Name, d.CloudRun)
		}

		seen[d.CloudRun] = d.Name
	}
}

func TestShipmentIsDeployable(t *testing.T) {
	d, err := findDeployable("shipment_service")
	if err != nil {
		t.Fatalf("findDeployable: %v", err)
	}

	if d.Main != "./backend/cmd/shipment_service" {
		t.Fatalf("Main = %q", d.Main)
	}

	_, err = findDeployable("selling_service")
	if err == nil {
		t.Fatal("a service with no entry point of its own must not be deployable")
	}
}

func testPlan() deployPlan {
	d, _ := findDeployable("shipment_service")

	return deployPlan{
		Service:   d,
		Project:   "my-project",
		Region:    "asia-southeast2",
		GoVersion: "1.25.8",
		Commit:    "55d7f450abcd",
		CloudSQL:  "my-project:asia-southeast2:db",
	}
}

func TestTheDeployCommandSaysWhatItBuildsAndWhere(t *testing.T) {
	args := testPlan().deployArgs("")
	joined := strings.Join(args, " ")

	for _, want := range []string{
		"run deploy revamp-shipment-service",
		"--source=.",
		"--project=my-project",
		"--region=asia-southeast2",
		"--set-build-env-vars=GOOGLE_BUILDABLE=./backend/cmd/shipment_service,GOOGLE_GO_VERSION=1.25.8",
		"--set-secrets=DATABASE_URL=revamp-database-url:latest,JWT_SECRET=revamp-jwt-secret:latest",
		"--labels=app=warehouse-revamp,service=shipment_service,commit=55d7f450abcd",
		"--allow-unauthenticated",
		"--set-cloudsql-instances=my-project:asia-southeast2:db",
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("deploy args lack %q:\n%s", want, joined)
		}
	}

	if strings.Contains(joined, "--env-vars-file") {
		t.Error("no origins were given, so the deployed environment must be left alone")
	}
}

func TestADirtyDeployIsLabelledSo(t *testing.T) {
	p := testPlan()
	p.Dirty = true

	joined := strings.Join(p.deployArgs(""), " ")
	if !strings.Contains(joined, "commit=55d7f450abcd-dirty") {
		t.Fatalf("a dirty deploy must say so in its label:\n%s", joined)
	}
}

// gcloud is gcloud.cmd on Windows: cmd.exe would read any of these as its own syntax, and the deploy would run a
// different command than the one printed.
func TestNoArgumentCarriesCmdMetacharacters(t *testing.T) {
	p := testPlan()
	p.AllowedOrigins = "https://a.example,https://b.example"

	all := append(p.deployArgs(`C:\Temp\san-deploy-env-1.yaml`), p.listArgs()...)
	all = append(all, p.describeArgs()...)

	for _, arg := range all {
		if strings.ContainsAny(arg, `|^&<>()%!"`) {
			t.Errorf("argument %q carries a cmd.exe metacharacter", arg)
		}
	}
}

// The origins list has commas, which --set-env-vars would split; it goes through a file.
func TestOriginsGoThroughAnEnvFile(t *testing.T) {
	p := testPlan()
	p.AllowedOrigins = "https://a.example,https://b.example"

	file, cleanup, err := p.writeEnvFile()
	if err != nil {
		t.Fatalf("writeEnvFile: %v", err)
	}
	defer cleanup()

	content, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("read env file: %v", err)
	}

	if string(content) != "ALLOWED_ORIGINS: \"https://a.example,https://b.example\"\n" {
		t.Fatalf("env file = %q", content)
	}

	joined := strings.Join(p.deployArgs(file), " ")
	if !strings.Contains(joined, "--env-vars-file="+file) {
		t.Fatalf("deploy args lack the env file:\n%s", joined)
	}

	cleanup()

	_, err = os.Stat(file)
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the env file must be removed after the deploy: %v", err)
	}
}

func TestGoVersionIsGoModsGoLine(t *testing.T) {
	root, err := findRepoRoot()
	if err != nil {
		t.Fatalf("findRepoRoot: %v", err)
	}

	version, err := goVersion(filepath.Join(root, "go.mod"))
	if err != nil {
		t.Fatalf("goVersion: %v", err)
	}

	if !regexp.MustCompile(`^1\.\d+(\.\d+)?$`).MatchString(version) {
		t.Fatalf("go version %q does not look like one", version)
	}
}

func TestADirtyTreeIsRefusedUnlessAllowed(t *testing.T) {
	if checkTree(true, false) == nil {
		t.Error("a dirty tree must be refused")
	}

	if checkTree(true, true) != nil {
		t.Error("--allow-dirty must allow it")
	}

	if checkTree(false, false) != nil {
		t.Error("a clean tree must pass")
	}
}

// The project is shared with other systems, so the name alone does not make a service ours.
func TestOwnership(t *testing.T) {
	cases := []struct {
		name       string
		list       string
		wantExists bool
		wantErr    bool
	}{
		{name: "first deploy, empty output", list: "", wantExists: false},
		{name: "first deploy, empty list", list: "[]", wantExists: false},
		{
			name:       "ours",
			list:       `[{"metadata":{"name":"revamp-shipment-service","labels":{"app":"warehouse-revamp"}}}]`,
			wantExists: true,
		},
		{
			name:       "same name, no label",
			list:       `[{"metadata":{"name":"revamp-shipment-service"}}]`,
			wantExists: true,
			wantErr:    true,
		},
		{
			name:       "same name, another app",
			list:       `[{"metadata":{"name":"revamp-shipment-service","labels":{"app":"something-else"}}}]`,
			wantExists: true,
			wantErr:    true,
		},
		{
			name:       "the filter matched another name only",
			list:       `[{"metadata":{"name":"revamp-shipment-service-old","labels":{}}}]`,
			wantExists: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			exists, err := checkOwnership(tc.list, "revamp-shipment-service")

			if exists != tc.wantExists {
				t.Errorf("exists = %v, want %v", exists, tc.wantExists)
			}

			if (err != nil) != tc.wantErr {
				t.Errorf("err = %v, want error: %v", err, tc.wantErr)
			}
		})
	}
}

// A missing secret is caught BEFORE the confirmation, naming every one, rather than by Cloud Run after a build.
func TestPreflightNamesEveryMissingSecret(t *testing.T) {
	gcloud := func(_ context.Context, args ...string) (string, error) {
		if args[0] == "secrets" {
			return "", errors.New("NOT_FOUND")
		}

		return "[]", nil
	}

	var out strings.Builder

	err := preflight(context.Background(), &out, gcloud, testPlan())
	if err == nil {
		t.Fatal("missing secrets must stop the deploy")
	}

	for _, name := range []string{"revamp-database-url", "revamp-jwt-secret"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error %q does not name %s", err, name)
		}
	}
}

func TestPreflightPassesAFirstDeploy(t *testing.T) {
	gcloud := func(_ context.Context, args ...string) (string, error) {
		if args[0] == "secrets" {
			return "{}", nil
		}

		return "[]", nil
	}

	var out strings.Builder

	err := preflight(context.Background(), &out, gcloud, testPlan())
	if err != nil {
		t.Fatalf("preflight: %v", err)
	}

	if !strings.Contains(out.String(), "will be created") {
		t.Fatalf("a first deploy must say the service will be created:\n%s", out.String())
	}
}
