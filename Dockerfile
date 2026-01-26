FROM node:20-slim AS deps

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NPM_CONFIG_OPTIONAL=true
ENV NPM_CONFIG_IGNORE_SCRIPTS=false
ENV NPM_CONFIG_OMIT=

COPY package.json package-lock.json ./
RUN npm ci --include=optional \
  && node -e "const fs=require('fs');const path=require('path');const root=process.cwd();const bin=path.join(root,'node_modules','lightningcss-linux-x64-gnu','lightningcss.linux-x64-gnu.node');if(fs.existsSync(bin)){const target=path.join(root,'node_modules','lightningcss','lightningcss.linux-x64-gnu.node');fs.copyFileSync(bin,target);}const wasmSrc=path.join(root,'node_modules','lightningcss-wasm','pkg');const wasmDst=path.join(root,'node_modules','lightningcss','pkg');if(fs.existsSync(wasmSrc)){fs.cpSync(wasmSrc,wasmDst,{recursive:true});}"

FROM node:20-slim AS builder

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG DEPLOY_TARGET=tencent
ARG NEXT_PUBLIC_DEPLOY_TARGET=tencent
ARG DATABASE_URL=mysql://build_placeholder:pass@localhost:3306/mornspeaker
ARG TENCENT_DATABASE_URL=mysql://build_placeholder:pass@localhost:3306/mornspeaker

ENV DEPLOY_TARGET=${DEPLOY_TARGET}
ENV NEXT_PUBLIC_DEPLOY_TARGET=${NEXT_PUBLIC_DEPLOY_TARGET}
ENV DATABASE_URL=${DATABASE_URL}
ENV TENCENT_DATABASE_URL=${TENCENT_DATABASE_URL}

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

RUN npm run build

FROM node:20-slim AS production

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

ARG PORT=3000
ENV PORT=${PORT}

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --include=optional

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/prisma ./prisma

RUN groupadd -g 1001 nodejs
RUN useradd -u 1001 -g nodejs -m nextjs
RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
CMD ["npm", "run", "start"]
