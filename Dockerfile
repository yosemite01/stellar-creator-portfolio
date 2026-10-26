# Reproducible Soroban contract builder.
#
# Mirrors the stellar/soroban-tools image environment so the WASM output is
# byte-for-byte identical regardless of where this runs (CI or local).
#
# Pinned versions — bump deliberately and re-verify hashes.
# soroban-sdk 23 needs Rust >= 1.84 and the wasm32v1-none target. Updating
# requires a hash re-baseline (scripts/verify.sh --update-baseline) and a
# deliberate PR review.
#
# Related: #1348
FROM rust:1.94.1-slim AS builder

# Reproducibility: no incremental compilation, deterministic codegen, fixed
# SOURCE_DATE_EPOCH so embedded timestamps are zeroed out.
ENV CARGO_INCREMENTAL=0 \
    CARGO_NET_RETRY=10 \
    RUSTFLAGS="-C codegen-units=1 -C opt-level=s" \
    SOURCE_DATE_EPOCH=0 \
    CARGO_HOME=/usr/local/cargo \
    # Pin the Rust toolchain so `rustup update` in this image cannot change it.
    RUSTUP_TOOLCHAIN=1.94.1

# Verify the installed Rust version matches our pin before building anything.
RUN rustc --version | grep -q "1.94.1" || \
    (echo "❌ Rust version mismatch — expected 1.94.1" && exit 1)

RUN rustup target add wasm32v1-none && \
    rustup component add rust-src

# Pin stellar-cli to a specific version so the WASM optimizer it applies is
# reproducible.  Update this alongside Cargo.toml MSRV bumps.
RUN cargo install --locked stellar-cli@28.1.0 --features opt 2>/dev/null || \
    cargo install stellar-cli@28.1.0 --features opt

WORKDIR /build

# Copy lockfile + manifests first so dependency layer is cached separately.
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/contracts ./contracts
COPY backend/services  ./services
COPY backend/tests     ./tests

# Build all contracts in release mode.
# The --locked flag ensures the exact versions from Cargo.lock are used.
RUN cargo build --release --locked --target wasm32v1-none \
        --package stellar-bounty-contract \
        --package stellar-core-contract \
        --package stellar-escrow-contract \
        --package stellar-freelancer-contract \
        --package stellar-governance-contract \
        --package stellar-identity-contract \
        --package stellar-insurance-contract \
        --package oracle \
        --package stellar-referral-contract \
        --package stellar_insights

# Optimize with stellar-cli wasm optimize for smaller, deterministic output.
RUN for pkg in \
      stellar_bounty_contract stellar_core_contract stellar_escrow_contract \
      stellar_freelancer_contract stellar_governance_contract stellar_identity_contract \
      stellar_insurance_contract oracle stellar_referral_contract stellar_insights; \
    do \
      stellar contract optimize \
        --wasm "target/wasm32v1-none/release/${pkg}.wasm" \
        --wasm-out "target/wasm32v1-none/release/${pkg}.wasm" 2>/dev/null || true; \
    done

# Cargo names each wasm file after its package name (hyphens -> underscores,
# e.g. stellar-bounty-contract -> stellar_bounty_contract.wasm) — rename to
# the short names the artifacts stage (and scripts/build-reproducible.sh,
# which extracts from this image) expect. oracle and stellar_insights
# already match their package names, so they need no rename.
RUN cd target/wasm32v1-none/release && \
    cp stellar_bounty_contract.wasm      bounty.wasm && \
    cp stellar_core_contract.wasm        core.wasm && \
    cp stellar_escrow_contract.wasm      escrow.wasm && \
    cp stellar_freelancer_contract.wasm  freelancer.wasm && \
    cp stellar_governance_contract.wasm  governance.wasm && \
    cp stellar_identity_contract.wasm    identity.wasm && \
    cp stellar_insurance_contract.wasm   insurance.wasm && \
    cp stellar_referral_contract.wasm    referral.wasm

# Compute and store hashes inside the image so the artifacts stage can copy
# them out alongside the WASM files.
RUN cd target/wasm32v1-none/release && \
    sha256sum \
      bounty.wasm core.wasm escrow.wasm freelancer.wasm governance.wasm \
      identity.wasm insurance.wasm oracle.wasm referral.wasm stellar_insights.wasm \
    > /build/wasm-hashes.sha256 && \
    echo "📋 WASM hashes computed:" && cat /build/wasm-hashes.sha256

# — Output stage —————————————————————————————————————————————————————————
FROM scratch AS artifacts
COPY --from=builder \
    /build/target/wasm32v1-none/release/bounty.wasm \
    /build/target/wasm32v1-none/release/core.wasm \
    /build/target/wasm32v1-none/release/escrow.wasm \
    /build/target/wasm32v1-none/release/freelancer.wasm \
    /build/target/wasm32v1-none/release/governance.wasm \
    /build/target/wasm32v1-none/release/identity.wasm \
    /build/target/wasm32v1-none/release/insurance.wasm \
    /build/target/wasm32v1-none/release/oracle.wasm \
    /build/target/wasm32v1-none/release/referral.wasm \
    /build/target/wasm32v1-none/release/stellar_insights.wasm \
    /wasm-hashes.sha256 \
    /
