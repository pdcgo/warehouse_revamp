package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/manifoldco/promptui"
	"github.com/urfave/cli/v3"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_dbtarget"
)

// `san deploy` ships ONE service to Cloud Run (san-deploy-ships-one-service-to-cloud-run, in
// docs/technical/development/workflow_decision.md):
//
//	go run ./tools/san deploy                                # pick the service, check, confirm, deploy
//	go run ./tools/san deploy --service shipment_service --dry-run
//
// What it does, in order: pick the service → read project/region (flags, else the active gcloud config) → refuse
// a dirty tree → print the plan → check every secret exists and that the Cloud Run service is ours → make the
// operator type "production" → `gcloud run deploy --source .` (Cloud Build compiles backend/cmd/<service> with
// buildpacks; .gcloudignore keeps the upload to go.mod, go.sum and backend/) → ask the new revision's /healthz.
//
// What it does NOT do: migrate (`san migrate` stays its own, manual step — owner, 2026-11-03), create secrets, or
// grant IAM. It touches no database, so it never asks Local/Production and --dsn means nothing to it.

// deployLabelApp marks a Cloud Run service as this repository's. The project is SHARED with other systems, so a
// service of the same name without this label is someone else's, and deploy refuses to overwrite it.
const deployLabelApp = "warehouse-revamp"

// deploySecret is one environment variable the service reads, mapped from a Secret Manager secret (latest version)
// by Cloud Run itself.
type deploySecret struct {
	Env    string
	Secret string
}

// deployable is one service `san deploy` can ship.
type deployable struct {
	// Name is the service's directory under backend/services — what the operator picks.
	Name string
	// Main is the package Cloud Build compiles (GOOGLE_BUILDABLE), relative to the repository root.
	Main string
	// CloudRun is the Cloud Run service's name. Prefixed `revamp-` because the project is shared.
	CloudRun string
	// Secrets are the environment variables the binary must not start without (its checkDeployed).
	Secrets []deploySecret
}

// deployables is every service that has its own entry point. Adding one is a backend/cmd/<service> plus a row here
// (and a row in docs/tools/san.md#deploy).
var deployables = []deployable{
	{
		Name:     "shipment_service",
		Main:     "./backend/cmd/shipment_service",
		CloudRun: "revamp-shipment-service",
		Secrets: []deploySecret{
			// The database shared with user_service: the access interceptor reads `user_team_roles` from it.
			{Env: "DATABASE_URL", Secret: "revamp-database-url"},
			// user_service's signing secret, so its tokens verify here.
			{Env: "JWT_SECRET", Secret: "revamp-jwt-secret"},
		},
	},
}

func findDeployable(name string) (deployable, error) {
	for _, d := range deployables {
		if d.Name == name {
			return d, nil
		}
	}

	return deployable{}, fmt.Errorf("%q cannot be deployed — deployable: %s", name, strings.Join(deployableNames(), ", "))
}

func deployableNames() []string {
	names := make([]string, 0, len(deployables))
	for _, d := range deployables {
		names = append(names, d.Name)
	}

	return names
}

func deployCommand() *cli.Command {
	return &cli.Command{
		Name:  "deploy",
		Usage: "build one service with Cloud Build and deploy it to Cloud Run",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:  "service",
				Usage: "the service to deploy (" + strings.Join(deployableNames(), ", ") + "); omit to pick one",
			},
			&cli.StringFlag{
				Name:    "project",
				Sources: cli.EnvVars("SAN_DEPLOY_PROJECT"),
				Usage:   "GCP project id; default: the active gcloud config's project",
			},
			&cli.StringFlag{
				Name:    "region",
				Sources: cli.EnvVars("SAN_DEPLOY_REGION"),
				Usage:   "Cloud Run region; default: the active gcloud config's run/region",
			},
			&cli.StringFlag{
				Name:    "cloudsql-instance",
				Sources: cli.EnvVars("SAN_DEPLOY_CLOUDSQL_INSTANCE"),
				Usage:   "Cloud SQL connection name (project:region:instance) to mount at /cloudsql/…",
			},
			&cli.StringFlag{
				Name:    "allowed-origins",
				Sources: cli.EnvVars("SAN_DEPLOY_ALLOWED_ORIGINS"),
				Usage:   "comma-separated browser origins for CORS (sets ALLOWED_ORIGINS); omit to leave as deployed",
			},
			&cli.BoolFlag{
				Name:  "allow-dirty",
				Usage: "deploy uncommitted changes (the revision is labelled <commit>-dirty)",
			},
			&cli.BoolFlag{
				Name:  "dry-run",
				Usage: "print the plan and the gcloud commands, and run none of them",
			},
		},
		Action: runDeploy,
	}
}

func runDeploy(ctx context.Context, cmd *cli.Command) error {
	out := os.Stdout

	root, err := repoRootOnce()
	if err != nil {
		return err
	}

	service, err := pickDeployable(cmd.String("service"))
	if err != nil {
		return err
	}

	_, err = exec.LookPath("gcloud")
	if err != nil {
		return errors.New("gcloud is not on PATH — install the Google Cloud CLI and run `gcloud auth login`")
	}

	gcloud := execGcloud(root)

	plan := deployPlan{
		Service:        service,
		Project:        cmd.String("project"),
		Region:         cmd.String("region"),
		CloudSQL:       cmd.String("cloudsql-instance"),
		AllowedOrigins: cmd.String("allowed-origins"),
	}

	err = plan.resolveDefaults(ctx, gcloud)
	if err != nil {
		return err
	}

	plan.GoVersion, err = goVersion(filepath.Join(root, "go.mod"))
	if err != nil {
		return err
	}

	plan.Commit, plan.Dirty, err = gitState(ctx, root)
	if err != nil {
		return err
	}

	err = checkTree(plan.Dirty, cmd.Bool("allow-dirty"))
	if err != nil {
		return err
	}

	plan.print(out)

	if cmd.Bool("dry-run") {
		return plan.printCommands(out)
	}

	err = preflight(ctx, out, gcloud, plan)
	if err != nil {
		return err
	}

	err = san_dbtarget.ConfirmProduction()
	if err != nil {
		return err
	}

	envFile, cleanup, err := plan.writeEnvFile()
	if err != nil {
		return err
	}
	defer cleanup()

	args := plan.deployArgs(envFile)
	fmt.Fprintf(out, "\n→ gcloud %s\n\n", strings.Join(args, " "))

	err = runGcloudAttached(ctx, root, args)
	if err != nil {
		return fmt.Errorf("gcloud run deploy: %w", err)
	}

	return checkHealth(ctx, out, gcloud, plan)
}

func pickDeployable(name string) (deployable, error) {
	if name != "" {
		return findDeployable(name)
	}

	prompt := promptui.Select{
		Label: "Service to deploy",
		Items: deployableNames(),
	}

	_, picked, err := prompt.Run()
	if err != nil {
		return deployable{}, errors.New("no service picked — pass --service (" + strings.Join(deployableNames(), ", ") + ")")
	}

	return findDeployable(picked)
}

// deployPlan is everything one deploy decides BEFORE it acts — printed in full, and confirmed.
type deployPlan struct {
	Service        deployable
	Project        string
	Region         string
	GoVersion      string
	Commit         string
	Dirty          bool
	CloudSQL       string
	AllowedOrigins string
}

// gcloudFunc runs gcloud with its stdout captured. A field, so the checks can be tested without a cloud.
type gcloudFunc func(ctx context.Context, args ...string) (string, error)

func execGcloud(root string) gcloudFunc {
	return func(ctx context.Context, args ...string) (string, error) {
		c := exec.CommandContext(ctx, "gcloud", args...)
		c.Dir = root

		var stderr strings.Builder
		c.Stderr = &stderr

		stdout, err := c.Output()
		if err != nil {
			return "", fmt.Errorf("gcloud %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
		}

		return strings.TrimSpace(string(stdout)), nil
	}
}

// runGcloudAttached runs the deploy itself on san's own console: gcloud may ASK (create the Artifact Registry
// repository source deploys use, enable an API), and its build log is the operator's to read live.
func runGcloudAttached(ctx context.Context, root string, args []string) error {
	c := exec.CommandContext(ctx, "gcloud", args...)
	c.Dir = root
	c.Stdin = os.Stdin
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr

	return c.Run()
}

func (p *deployPlan) resolveDefaults(ctx context.Context, gcloud gcloudFunc) error {
	var err error

	if p.Project == "" {
		p.Project, err = gcloudConfigValue(ctx, gcloud, "project")
		if err != nil {
			return err
		}
	}

	if p.Region == "" {
		p.Region, err = gcloudConfigValue(ctx, gcloud, "run/region")
		if err != nil {
			return err
		}
	}

	if p.Project == "" {
		return errors.New("no project — pass --project, set SAN_DEPLOY_PROJECT, or `gcloud config set project …`")
	}

	if p.Region == "" {
		return errors.New("no region — pass --region, set SAN_DEPLOY_REGION, or `gcloud config set run/region …`")
	}

	return nil
}

func gcloudConfigValue(ctx context.Context, gcloud gcloudFunc, key string) (string, error) {
	value, err := gcloud(ctx, "config", "get-value", key)
	if err != nil {
		return "", err
	}

	// An unset key prints "(unset)" on stderr and nothing on stdout.
	return strings.TrimSpace(value), nil
}

var goDirective = regexp.MustCompile(`(?m)^go\s+(\S+)\s*$`)

// goVersion is go.mod's `go` line, passed to the buildpack as GOOGLE_GO_VERSION so Cloud Build compiles with the
// same Go as `go build` here — not "the latest stable" the buildpack would otherwise pick.
func goVersion(goMod string) (string, error) {
	content, err := os.ReadFile(goMod)
	if err != nil {
		return "", err
	}

	match := goDirective.FindSubmatch(content)
	if match == nil {
		return "", fmt.Errorf("%s has no `go` line", goMod)
	}

	return string(match[1]), nil
}

func gitState(ctx context.Context, root string) (string, bool, error) {
	head, err := exec.CommandContext(ctx, "git", "-C", root, "rev-parse", "--short=12", "HEAD").Output()
	if err != nil {
		return "", false, fmt.Errorf("git rev-parse HEAD: %w", err)
	}

	status, err := exec.CommandContext(ctx, "git", "-C", root, "status", "--porcelain").Output()
	if err != nil {
		return "", false, fmt.Errorf("git status: %w", err)
	}

	return strings.TrimSpace(string(head)), strings.TrimSpace(string(status)) != "", nil
}

// checkTree refuses uncommitted changes unless asked: `--source .` uploads the WORKING TREE, so a dirty deploy runs
// code no commit holds, and its commit label would lie about it.
func checkTree(dirty, allowDirty bool) error {
	if dirty && !allowDirty {
		return errors.New("the working tree has uncommitted changes — commit them, or pass --allow-dirty " +
			"(the revision is then labelled <commit>-dirty)")
	}

	return nil
}

func (p deployPlan) commitLabel() string {
	if p.Dirty {
		return p.Commit + "-dirty"
	}

	return p.Commit
}

func (p deployPlan) secretsArg() string {
	pairs := make([]string, 0, len(p.Service.Secrets))
	for _, s := range p.Service.Secrets {
		pairs = append(pairs, s.Env+"="+s.Secret+":latest")
	}

	return strings.Join(pairs, ",")
}

// deployArgs is the one `gcloud run deploy`.
//
// ⚠ EVERY ARGUMENT STAYS IN [A-Za-z0-9 ./:=,_-]. On Windows gcloud is gcloud.cmd, a batch file, and cmd.exe reads
// | ^ & < > ( ) % as its own — so a value that needs them (the origins list, which gcloud would need a ^|^
// delimiter for) goes through a file instead, and every read is --format=json.
func (p deployPlan) deployArgs(envFile string) []string {
	args := []string{
		"run", "deploy", p.Service.CloudRun,
		"--source=.",
		"--project=" + p.Project,
		"--region=" + p.Region,
		"--set-build-env-vars=GOOGLE_BUILDABLE=" + p.Service.Main + ",GOOGLE_GO_VERSION=" + p.GoVersion,
		"--set-secrets=" + p.secretsArg(),
		"--labels=app=" + deployLabelApp + ",service=" + p.Service.Name + ",commit=" + p.commitLabel(),
		// Public at the door: Cloud Run's IAM would refuse a browser before our access interceptor saw it. The
		// service's own policy decides — channel reads public, channel writes root, the label check signed in.
		"--allow-unauthenticated",
	}

	if p.CloudSQL != "" {
		args = append(args, "--set-cloudsql-instances="+p.CloudSQL)
	}

	if envFile != "" {
		args = append(args, "--env-vars-file="+envFile)
	}

	return args
}

// writeEnvFile writes the plain (non-secret) environment, when there is any to set.
func (p deployPlan) writeEnvFile() (string, func(), error) {
	if p.AllowedOrigins == "" {
		return "", func() {}, nil
	}

	f, err := os.CreateTemp("", "san-deploy-env-*.yaml")
	if err != nil {
		return "", nil, err
	}

	_, err = fmt.Fprintf(f, "ALLOWED_ORIGINS: %q\n", p.AllowedOrigins)
	closeErr := f.Close()

	if err == nil {
		err = closeErr
	}

	if err != nil {
		_ = os.Remove(f.Name())

		return "", nil, err
	}

	return f.Name(), func() { _ = os.Remove(f.Name()) }, nil
}

func (p deployPlan) print(out io.Writer) {
	fmt.Fprintln(out, "Deploy")
	fmt.Fprintf(out, "  service     %s → Cloud Run %s\n", p.Service.Name, p.Service.CloudRun)
	fmt.Fprintf(out, "  project     %s, region %s\n", p.Project, p.Region)
	fmt.Fprintf(out, "  build       %s with Go %s (Cloud Build, buildpacks; upload per .gcloudignore)\n",
		p.Service.Main, p.GoVersion)
	fmt.Fprintf(out, "  commit      %s\n", p.commitLabel())

	for _, s := range p.Service.Secrets {
		fmt.Fprintf(out, "  secret      %s ← %s:latest\n", s.Env, s.Secret)
	}

	if p.CloudSQL != "" {
		fmt.Fprintf(out, "  cloud sql   %s (socket /cloudsql/%s)\n", p.CloudSQL, p.CloudSQL)
	} else {
		fmt.Fprintln(out, "  cloud sql   none mounted — DATABASE_URL must reach the database another way")
	}

	if p.AllowedOrigins != "" {
		fmt.Fprintf(out, "  origins     %s\n", p.AllowedOrigins)
	} else {
		fmt.Fprintln(out, "  origins     unchanged")
	}

	fmt.Fprintln(out, "  access      public door (--allow-unauthenticated); the service checks its own tokens")
	fmt.Fprintf(out, "  migrations  NOT run — `san migrate up --service %s` (and user_service) first\n", p.Service.Name)
}

func (p deployPlan) printCommands(out io.Writer) error {
	fmt.Fprintln(out, "\nDry run — nothing was run. A real deploy would run:")

	for _, s := range p.Service.Secrets {
		fmt.Fprintf(out, "  gcloud secrets describe %s --project=%s --format=json\n", s.Secret, p.Project)
	}

	fmt.Fprintf(out, "  gcloud %s\n", strings.Join(p.listArgs(), " "))

	envFile := ""
	if p.AllowedOrigins != "" {
		envFile = "<temp env file>"
		fmt.Fprintf(out, "  (env file: ALLOWED_ORIGINS: %q)\n", p.AllowedOrigins)
	}

	fmt.Fprintln(out, "  — confirm: type \"production\" —")
	fmt.Fprintf(out, "  gcloud %s\n", strings.Join(p.deployArgs(envFile), " "))
	fmt.Fprintf(out, "  gcloud %s, then GET <url>/healthz\n", strings.Join(p.describeArgs(), " "))

	return nil
}

func (p deployPlan) listArgs() []string {
	return []string{
		"run", "services", "list",
		"--project=" + p.Project,
		"--region=" + p.Region,
		"--filter=metadata.name=" + p.Service.CloudRun,
		"--format=json",
	}
}

func (p deployPlan) describeArgs() []string {
	return []string{
		"run", "services", "describe", p.Service.CloudRun,
		"--project=" + p.Project,
		"--region=" + p.Region,
		"--format=json",
	}
}

// preflight fails BEFORE the confirmation on anything the deploy would otherwise fail on halfway, or should never
// do: a secret that is missing, or a Cloud Run service of this name that is not ours.
func preflight(ctx context.Context, out io.Writer, gcloud gcloudFunc, p deployPlan) error {
	fmt.Fprintln(out, "\nChecking")

	var missing []string

	for _, s := range p.Service.Secrets {
		_, err := gcloud(ctx, "secrets", "describe", s.Secret, "--project="+p.Project, "--format=json")
		if err != nil {
			missing = append(missing, s.Secret)

			continue
		}

		fmt.Fprintf(out, "  ✓ secret %s\n", s.Secret)
	}

	if len(missing) > 0 {
		return fmt.Errorf("secrets missing (or not readable) in %s: %s — create each with "+
			"`gcloud secrets create <name> --project=%s --data-file=-`",
			p.Project, strings.Join(missing, ", "), p.Project)
	}

	listed, err := gcloud(ctx, p.listArgs()...)
	if err != nil {
		return err
	}

	exists, err := checkOwnership(listed, p.Service.CloudRun)
	if err != nil {
		return err
	}

	if exists {
		fmt.Fprintf(out, "  ✓ Cloud Run %s is ours (app=%s) — a new revision\n", p.Service.CloudRun, deployLabelApp)
	} else {
		fmt.Fprintf(out, "  ✓ Cloud Run %s does not exist yet — it will be created\n", p.Service.CloudRun)
	}

	return nil
}

type cloudRunService struct {
	Metadata struct {
		Name   string            `json:"name"`
		Labels map[string]string `json:"labels"`
	} `json:"metadata"`
	Status struct {
		URL string `json:"url"`
	} `json:"status"`
}

// checkOwnership reads `gcloud run services list --format=json`: no such service is a first deploy; one labelled
// app=warehouse-revamp is ours; anything else is REFUSED — the project is shared, and a deploy replaces the service
// it names.
func checkOwnership(listJSON, name string) (bool, error) {
	if strings.TrimSpace(listJSON) == "" {
		return false, nil
	}

	var services []cloudRunService

	err := json.Unmarshal([]byte(listJSON), &services)
	if err != nil {
		return false, fmt.Errorf("reading gcloud run services list: %w", err)
	}

	for _, s := range services {
		if s.Metadata.Name != name {
			continue
		}

		if s.Metadata.Labels["app"] != deployLabelApp {
			return true, fmt.Errorf("the Cloud Run service %s exists and is NOT labelled app=%s — it belongs to "+
				"something else, and deploying would replace it. Refusing", name, deployLabelApp)
		}

		return true, nil
	}

	return false, nil
}

// checkHealth asks the deployed service's /healthz. The deploy has already succeeded — gcloud only routes traffic
// to a revision that started — so a failure here is reported, not returned as the deploy's.
func checkHealth(ctx context.Context, out io.Writer, gcloud gcloudFunc, p deployPlan) error {
	described, err := gcloud(ctx, p.describeArgs()...)
	if err != nil {
		return err
	}

	var service cloudRunService

	err = json.Unmarshal([]byte(described), &service)
	if err != nil {
		return fmt.Errorf("reading gcloud run services describe: %w", err)
	}

	url := strings.TrimRight(service.Status.URL, "/")
	if url == "" {
		fmt.Fprintln(out, "\nDeployed, but Cloud Run reported no URL yet.")

		return nil
	}

	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/healthz", nil)
	if err != nil {
		return err
	}

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		fmt.Fprintf(out, "\nDeployed: %s — but /healthz did not answer: %v\n", url, err)

		return nil
	}

	_ = res.Body.Close()

	switch res.StatusCode {
	case http.StatusOK:
		fmt.Fprintf(out, "\n✓ Deployed: %s — /healthz 200\n", url)
	case http.StatusForbidden:
		fmt.Fprintf(out, "\nDeployed: %s — /healthz 403: the public door was not opened "+
			"(an org policy can forbid allUsers on Cloud Run)\n", url)
	default:
		fmt.Fprintf(out, "\nDeployed: %s — /healthz answered %d\n", url, res.StatusCode)
	}

	return nil
}
