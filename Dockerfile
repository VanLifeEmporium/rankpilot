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
RUN npm ci && npx prisma generate && npm run build
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/rankpilot.sqlite
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run setup && npm run start:all"]
