FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY rankpilot-source.tar.gz /tmp/rankpilot-source.tar.gz
RUN tar -xzf /tmp/rankpilot-source.tar.gz --strip-components=1 -C /app && rm /tmp/rankpilot-source.tar.gz
COPY patches/generation.server.ts /app/app/core/generation.server.ts
COPY patches/generation.test.ts /app/tests/generation.test.ts
COPY patches/Workspace.tsx /app/app/components/Workspace.tsx
COPY patches/job-feedback.ts /app/app/core/job-feedback.ts
COPY patches/ui.server.ts /app/app/core/ui.server.ts
COPY patches/job-feedback.test.ts /app/tests/job-feedback.test.ts
COPY patches/service.server.ts /app/app/core/service.server.ts
COPY patches/catalogue.ts /app/app/core/catalogue.ts
COPY patches/finding-workflow.ts /app/app/core/finding-workflow.ts
COPY patches/health.ts /app/app/routes/health.ts
COPY patches/worker.ts /app/scripts/worker.ts
COPY patches/generate-feedback.test.ts /app/tests/generate-feedback.test.ts
COPY patches/finding-workflow.test.ts /app/tests/finding-workflow.test.ts
COPY patches/workflow-lifecycle.test.ts /app/tests/workflow-lifecycle.test.ts
COPY patches/app.tsx /app/app/routes/app.tsx
COPY patches/section-guide.ts /app/app/core/section-guide.ts
COPY patches/job-revision.ts /app/app/core/job-revision.ts
COPY patches/app.job-status.ts /app/app/routes/app.job-status.ts
COPY patches/proposal-repair.server.ts /app/app/core/proposal-repair.server.ts
COPY patches/proposal-repair.test.ts /app/tests/proposal-repair.test.ts
COPY patches/release5/app/components/ChangeValues.tsx /app/app/components/ChangeValues.tsx
COPY patches/release5/app/components/Connections.tsx /app/app/components/Connections.tsx
COPY patches/release5/app/components/Download.tsx /app/app/components/Download.tsx
COPY patches/release5/app/components/SectionHeading.tsx /app/app/components/SectionHeading.tsx
COPY patches/release5/app/core/analytics.ts /app/app/core/analytics.ts
COPY patches/release5/app/core/connections.ts /app/app/core/connections.ts
COPY patches/release5/app/core/context.server.ts /app/app/core/context.server.ts
COPY patches/release5/app/core/crawl.server.ts /app/app/core/crawl.server.ts
COPY patches/release5/app/core/integrations.server.ts /app/app/core/integrations.server.ts
COPY patches/release5/app/core/jobs.server.ts /app/app/core/jobs.server.ts
COPY patches/release5/app/core/proposal-value.ts /app/app/core/proposal-value.ts
COPY patches/release5/app/core/shopify-api.server.ts /app/app/core/shopify-api.server.ts
COPY patches/release5/app/core/subsection-guide.ts /app/app/core/subsection-guide.ts
COPY patches/release5/app/core/ui-data.server.ts /app/app/core/ui-data.server.ts
COPY patches/release5/app/core/worker-health.server.ts /app/app/core/worker-health.server.ts
COPY patches/release5/app/routes/app._index.tsx /app/app/routes/app._index.tsx
COPY patches/release5/app/routes/app.resource.ts /app/app/routes/app.resource.ts
COPY patches/release5/app/routes/webhooks.privacy.tsx /app/app/routes/webhooks.privacy.tsx
COPY patches/release5/app/styles.css /app/app/styles.css
COPY patches/release5/tests/audit-reproductions.test.ts /app/tests/audit-reproductions.test.ts
COPY patches/release5/tests/content-safeguards.test.ts /app/tests/content-safeguards.test.ts
COPY patches/release5/tests/core.test.ts /app/tests/core.test.ts
COPY patches/release5/tests/release5-ui.test.ts /app/tests/release5-ui.test.ts
COPY patches/release5/prisma/migrations/20260924220000_generation_cache/migration.sql /app/prisma/migrations/20260924220000_generation_cache/migration.sql
COPY patches/release5/prisma/schema.prisma /app/prisma/schema.prisma
COPY patches/release51/ReviewActions.tsx /app/app/components/ReviewActions.tsx
COPY patches/release51/review-actions.test.ts /app/tests/review-actions.test.ts
COPY patches/release6/app/routes/health.ts /app/app/routes/health.ts
COPY patches/release6/app/components/FactImport.tsx /app/app/components/FactImport.tsx
COPY patches/release6/app/components/Workspace.tsx /app/app/components/Workspace.tsx
COPY patches/release6/app/core/workflow-ui.ts /app/app/core/workflow-ui.ts
COPY patches/release6/app/core/catalogue.ts /app/app/core/catalogue.ts
COPY patches/release6/app/core/types.ts /app/app/core/types.ts
COPY patches/release6/app/core/fact-import.ts /app/app/core/fact-import.ts
COPY patches/release6/app/core/ui.server.ts /app/app/core/ui.server.ts
COPY patches/release6/app/core/content-policy.ts /app/app/core/content-policy.ts
COPY patches/release6/app/core/job-revision.ts /app/app/core/job-revision.ts
COPY patches/release6/app/core/job-feedback.ts /app/app/core/job-feedback.ts
COPY patches/release6/app/core/subsection-guide.ts /app/app/core/subsection-guide.ts
COPY patches/release6/app/core/generation.server.ts /app/app/core/generation.server.ts
COPY patches/release6/app/core/service.server.ts /app/app/core/service.server.ts
COPY patches/release6/tests/core.test.ts /app/tests/core.test.ts
COPY patches/release6/tests/job-feedback.test.ts /app/tests/job-feedback.test.ts
COPY patches/release6/tests/workflow-lifecycle.test.ts /app/tests/workflow-lifecycle.test.ts
COPY patches/release6/tests/feedback-ui.mjs /app/tests/feedback-ui.mjs
COPY patches/release6/tests/feedback-regressions.test.ts /app/tests/feedback-regressions.test.ts
RUN npm ci && npx prisma generate && npm run build
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/rankpilot.sqlite
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run setup && npm run start:all"]
