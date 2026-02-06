# MornClient 微信小程序模板

网页套壳微信小程序模板，支持集中配置管理。

---

## 集中配置管理

所有配置集中在 `appConfig.js`：

```javascript
module.exports = {
  general: {
    initialUrl: 'https://your-website.com',  // 目标网页 URL
    appName: '应用名称',
    appId: 'wx1234567890abcdef',              // 小程序 AppID
    version: '1.0.0',
  },
};
```

| 字段 | 说明 |
|------|------|
| `initialUrl` | 内嵌网页 URL |
| `appName` | 应用名称 |
| `appId` | 小程序 AppID |
| `version` | 版本号 |

## 图标替换

替换以下位置的图标文件：

| 路径 | 说明 |
|------|------|
| `images/logo.png` | 应用 Logo |
| `images/tabbar/` | 底部导航图标 |

## 隐私政策

修改 `pages/privacy/privacy.wxml` 或配置远程隐私政策 URL。

---

# 网页端适配指南

> **本文档用途**：当网页项目需要在微信小程序 WebView 中实现原生登录时，按照本指南完成网页端适配即可。小程序模板��码无需修改。

---

## 快速适配清单

| 序号 | 任务 | 文件路径 | 说明 |
|------|------|----------|------|
| 1 | 创建 check API | `/api/wxlogin/check/route.ts` | 用户预检查，消耗 code 返回 token |
| 2 | 创建 mp-callback API | `/api/auth/mp-callback/route.ts` | 设置 cookie + 更新用户资料 |
| 3 | 创建工具库 | `/lib/wechat-mp.ts` | 环境检测、参数解析等 |
| 4 | 修改登录组件 | 登录页面组件 | 添加小程序登录回调处理 |
| 5 | 配置环境变量 | `.env.local` | 小程序 AppID 和 Secret |

---

## 1. 核心原理

```
小程序端                                    网页端
┌─────────────────────────────────────┐    ┌─────────────────────────────────┐
│ login.js                            │    │                                 │
│   ├─ wx.login() 获取 code           │    │                                 │
│   ├─ 调用 /api/wxlogin/check        │───▶│ check API 消耗 code 返回 token  │
│   └─ 保存 token 到 storage          │    │                                 │
│                                     │    │                                 │
│ profile.js (新用户)                  │    │                                 │
│   └─ 保存 nickName/avatarUrl        │    │                                 │
│                                     │    │                                 │
│ webshell.js                         │    │                                 │
│   ├─ onShow 读取 storage            │    │                                 │
│   └─ URL 附加参数传递给 H5           │───▶│ 解析 URL 参数                   │
│      token, openid, nickName...     │    │   ├─ 调用 /api/auth/mp-callback │
│                                     │    │   ├─ 设置 cookie               │
│                                     │    │   └─ 更新用户资料               │
└─────────────────────────────────────┘    └─────────────────────────────────┘
```

**关键点**：
1. wx.login() 的 code 只能使用一次，被 check API 消耗后返回 token
2. wx.request 和 WebView 的 cookie 不共享，必须通过 URL 参数传递登录信息
3. mp-callback API 在 WebView 上下文设置 cookie，同时更新用户资料

---

## 2. API 实现

### 2.1 用户预检查 API

**文件**: `app/api/wxlogin/check/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code) {
      return NextResponse.json(
        { success: false, error: "INVALID_PARAMS", message: "code is required" },
        { status: 400 }
      );
    }

    // 获取小程序配置
    const appId = process.env.WX_MINI_APPID || process.env.WECHAT_APP_ID;
    const appSecret = process.env.WX_MINI_SECRET || process.env.WECHAT_APP_SECRET;

    if (!appId || !appSecret) {
      console.error("[wxlogin/check] Missing WX_MINI_APPID or WX_MINI_SECRET");
      return NextResponse.json(
        { success: false, error: "CONFIG_ERROR", message: "服务端配置错误" },
        { status: 500 }
      );
    }

    // 调用微信 jscode2session（消耗 code）
    const wxUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const wxResponse = await fetch(wxUrl);
    const wxData = await wxResponse.json();

    if (wxData.errcode || !wxData.openid) {
      console.error("[wxlogin/check] jscode2session error:", wxData);
      return NextResponse.json(
        { success: false, error: "INVALID_CODE", message: wxData.errmsg || "code 无效" },
        { status: 401 }
      );
    }

    const { openid, unionid } = wxData;

    // ========== 根据项目认证系统实现以下逻辑 ==========
    // 1. 查询用户是否存在
    // 2. 如果不存在则创建用户
    // 3. 生成登录 token
    // 4. 返回用户信息和 token

    // 示例（请替换为实际实现）：
    // const user = await db.users.findByOpenId(openid);
    // if (!user) {
    //   user = await db.users.create({ openid, unionid });
    // }
    // const token = await generateToken(user.id);

    const user = { id: "user_id", name: null, avatar: null }; // 替换为实际查询
    const token = "generated_token"; // 替换为实际生成
    // ================================================

    const hasProfile = !!(user.name && user.avatar);
    const expiresIn = 7 * 24 * 60 * 60; // 7 天

    console.log("[wxlogin/check] Success:", { openid, hasProfile });

    return NextResponse.json({
      success: true,
      exists: true,
      hasProfile,
      openid,
      token,
      expiresIn,
      userName: user.name || null,
      userAvatar: user.avatar || null,
    });
  } catch (error) {
    console.error("[wxlogin/check] Error:", error);
    return NextResponse.json(
      { success: false, error: "SERVER_ERROR", message: "服务器错误" },
      { status: 500 }
    );
  }
}
```

### 2.2 小程序回调 API

**文件**: `app/api/auth/mp-callback/route.ts`

```typescript
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { token, openid, expiresIn, nickName, avatarUrl } = await req.json();

    if (!token || !openid) {
      return NextResponse.json({ error: "Token and openid required" }, { status: 400 });
    }

    // ========== 更新用户资料（新用户首次登录）==========
    if (nickName || avatarUrl) {
      try {
        // 根据项目数据库实现更新逻辑
        // const user = await db.users.findByOpenId(openid);
        // if (user && (!user.name || user.name === "微信用户")) {
        //   await db.users.update(user.id, {
        //     name: nickName,
        //     avatar: avatarUrl
        //   });
        // }
        console.log("[mp-callback] Update user profile:", { openid, nickName, avatarUrl });
      } catch (updateError) {
        console.error("[mp-callback] Update failed:", updateError);
        // 更新失败不影响登录
      }
    }
    // ================================================

    const maxAge = expiresIn ? parseInt(String(expiresIn), 10) : 60 * 60 * 24 * 7;

    const res = NextResponse.json({ success: true, openid });

    // 设置 cookie（在 WebView 上下文中设置，H5 可以读取）
    res.cookies.set("auth-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge,
      path: "/",
    });

    console.log("[mp-callback] Cookie set for openid:", openid);
    return res;
  } catch (error) {
    console.error("[mp-callback] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
```

---

## 3. 前端工具库

**文件**: `lib/wechat-mp.ts`

```typescript
/**
 * 微信小程序登录工具库
 */

interface WxMiniProgram {
  postMessage?: (data: unknown) => void;
  navigateTo?: (options: { url: string }) => void;
  navigateBack?: (options?: { delta?: number }) => void;
  getEnv?: (callback: (res: { miniprogram: boolean }) => void) => void;
}

declare global {
  interface Window {
    wx?: { miniProgram?: WxMiniProgram };
    __wxjs_environment?: string;
  }
}

/** 检测是否在微信小程序环境中（同步快速检测） */
export function isMiniProgram(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("miniprogram")) return true;
  if (window.__wxjs_environment === "miniprogram") return true;
  // 检查 URL 参数
  const params = new URLSearchParams(window.location.search);
  if (params.get("_wxjs_environment") === "miniprogram") return true;
  return false;
}

/** 获取微信小程序 SDK 对象 */
export function getWxMiniProgram(): WxMiniProgram | null {
  if (typeof window === "undefined") return null;
  const wxObj = window.wx;
  if (!wxObj || typeof wxObj !== "object") return null;
  const mp = wxObj.miniProgram;
  if (!mp || typeof mp !== "object") return null;
  return mp;
}

/** 等待微信 JS SDK 加载完成 */
export function waitForWxSDK(timeout = 3000): Promise<WxMiniProgram | null> {
  return new Promise((resolve) => {
    const mp = getWxMiniProgram();
    if (mp) {
      resolve(mp);
      return;
    }
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      const mp = getWxMiniProgram();
      if (mp) {
        clearInterval(checkInterval);
        resolve(mp);
        return;
      }
      if (Date.now() - startTime >= timeout) {
        clearInterval(checkInterval);
        resolve(null);
      }
    }, 100);
  });
}

/** 登录回调数据 */
export interface WxMpLoginCallback {
  token: string | null;
  openid: string | null;
  expiresIn: string | null;
  nickName: string | null;
  avatarUrl: string | null;
  code: string | null;
}

/** 解析 URL 参数中的登录回调数据 */
export function parseWxMpLoginCallback(): WxMpLoginCallback | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const openid = params.get("openid");
  const code = params.get("mpCode");

  if (!token && !openid && !code) return null;

  return {
    token,
    openid,
    expiresIn: params.get("expiresIn"),
    nickName: params.get("mpNickName") ? decodeURIComponent(params.get("mpNickName")!) : null,
    avatarUrl: params.get("mpAvatarUrl") ? decodeURIComponent(params.get("mpAvatarUrl")!) : null,
    code,
  };
}

/** 清除 URL 中的登录参数 */
export function clearWxMpLoginParams(): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  const paramsToRemove = [
    "token", "openid", "expiresIn", "mpCode",
    "mpNickName", "mpAvatarUrl", "mpProfileTs", "mpReadyTs", "mpPongTs"
  ];
  paramsToRemove.forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, "", url.toString());
}

/** 请求微信小程序原生登录（异步版本，更健壮） */
export async function requestWxMpLogin(returnUrl?: string): Promise<boolean> {
  const mp = await waitForWxSDK();
  if (!mp) {
    console.warn("[wechat-mp] Not in WeChat MiniProgram environment or SDK not loaded");
    return false;
  }

  const currentUrl = returnUrl || window.location.href;

  if (typeof mp.navigateTo === "function") {
    const loginUrl = `/pages/webshell/login?returnUrl=${encodeURIComponent(currentUrl)}`;
    mp.navigateTo({ url: loginUrl });
    return true;
  }

  // 备用方案：使用 postMessage
  if (typeof mp.postMessage === "function") {
    mp.postMessage({ data: { type: "REQUEST_WX_LOGIN", returnUrl: currentUrl } });
    if (typeof mp.navigateBack === "function") {
      mp.navigateBack({ delta: 1 });
    }
    return true;
  }

  return false;
}

/** 使用 code 换取 token（兜底方案） */
export async function exchangeCodeForToken(
  code: string,
  nickName?: string | null,
  avatarUrl?: string | null
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const response = await fetch("/api/wxlogin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code, nickName, avatarUrl }),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      return { success: false, error: data.message || "登录失败" };
    }

    return { success: true, token: data.token };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "网络错误" };
  }
}
```

---

## 4. 登录组件集成

在登录页面组件中添加以下代码：

```typescript
import { useEffect, useCallback, useState } from "react";
import {
  isMiniProgram,
  parseWxMpLoginCallback,
  clearWxMpLoginParams,
  requestWxMpLogin,
  exchangeCodeForToken,
} from "@/lib/wechat-mp";

// 在组件内：

const [isInMiniProgram, setIsInMiniProgram] = useState(false);

// 1. 检测小程序环境
useEffect(() => {
  setIsInMiniProgram(isMiniProgram());
}, []);

// 2. 处理登录回调
const handleMpLoginCallback = useCallback(async () => {
  const callback = parseWxMpLoginCallback();
  if (!callback) return;

  try {
    // 情况1：直接收到 token（推荐流程）
    if (callback.token && callback.openid) {
      const res = await fetch("/api/auth/mp-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: callback.token,
          openid: callback.openid,
          expiresIn: callback.expiresIn,
          nickName: callback.nickName,    // 重要：传递用户资料
          avatarUrl: callback.avatarUrl,  // 重要：传递用户资料
        }),
      });

      if (res.ok) {
        clearWxMpLoginParams();
        window.location.reload(); // 或跳转到目标页面
        return;
      }
    }

    // 情况2：收到 code（兜底流程）
    if (callback.code) {
      const result = await exchangeCodeForToken(
        callback.code,
        callback.nickName,
        callback.avatarUrl
      );

      if (result.success) {
        clearWxMpLoginParams();
        window.location.reload();
        return;
      }
    }

    clearWxMpLoginParams();
  } catch (error) {
    console.error("MP login callback error:", error);
    clearWxMpLoginParams();
  }
}, []);

useEffect(() => {
  handleMpLoginCallback();
}, [handleMpLoginCallback]);

// 3. 微信登录按钮点击
const handleWechatLogin = () => {
  if (isInMiniProgram) {
    requestWxMpLogin();
  } else {
    // PC/手机浏览器：跳转扫码登录
    window.location.href = "/api/auth/wechat/qrcode";
  }
};
```

---

## 5. 环境变量

**文件**: `.env.local`

```bash
# 微信小程序配置（二选一命名格式）
WX_MINI_APPID=wx1234567890abcdef
WX_MINI_SECRET=your_app_secret_here

# 或
WECHAT_APP_ID=wx1234567890abcdef
WECHAT_APP_SECRET=your_app_secret_here
```

---

## 6. 验证清单

完成适配后，按以下步骤验证：

- [ ] 环境变量已配置
- [ ] `/api/wxlogin/check` 接口正常返回
- [ ] `/api/auth/mp-callback` 接口正常设置 cookie
- [ ] 微信开发者工具中测试老用户一键登录
- [ ] 微信开发者工具中测试新用户填写资料登录
- [ ] 验证 cookie 正确设置（DevTools → Application → Cookies）
- [ ] 验证用户资料正确保存到数据库

---

## 7. 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 登录后仍显示未登录 | mp-callback 未正确设置 cookie | 检查 API 响应和 cookie 参数 |
| 用户资料未保存 | mp-callback 未传递 nickName/avatarUrl | 检查前端调用是否传递这两个参数 |
| code 无效错误 | code 已被消耗或过期 | 使用 check API 返回的 token 而非 code |
| 扫码登录被触发 | 小程序环境检测失败 | 确保加载了微信 JS-SDK |

---

## 8. 小程序端配置

小程序模板的 `appConfig.js` 中需要配置：

```javascript
module.exports = {
  general: {
    initialUrl: 'https://your-website.com',  // 内嵌网页 URL
    appName: '应用名称',
    appId: 'wx1234567890abcdef',              // 与环境变量一致
    version: '1.0.0',
  },
  // ...
};
```

**注意**：小程序 AppID 必须与服务端环境变量 `WX_MINI_APPID` 一致，否则会返回 `invalid code` 错误。

---

## 9. PC 与小程序账号互通（UnionID）

### 9.1 问题背景

微信为每个应用分配独立的 `openid`，同一用户在不同应用中的 `openid` 不同：

| 登录方式 | 应用类型 | openid | 结果 |
|----------|----------|--------|------|
| PC 扫码 | 网站应用 | `oABC123...` | 用户 A |
| 小程序 | 小程序 | `oXYZ789...` | 用户 B（新建） |

**问题**：同一微信用户会被创建两个独立账号，数据无法互通。

### 9.2 解决方案：UnionID

当多个应用绑定到同一个**微信开放平台**账号后，微信会返回统一的 `unionid`：

| 登录方式 | openid | unionid | 结果 |
|----------|--------|---------|------|
| PC 扫码 | `oABC123...` | `oUNION999...` | 用户 A |
| 小程序 | `oXYZ789...` | `oUNION999...` | 用户 A（同一个） |

### 9.3 前提条件

1. **微信开放平台账号**：https://open.weixin.qq.com
2. **主体认证**：需完成认证（300 元/年）
3. **绑定应用**：将以下应用绑定到同一开放平台账号
   - 网站应用（PC 扫码登录）
   - 小程序

### 9.4 代码实现

修改用户查找逻辑，**优先使用 unionid 查找**：

```typescript
async function signInWithWechat(params: {
  openid: string;
  unionid?: string | null;
  nickname?: string | null;
  avatar?: string | null;
}) {
  const { openid, unionid, nickname, avatar } = params;
  const usersColl = db.collection("users");

  let user;

  // 1. 如果有 unionid，优先按 unionid 查找（跨应用统一：PC/小程序/公众号）
  if (unionid) {
    const existing = await usersColl.where({ wechatUnionId: unionid }).limit(1).get();
    user = existing.data[0];
  }

  // 2. 如果没找到，按 wechatOpenId 查找
  if (!user) {
    const existing = await usersColl.where({ wechatOpenId: openid }).limit(1).get();
    user = existing.data[0];
  }

  // 3. 兼容早期用 email 存 openid 的情况
  if (!user) {
    const emailKey = `wechat_${openid}@local.wechat`;
    const existing = await usersColl.where({ email: emailKey }).limit(1).get();
    user = existing.data[0];
  }

  const now = new Date().toISOString();

  if (!user) {
    // 创建新用户
    const userData = {
      email: `wechat_${openid}@local.wechat`,
      name: nickname || "微信用户",
      avatar: avatar || null,
      wechatOpenId: openid,
      wechatUnionId: unionid || null,
      createdAt: now,
      lastLoginAt: now,
    };
    const result = await usersColl.add(userData);
    user = { ...userData, _id: result.id };
  } else {
    // 更新已有用户：同步 openid 和 unionid
    const updateData = {
      name: nickname || user.name,
      avatar: avatar || user.avatar,
      lastLoginAt: now,
      wechatOpenId: openid,        // 更新为当前应用的 openid
      wechatUnionId: unionid || null,
    };
    await usersColl.doc(user._id).update(updateData);
    user = { ...user, ...updateData };
  }

  return user;
}
```

### 9.5 数据库字段

确保用户表包含以下字段：

```typescript
interface User {
  _id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  wechatOpenId?: string;      // 当前应用的 openid
  wechatUnionId?: string;     // 跨应用统一的 unionid
  createdAt: string;
  lastLoginAt: string;
}
```

### 9.6 工作原理图

```
用户首次从 PC 登录
┌────────────────────────────────────────────────────────────┐
│ 1. PC 扫码 → 获取 openid_pc + unionid                       │
│ 2. 按 unionid 查找 → 未找到                                 │
│ 3. 按 openid 查找 → 未找到                                  │
│ 4. 创建新用户，保存 openid_pc 和 unionid                     │
└────────────────────────────────────────────────────────────┘
                              ↓
同一用户从小程序登录
┌────────────────────────────────────────────────────────────┐
│ 1. 小程序登录 → 获取 openid_mini + unionid（相同）           │
│ 2. 按 unionid 查找 → ✅ 找到已有用户                        │
│ 3. 更新 wechatOpenId 为 openid_mini                        │
│ 4. 返回同一个用户账号，数据互通                              │
└────────────────────────────────────────────────────────────┘
```

### 9.7 注意事项

1. **必须绑定开放平台**：未绑定时微信不返回 unionid
2. **数据库索引**：建议为 `wechatUnionId` 字段建立索引
3. **openid 会被覆盖**：当前实现会用最新登录的 openid 覆盖旧值。如需同时保存多个 openid，需扩展数据结构
4. **历史用户迁移**：已存在的用户首次从另一端登录时，会通过 unionid 合并到已有账号

---

## 10. 第三方网页链接拦截

### 10.1 问题背景

在微信小程序的 WebView 中，用户点击第三方外部链接时会遇到以下问题：
- WebView 只能打开业务域名，无法跳转到未配置的第三方网站
- 用户体验中断，无法访问目标链接

### 10.2 解决方案

在 H5 端拦截外部链接，跳转到小程序原生页面展示链接，引导用户复制后在浏览器访问。

```
用户点击外部链接 → H5 拦截 → 跳转小程序页面 → 自动复制链接 → 用户去浏览器粘贴访问
```

### 10.3 H5 端适配

#### 10.3.1 创建链接拦截组件

**文件**: `components/mp-link-interceptor.tsx`

```tsx
"use client";

import { useEffect, useCallback } from "react";
import { isMiniProgram, getWxMiniProgram } from "@/lib/wechat-mp";

/**
 * 微信小程序外部链接拦截器
 * 在微信小程序环境下拦截外部链接，跳转到小程序链接复制页面
 */
export function MpLinkInterceptor() {
  // 判断是否为外部链接
  const isExternalUrl = useCallback((url: string): boolean => {
    if (!url) return false;
    if (url.startsWith("javascript:")) return false;
    if (url.startsWith("#")) return false;
    if (url.startsWith("mailto:")) return false;
    if (url.startsWith("tel:")) return false;

    try {
      const link = new URL(url, window.location.href);
      return link.host !== window.location.host;
    } catch {
      return false;
    }
  }, []);

  // 跳转到小程序链接复制页面
  const navigateToLinkCopyPage = useCallback((url: string) => {
    const mp = getWxMiniProgram();
    if (!mp || typeof mp.navigateTo !== "function") return;

    // 跳转到小程序的链接复制页面，通过 URL 参数传递链接
    const linkCopyPageUrl = "/pages/qrcode/qrcode?url=" + encodeURIComponent(url);
    console.log("[mp-link-interceptor] 跳转到链接复制页面:", linkCopyPageUrl);
    mp.navigateTo({ url: linkCopyPageUrl });
  }, []);

  useEffect(() => {
    // 仅在微信小程序环境下启用拦截
    if (!isMiniProgram()) {
      console.log("[mp-link-interceptor] 非小程序环境，跳过");
      return;
    }

    console.log("[mp-link-interceptor] 外部链接拦截器已启用");

    // 拦截所有链接点击
    const handleClick = (e: MouseEvent) => {
      let target = e.target as HTMLElement | null;

      // 向上查找 <a> 标签
      while (target && target.tagName !== "A") {
        target = target.parentElement;
      }

      if (!target) return;

      const anchor = target as HTMLAnchorElement;
      const href = anchor.href;

      if (!href) return;

      // 检查是否为外部链接
      if (isExternalUrl(href)) {
        e.preventDefault();
        e.stopPropagation();
        console.log("[mp-link-interceptor] 拦截外部链接:", href);
        navigateToLinkCopyPage(href);
      }
    };

    // 使用捕获阶段监听
    document.addEventListener("click", handleClick, true);

    // 拦截 window.open
    const originalOpen = window.open;
    window.open = function (url?: string | URL, ...args) {
      const urlStr = url?.toString() || "";
      if (isExternalUrl(urlStr)) {
        console.log("[mp-link-interceptor] 拦截 window.open:", urlStr);
        navigateToLinkCopyPage(urlStr);
        return null;
      }
      return originalOpen.call(this, url, ...args);
    };

    return () => {
      document.removeEventListener("click", handleClick, true);
      window.open = originalOpen;
    };
  }, [isExternalUrl, navigateToLinkPage]);

  // 不需要渲染任何内容
  return null;
}
```

#### 10.3.2 在布局中引入组件

**文件**: `app/layout.tsx` 或根布局文件

```tsx
import { MpLinkInterceptor } from "@/components/mp-link-interceptor";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <MpLinkInterceptor />
        {children}
      </body>
    </html>
  );
}
```

#### 10.3.3 确保工具库包含必要函数

**文件**: `lib/wechat-mp.ts`（确保包含以下函数）

```typescript
/** 获取微信小程序 SDK 对象 */
export function getWxMiniProgram(): WxMiniProgram | null {
  if (typeof window === "undefined") return null;
  const wxObj = window.wx;
  if (!wxObj || typeof wxObj !== "object") return null;
  const mp = wxObj.miniProgram;
  if (!mp || typeof mp !== "object") return null;
  return mp;
}
```

### 10.4 小程序端配置

确保 `app.json` 中已注册该页面：

```json
{
  "pages": [
    "pages/webshell/webshell",
    "pages/webshell/login",
    "pages/webshell/profile",
    "pages/qrcode/qrcode"
  ]
}
```

#### 10.4.1 页面结构

**文件**: `pages/qrcode/qrcode.wxml`

```xml
<view class="container">
  <view class="card">
    <view class="icon-wrapper">
      <image class="icon" src="/images/link-icon.png" mode="aspectFit" />
    </view>

    <view class="title">外部链接</view>
    <view class="subtitle">该链接无法在小程序内打开</view>

    <view class="url-box">
      <text class="url" selectable="true">{{url}}</text>
    </view>

    <view class="tip" wx:if="{{copied}}">
      <text class="tip-text success">链接已复制到剪贴板</text>
    </view>
    <view class="tip" wx:else>
      <text class="tip-text">请复制链接后在浏览器中打开</text>
    </view>

    <button class="copy-btn" bindtap="copyUrl">
      {{copied ? '已复制' : '复制链接'}}
    </button>

    <button class="back-btn" bindtap="goBack">返回</button>
  </view>
</view>
```

#### 10.4.2 页面逻辑

**文件**: `pages/qrcode/qrcode.js`

```javascript
Page({
  data: {
    url: '',
    copied: false
  },

  onLoad(options) {
    if (options.url) {
      const url = decodeURIComponent(options.url);
      this.setData({ url });
      // 自动复制到剪贴板
      this.autoCopy(url);
    }
  },

  autoCopy(url) {
    wx.setClipboardData({
      data: url,
      success: () => {
        this.setData({ copied: true });
        wx.showToast({ title: '链接已复制', icon: 'success' });
      },
      fail: () => {
        console.log('[qrcode] 自动复制失败');
      }
    });
  },

  copyUrl() {
    if (!this.data.url) return;

    wx.setClipboardData({
      data: this.data.url,
      success: () => {
        this.setData({ copied: true });
        wx.showToast({ title: '复制成功', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '复制失败', icon: 'none' });
      }
    });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  }
});
```

#### 10.4.3 页面样式

**文件**: `pages/qrcode/qrcode.wxss`

```css
.container {
  min-height: 100vh;
  background: #f5f5f5;
  padding: 40rpx;
  box-sizing: border-box;
}

.card {
  background: #fff;
  border-radius: 24rpx;
  padding: 60rpx 40rpx;
  text-align: center;
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.05);
}

.icon-wrapper {
  margin-bottom: 32rpx;
}

.icon {
  width: 120rpx;
  height: 120rpx;
}

.title {
  font-size: 36rpx;
  font-weight: 600;
  color: #333;
  margin-bottom: 12rpx;
}

.subtitle {
  font-size: 28rpx;
  color: #999;
  margin-bottom: 40rpx;
}

.url-box {
  background: #f8f8f8;
  border-radius: 12rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
  word-break: break-all;
}

.url {
  font-size: 26rpx;
  color: #666;
  line-height: 1.6;
}

.tip {
  margin-bottom: 32rpx;
}

.tip-text {
  font-size: 26rpx;
  color: #999;
}

.tip-text.success {
  color: #07c160;
}

.copy-btn {
  width: 100%;
  height: 88rpx;
  line-height: 88rpx;
  background: #07c160;
  color: #fff;
  font-size: 32rpx;
  border-radius: 44rpx;
  margin-bottom: 24rpx;
}

.back-btn {
  width: 100%;
  height: 88rpx;
  line-height: 88rpx;
  background: #f5f5f5;
  color: #666;
  font-size: 32rpx;
  border-radius: 44rpx;
}
```

### 10.5 页面效果

外部链接页面提供以下功能：
- 自动复制链接到剪贴板
- 展示目标网址（可选中）
- 手动复制按钮
- 清晰的操作提示

### 10.6 注意事项

1. **环境检测**：拦截器仅在微信小程序环境下生效，桌面端和 APK 端不受影响
2. **内部链接**：同域名链接不会被拦截，正常跳转
3. **特殊协议**：`javascript:`、`mailto:`、`tel:` 等协议不会被拦截
