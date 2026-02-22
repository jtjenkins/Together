# ── Build Stage ──────────────────────────────────────────────────────────────
FROM rust:1.83-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy manifests first for dependency cache layer
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && \
    SQLX_OFFLINE=true cargo build --release && \
    rm -rf src

# Copy actual source + build artefacts sqlx needs
COPY server/src ./src
COPY server/.sqlx ./.sqlx
ENV SQLX_OFFLINE=true
RUN touch src/main.rs && cargo build --release

# ── Runtime Stage ─────────────────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libssl3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/together-server ./together-server
COPY server/migrations ./migrations

RUN mkdir -p /app/uploads
EXPOSE 8080
CMD ["./together-server"]
