import tcb from "@cloudbase/node-sdk"

type CloudBaseAdminApp = ReturnType<typeof tcb.init>

const globalForCloudBaseAdmin = globalThis as unknown as {
  __voicelinkCloudBaseAdminApp?: CloudBaseAdminApp
}

function resolveEnvId(): string {
  const envId =
    process.env.TENCENT_ENV_ID ||
    process.env.NEXT_PUBLIC_TENCENT_ENV_ID
  if (!envId) {
    throw new Error("Missing TENCENT_ENV_ID")
  }
  return envId
}

export function getCloudBaseAdminApp(): CloudBaseAdminApp {
  if (globalForCloudBaseAdmin.__voicelinkCloudBaseAdminApp) {
    return globalForCloudBaseAdmin.__voicelinkCloudBaseAdminApp
  }

  const envId = resolveEnvId()
  const secretId =
    process.env.TENCENT_SECRET_ID ||
    process.env.TENCENTCLOUD_SECRETID ||
    process.env.TENCENT_CLOUD_SECRETID
  const secretKey =
    process.env.TENCENT_SECRET_KEY ||
    process.env.TENCENTCLOUD_SECRETKEY ||
    process.env.TENCENT_CLOUD_SECRETKEY
  const hasCloudRuntime = Boolean(process.env.TENCENTCLOUD_RUNENV || process.env.TENCENT_APP_ID)

  if (!hasCloudRuntime && (!secretId || !secretKey)) {
    throw new Error("Missing CloudBase credentials")
  }

  const app =
    secretId && secretKey
      ? tcb.init({ env: envId, secretId, secretKey })
      : tcb.init({ env: envId })

  globalForCloudBaseAdmin.__voicelinkCloudBaseAdminApp = app
  return app
}
