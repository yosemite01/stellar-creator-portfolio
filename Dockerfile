# Reproducible Soroban contract builder.
#
# Mirrors the stellar/soroban-tools image environment so the WASM output is
# byte-for-byte identical regardless of where this runs (CI or local).
#
# Pinned versions — bump deliberately and re-verify hashes.
FROM rust:1.74.0-slim AS builder

# Reproducibility: no incremental compilation, deterministic codegen.
ENV CARGO_INCREMENTAL=0 \
    CARGO_NET_RETRY=10 \
    RUSTFLAGS="-C codegen-units=1" \
    SOURCE_DATE_EPOCH=0

RUN rustup target add wasm32-unknown-unknown && \
    rustup component add rust-src

WORKDIR /build

# Copy lockfile + manifests first so dependency layer is cached separately.
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/contracts ./contracts
COPY backend/services  ./services
COPY backend/tests     ./tests

# Build all contracts in release mode.
RUN cargo build --release --target wasm32-unknown-unknown \
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

# Cargo names each wasm file after its package name (hyphens -> underscores,
# e.g. stellar-bounty-contract -> stellar_bounty_contract.wasm) — rename to
# the short names the artifacts stage (and scripts/build-reproducible.sh,
# which extracts from this image) expect. oracle and stellar_insights
# already match their package names, so they need no rename.
RUN cd target/wasm32-unknown-unknown/release && \
    cp stellar_bounty_contract.wasm      bounty.wasm && \
    cp stellar_core_contract.wasm        core.wasm && \
    cp stellar_escrow_contract.wasm      escrow.wasm && \
    cp stellar_freelancer_contract.wasm  freelancer.wasm && \
    cp stellar_governance_contract.wasm  governance.wasm && \
    cp stellar_identity_contract.wasm    identity.wasm && \
    cp stellar_insurance_contract.wasm   insurance.wasm && \
    cp stellar_referral_contract.wasm    referral.wasm

# — Output stage —————————————————————————————————————————————————————————
FROM scratch AS artifacts
COPY --from=builder \
    /build/target/wasm32-unknown-unknown/release/bounty.wasm \
    /build/target/wasm32-unknown-unknown/release/core.wasm \
    /build/target/wasm32-unknown-unknown/release/escrow.wasm \
    /build/target/wasm32-unknown-unknown/release/freelancer.wasm \
    /build/target/wasm32-unknown-unknown/release/governance.wasm \
    /build/target/wasm32-unknown-unknown/release/identity.wasm \
    /build/target/wasm32-unknown-unknown/release/insurance.wasm \
    /build/target/wasm32-unknown-unknown/release/oracle.wasm \
    /build/target/wasm32-unknown-unknown/release/referral.wasm \
    /build/target/wasm32-unknown-unknown/release/stellar_insights.wasm \
    /
