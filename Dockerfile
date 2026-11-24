FROM rust:1.82-bookworm AS builder
WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
COPY static ./static
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/kundoluk-web .
COPY static ./static
ENV PORT=10000
EXPOSE 10000
CMD ["./kundoluk-web"]
