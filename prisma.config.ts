import "dotenv/config"
import fs from "fs"
import path from "path"
import { config } from "dotenv"
import { defineConfig, env } from "prisma/config"

const localEnvPath = path.join(process.cwd(), ".env.local")
if (fs.existsSync(localEnvPath)) {
  config({ path: localEnvPath })
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
})
