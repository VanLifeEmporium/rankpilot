# RankPilot

Private deployment repository for Van Life Emporium's Shopify SEO and answer-readiness app.

The full editable application source, tests, migration files, extension and documentation are bundled in `rankpilot-source.tar.gz`. The Dockerfile extracts that source and builds the web app and worker together. This initial browser upload uses an archive to preserve source directory paths. Extract the archive for local development; update it when deploying source changes, or replace this bootstrap layout with the extracted source and its original Dockerfile using Git.

## Render configuration

- Runtime: Docker
- Branch: main
- Dockerfile: ./Dockerfile
- Root directory: leave blank
- Health check: /health
- Persistent disk: 1 GB at /data
- One service instance, with both web process and background worker
- Configure production environment values before deploying. Do not commit credentials.

Required environment variables: DEMO_MODE=false, NODE_ENV=production, DATABASE_URL=file:/data/rankpilot.sqlite, SHOPIFY_APP_URL (the real HTTPS service URL), SHOPIFY_API_KEY (your Client ID), SHOPIFY_API_SECRET, ENCRYPTION_KEY and SESSION_SECRET. See the bundled .env.example and docs/CREDENTIALS.md. ENCRYPTION_KEY must be 64 hexadecimal characters and must be backed up securely.

Hosting the server does not publish the Shopify theme extension. Shopify CLI linking/deployment and store installation remain separate steps. Keep approval mode enabled for live acceptance checks.

35 automated tests plus type checking, production build and desktop/mobile smoke checks passed in the source package. Live Shopify/provider checks remain outstanding.
