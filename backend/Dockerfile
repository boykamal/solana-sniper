# ── BUILDER STAGE ────────────────────────────────────────────────────────────
FROM rust:1.85-slim-bookworm AS builder

RUN apt-get update && apt-get install -y \
    pkg-config libssl-dev libclang-dev clang curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./

# Cache dependencies by building empty main first
RUN mkdir src && echo "fn main(){}" > src/main.rs
RUN cargo build --release || true
RUN rm -rf src

# Build real source — touch files to force Cargo to recompile
COPY src ./src
RUN touch src/main.rs && cargo build --release

# ── RUNTIME STAGE ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/sniper ./sniper

EXPOSE 8080
CMD ["./sniper"]