#!/usr/bin/env bash
# Installs a project-local, version-pinned `typst` binary for local dev, so
# `pnpm dev` never silently drifts from the version pinned in
# infra/Dockerfile.api (TYPST_VERSION). Without this, `spawnTypstRunner`
# (typst-cli.adapter.ts) resolves whatever `typst` is first on PATH — on a
# dev machine that's whatever a package manager (Homebrew, etc.) happens to
# have installed, which can be newer than prod and incompatible with the
# pinned `@preview/cetz` version (see openrouter-request-builder.ts
# CETZ_RULES) in ways that only show up as a live "Typst compile failed".
#
# Idempotent: skips the download if the pinned version is already installed.
set -euo pipefail

# Keep this in sync with infra/Dockerfile.api's ARG TYPST_VERSION.
TYPST_VERSION="0.15.1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$SCRIPT_DIR/../.typst-bin"
BIN_PATH="$BIN_DIR/typst"

if [ -x "$BIN_PATH" ] && "$BIN_PATH" --version 2>/dev/null | grep -q "$TYPST_VERSION"; then
  exit 0
fi

case "$(uname -s)" in
  Darwin) OS="apple-darwin" ;;
  Linux) OS="unknown-linux-musl" ;;
  *)
    echo "install-typst-dev.sh: unsupported OS $(uname -s) — install typst $TYPST_VERSION manually and put it on PATH" >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  arm64|aarch64) ARCH="aarch64" ;;
  x86_64) ARCH="x86_64" ;;
  *)
    echo "install-typst-dev.sh: unsupported arch $(uname -m) — install typst $TYPST_VERSION manually and put it on PATH" >&2
    exit 1
    ;;
esac

TARGET="${ARCH}-${OS}"
ASSET="typst-${TARGET}"
URL="https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/${ASSET}.tar.xz"

echo "install-typst-dev.sh: installing typst ${TYPST_VERSION} (${TARGET}) to ${BIN_DIR}..."

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

curl -fsSL "$URL" -o "$WORK_DIR/typst.tar.xz"
tar -xJf "$WORK_DIR/typst.tar.xz" -C "$WORK_DIR"

mkdir -p "$BIN_DIR"
mv "$WORK_DIR/${ASSET}/typst" "$BIN_PATH"
chmod +x "$BIN_PATH"

echo "install-typst-dev.sh: installed $("$BIN_PATH" --version)"
