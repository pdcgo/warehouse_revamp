# The e2e runner — `san test` on another PC (backlog #154, docs/tools/san.md#test-on-another-pc): Playwright's browsers, Node, Go,
# git and lsof in one image, run by docker-compose.yaml's `e2e-runner` service (profile e2e-remote) with the other
# PC's checkout mounted at /work. san builds it there with the versions the COMMIT under test pins:
#   PLAYWRIGHT_VERSION  frontend/package-lock.json's @playwright/test — the image carries exactly its browsers
#   GO_VERSION          go.mod's go (or toolchain) line
ARG PLAYWRIGHT_VERSION=1.61.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG GO_VERSION=1.25.8

# git: san reads `git worktree list`; lsof: san finds which process holds a port (tools/san/test_runner.go
# listeners); procps: ps for a process's command line.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git lsof procps ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | tar -C /usr/local -xz

ENV PATH=/usr/local/go/bin:$PATH \
    GOTOOLCHAIN=local \
    GOFLAGS=-buildvcs=false

WORKDIR /work
