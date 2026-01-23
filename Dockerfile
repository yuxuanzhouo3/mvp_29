FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install

# === 构建时环境变量配置 ===
# 云托管控制台配置的环境变量通常只在运行时生效，构建阶段无法获取。
# 因此我们需要在 Dockerfile 中显式设置这些变量的默认值/占位符，
# 确保 npm run build (包含 adapt-schema.js 和 prisma generate) 能顺利执行。

# 1. 强制指定部署目标为腾讯云，触发 scripts/adapt-schema.js 切换为 MySQL
ENV DEPLOY_TARGET="tencent"
ENV NEXT_PUBLIC_DEPLOY_TARGET="tencent"

# 2. 提供一个符合 MySQL 格式的占位符数据库连接串
# 这仅用于骗过 Prisma 在构建时的格式校验，不会用于实际连接。
# 运行时，云平台注入的真实 TENCENT_DATABASE_URL 会通过 start:migrate 脚本生效。
ENV DATABASE_URL="mysql://build_placeholder:pass@localhost:3306/mornspeaker"
ENV TENCENT_DATABASE_URL="mysql://build_placeholder:pass@localhost:3306/mornspeaker"

COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start:migrate"]
