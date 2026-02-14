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

# 优化 Node.js 内存使用和性能
ENV NODE_OPTIONS="--max-old-space-size=384 --optimize-for-size"
ENV NEXT_TELEMETRY_DISABLED=1

ARG PORT=3000
ENV PORT=${PORT}

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN groupadd -g 1001 nodejs
RUN useradd -u 1001 -g nodejs -m nextjs
RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
CMD ["node", "server.js"]
