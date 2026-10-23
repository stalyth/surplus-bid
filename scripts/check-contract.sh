#!/bin/sh
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if [ -d /private/tmp/concordium-toolchain/cargo/bin ]; then
  export CARGO_HOME=/private/tmp/concordium-toolchain/cargo
  export RUSTUP_HOME=/private/tmp/concordium-toolchain/rustup
  export PATH="$CARGO_HOME/bin:$PATH"
fi

if ! command -v cargo >/dev/null 2>&1 || ! command -v cargo-concordium >/dev/null 2>&1; then
  echo '缺少 Rust/Cargo 或 cargo-concordium；请准备 README 中记录的已验证工具链。' >&2
  exit 1
fi

export CARGO_HTTP_TIMEOUT=30
export CARGO_TARGET_DIR="$repo_dir/contracts/auction-spike/target"

cd "$repo_dir/contracts/auction-spike"
cargo concordium build --out module.wasm.v1 --schema-out schema.bin -- --locked
cargo test --locked
