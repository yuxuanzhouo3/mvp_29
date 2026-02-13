import { Api } from 'tls-sig-api-v2';

/**
 * Generate UserSig for TRTC
 * @param userId User ID
 * @param expire Expire time in seconds (default 86400 * 7)
 * @returns UserSig string
 */
export function generateUserSig(userId: string, expire: number = 604800): string {
  const SDKAPPID = parseInt(process.env.TENCENT_TRTC_SDK_APP_ID || "0", 10);
  const SECRETKEY = process.env.TENCENT_TRTC_SECRET_KEY || "";

  if (!SDKAPPID || !SECRETKEY) {
    throw new Error("Missing TRTC SDKAppID or secret key in environment variables");
  }

  const api = new Api(SDKAPPID, SECRETKEY);
  return api.genUserSig(userId, expire);
}
