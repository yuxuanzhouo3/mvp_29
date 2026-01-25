FROM node:20-slim AS base

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ARG DEPLOY_TARGET=tencent
ARG NEXT_PUBLIC_DEPLOY_TARGET=tencent
ARG DATABASE_URL=mysql://build_placeholder:pass@localhost:3306/mornspeaker
ARG TENCENT_DATABASE_URL=mysql://build_placeholder:pass@localhost:3306/mornspeaker

ENV DEPLOY_TARGET=$DEPLOY_TARGET
ENV NEXT_PUBLIC_DEPLOY_TARGET=$NEXT_PUBLIC_DEPLOY_TARGET
ENV DATABASE_URL=$DATABASE_URL
ENV TENCENT_DATABASE_URL=$TENCENT_DATABASE_URL

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

RUN npm run build

FROM node:20-slim AS production

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

ARG PORT=3000
ENV PORT=$PORT

COPY --from=base /app/package.json ./
RUN npm install --omit=dev

COPY --from=base /app/.next ./.next
COPY --from=base /app/public ./public
COPY --from=base /app/next.config.mjs ./next.config.mjs

RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
CMD ["npm", "run", "start:migrate"]
