# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
# python3/make/g++ are needed to compile better-sqlite3's native binding for
# whichever platform this stage is currently building (linux/amd64 or
# linux/arm64 - see the release workflow's buildx platforms).
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# The release workflow already passes this as a build-arg (from the git tag
# or workflow_dispatch input) - NEXT_PUBLIC_ vars must be set before `next
# build` since Next.js inlines them into the client bundle at build time,
# not read at runtime.
ARG RELEASE_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$RELEASE_VERSION
# `next build` collects page data by actually loading each route's server
# module, which opens the sqlite file at import time (see lib/db/index.ts) -
# give it a directory to create a throwaway build-time db file in.
RUN mkdir -p ./config && npm run build

FROM node:20-alpine AS runner
# node:20-alpine already ships a "node" user/group at uid/gid 1000 - reuse it
# rather than creating a second one (which collides on gid 1000).
WORKDIR /app

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/drizzle ./drizzle

RUN mkdir -p /app/config && chown -R node:node /app/config

USER node
ENV DATABASE_PATH=/app/config/tally.db
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["node", "server.js"]
