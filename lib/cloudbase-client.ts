import cloudbase from "@cloudbase/js-sdk";

let app: any = null;

export const getCloudBaseApp = () => {
  if (app) return app;

  const envId = process.env.NEXT_PUBLIC_TENCENT_ENV_ID || "mornspeaker-0gimakjfaa3a7697";

  app = cloudbase.init({
    env: envId,
    region: "ap-shanghai",
  });

  return app;
};

export const getCloudBaseAuth = () => {
  const app = getCloudBaseApp();
  return app.auth();
};

export const getCloudBaseDb = () => {
  const app = getCloudBaseApp();
  return app.database();
};
