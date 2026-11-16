# Slika za sopstveni server. Nije izgrađena ni pokrenuta u razvojnom okruženju
# (Docker servis nije bio dostupan) — proverite je pre produkcione upotrebe.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/package.json /app/next.config.ts /app/tsconfig.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migracije se primenjuju pre starta; više instanci se usklađuje zaključavanjem u bazi.
CMD ["sh", "-c", "npm run migrate && npm start"]
