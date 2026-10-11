# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/sq-cosigner/package.json services/sq-cosigner/package.json
COPY services/recovery-partner/package.json services/recovery-partner/package.json
COPY services/sq-bank/package.json services/sq-bank/package.json
COPY services/market-data/package.json services/market-data/package.json
COPY services/vasp-mock/package.json services/vasp-mock/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
# Optional build-only CA for environments with a trusted HTTPS inspection proxy.
# The certificate is a BuildKit secret mount, never copied into the runtime image.
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node packages ./packages
COPY --chown=node:node services ./services
COPY --chown=node:node contracts ./contracts
COPY --chown=node:node deployment ./deployment
RUN mkdir -p /data && chown node:node /data /app/package.json /app/package-lock.json
USER node
ENV NODE_ENV=production PORT=8080 BACKEND_ENV_FILE=/data/backend.env \
    COSIGNER_DATA_DIR=/data/cosigner PARTNER_DATA_DIR=/data/partner \
    BANK_DATA_DIR=/data/bank VASP_DATA_DIR=/data/vasp
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deployment/start.mjs"]
