# Stage 1: Build the packed npm tarball
FROM node:24-bookworm-slim AS builder

WORKDIR /build

RUN corepack enable && corepack prepare pnpm@12.14.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json ./
COPY packages ./packages
COPY LICENSE README.md ./

RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN cd packages/cli && npm pack --pack-destination /build

# Stage 2: Runtime
FROM node:24-bookworm-slim AS runtime

ARG VERSION=0.1.0

LABEL org.opencontainers.image.source="https://github.com/kitalonlabs/pgmoat" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.description="Governed, read-only Postgres access for AI agents"

WORKDIR /home/node

# Copy and install the packed tarball from builder stage
COPY --from=builder /build/pgmoat-*.tgz /tmp/
RUN npm install -g /tmp/pgmoat-*.tgz && rm -rf /tmp/pgmoat-*.tgz

# Mount point for custom configuration
# Usage: docker run --rm -v $(pwd)/pgmoat.yaml:/etc/pgmoat/config.yaml pgmoat:dev start --config /etc/pgmoat/config.yaml
RUN mkdir -p /etc/pgmoat && chown -R node:node /etc/pgmoat

USER node

ENTRYPOINT ["pgmoat"]
CMD ["start", "--url-env", "PGMOAT_DATABASE_URL"]

