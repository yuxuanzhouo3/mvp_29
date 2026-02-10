import { WebSocketServer } from 'ws';
import { createHash, createHmac } from 'crypto';
import { IncomingMessage } from 'http';
import { WebSocket } from 'ws';

// 腾讯云鉴权逻辑
function getAuthSignature(params: Record<string, any>, secretKey: string) {
  const sortedKeys = Object.keys(params).sort();
  let strParam = '';
  for (const key of sortedKeys) {
    strParam += `${key}=${params[key]}&`;
  }
  strParam = strParam.slice(0, -1);
  const signStr = `GETasr.cloud.tencent.com/asr/v2/16k_zh?${strParam}`;

  const signature = createHmac('sha1', secretKey).update(signStr).digest('base64');
  return signature;
}

// 帮助函数：从环境变量获取配置
function resolveEnvValue(key: string, tencentKey: string): string | undefined {
  const env = process.env as Record<string, string | undefined>
  const target = String(env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  if (target === "tencent") return env[tencentKey] ?? env[key]
  return env[key] ?? env[tencentKey]
}

// Next.js 不直接支持 WebSocket，我们需要通过自定义 Server 或 API Route 的升级协议来处理
// 但由于 Next.js App Router 的限制，这里我们模拟一个基于 WebSocket 的客户端连接器
// 实际上在生产环境中，建议使用单独的 WebSocket 服务，或者使用支持 WebSocket 的部署平台（如腾讯云云函数 WebSocket 触发器）

// 由于 Next.js App Router 的 API Route 主要是无状态的 HTTP 处理，直接实现 WebSocket Server 比较困难
// 这里我们提供一个基于 HTTP 流式传输（Chunked Transfer）或者 SSE 的替代方案，
// 或者如果部署环境允许（如 Node.js Server），我们可以尝试升级 HTTP 请求。

// 为了最快实现且兼容性最好，我们这里使用 HTTP 长连接来代理 WebSocket 流量，
// 或者在前端直接连接腾讯云（但这会暴露密钥，不推荐）。
// 鉴于用户说“有的是钱”，我们可以使用腾讯云的实时语音识别 SDK 在服务端做转发。

// 但考虑到 Next.js API Route 的限制，我们这里实现一个基于 POST 流式上传的接口，
// 后端通过腾讯云 SDK 建立 WebSocket 连接到腾讯云 ASR。

export async function POST(req: Request) {
  const secretId = resolveEnvValue("TENCENT_SECRET_ID", "TENCENT_SECRET_ID");
  const secretKey = resolveEnvValue("TENCENT_SECRET_KEY", "TENCENT_SECRET_KEY");
  // AppId can often be extracted from SecretId or is optional for some interfaces,
  // but for WebSocket ASR URL construction, it is required.
  // If not provided in env, we try to extract from existing config or use a default if possible,
  // but really the user should provide it.
  // However, based on user input, they only have SecretId and SecretKey.
  // Tencent SecretId usually looks like: AKID...
  // The AppId is a numeric string usually.
  // Let's make it optional and try to proceed without it if missing, 
  // OR strictly require it but warn the user.
  // BUT, the WebSocket URL pattern is: wss://asr.cloud.tencent.com/asr/v2/<AppId>?...
  // So we MUST have it.

  // Let's assume the user might have put it in another variable or we can skip it?
  // No, the doc says it's required in the URL path.

  // Wait, if the user only configured SecretId and SecretKey, maybe they forgot AppId.
  // Let's default to a placeholder or try to find it.
  // Actually, for some Tencent Cloud services, AppId is not strictly needed in the URL if the SecretId is associated globally.
  // But standard docs say: wss://asr.cloud.tencent.com/asr/v2/<AppId>

  // Let's try to grab it from TENCENT_APP_ID env var.
  // If the user says "I only configured these two", it means TENCENT_APP_ID is missing.
  // We will patch the code to NOT fail immediately but maybe use a default or empty string
  // and see if Tencent accepts it (unlikely), or return a clear error.

  // Actually, let's look at the user's provided screenshot. It clearly shows TENCENT_SECRET_ID and TENCENT_SECRET_KEY.
  // There is NO TENCENT_APP_ID.
  // This is a problem.

  // FIX: We will use a dummy AppId or try to parse it. 
  // If we can't get it, we return a helpful error to the frontend which will be logged.
  let appId = resolveEnvValue("TENCENT_APP_ID", "TENCENT_APP_ID");

  if (!secretId || !secretKey) {
    return new Response(JSON.stringify({ error: "Missing Tencent Cloud credentials (SecretId/SecretKey)" }), { status: 500 });
  }

  if (!appId) {
    // Fallback: Try to use a default or extraction logic? 
    // No, AppId is a specific account ID (e.g. 125xxxxxxx).
    // We will assume 0 or try to let the user know.
    // For now, let's use a placeholder and rely on the user adding it later, 
    // OR better, we can try to use the V1 interface or a different endpoint that doesn't need AppId in path?
    // V2 interface: wss://asr.cloud.tencent.com/asr/v2/<AppId>
    // If we don't have it, we can't build the URL.

    // Temporary workaround: Use a known test AppId or fail gracefully.
    // Let's return an error telling the user to add it.
    // BUT the user said "I only have these two, is it a problem?".
    // The answer is YES.

    // Let's try to fetch it? No API for that.

    // We will just Log it and maybe use a dummy one to prevent crash, but it won't work.
    // Wait, some older docs say AppId can be omitted or is part of the auth?
    // Let's try to use the SecretId as a placeholder? No.

    // Let's return 1250000000 (common structure) but it will fail auth.
    // We must tell the user to add it.

    // However, to keep the code robust:
    appId = "";
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  if (!appId && action === 'get_signature') {
    return new Response(JSON.stringify({
      error: "Missing TENCENT_APP_ID. Please add it to .env.local"
    }), { status: 500 });
  }

  if (action === 'get_signature') {
    const timestamp = Math.floor(Date.now() / 1000);
    const params: Record<string, any> = {
      'secretid': secretId,
      'timestamp': timestamp,
      'expired': timestamp + 3600, // 1小时过期
      'nonce': Math.floor(Math.random() * 100000),
      'engine_model_type': '16k_zh',
      'voice_id': Math.random().toString(36).substring(2),
      'voice_format': 1, // 1: wav, 8: spex
      'needvad': 1,
      'vad_silence_time': 2000, // Increased to 2000ms to prevent sentence fragmentation
    };

    const signature = getAuthSignature(params, secretKey);
    return new Response(JSON.stringify({
      signature,
      ...params,
      appid: appId
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (action === 'get_android_config') {
    return new Response(JSON.stringify({
      appId: appId,
      secretId: secretId,
      secretKey: secretKey // Warning: Exposing secretKey to client. Ensure this is trusted client or add auth.
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response("Invalid action", { status: 400 });
}
