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
RUN npm ci && npx prisma generate && npm run build
ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/rankpilot.sqlite
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm run setup && npm run start:all"]
