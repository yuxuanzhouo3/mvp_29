import { type NextRequest, NextResponse } from "next/server"
import { getMariaPool, getPrisma, isMariaDbConnectionError } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import crypto from "node:crypto"
import jwt from "jsonwebtoken"

export const runtime = "nodejs"

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key"

const isTencentTarget = () => {
  const publicTarget = String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  const privateTarget = String(process.env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  return publicTarget === "tencent" || privateTarget === "tencent"
}

const buildWechatEmail = (openid: string) => `wechat_${openid}@local.wechat`

const resolveDisplayName = (value?: string | null) => {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

const generateRandomPassword = () => crypto.randomBytes(16).toString("hex")

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { code?: string; nickName?: string | null; avatarUrl?: string | null }
    const code = body?.code?.trim()
    if (!code) {
      return NextResponse.json(
        { success: false, error: "INVALID_PARAMS", message: "code is required" },
        { status: 400 }
      )
    }

    const appId = process.env.WX_MINI_APPID || process.env.WECHAT_APP_ID
    const appSecret = process.env.WX_MINI_SECRET || process.env.WECHAT_APP_SECRET
    if (!appId || !appSecret) {
      return NextResponse.json(
        { success: false, error: "CONFIG_ERROR", message: "服务端配置错误" },
        { status: 500 }
      )
    }

    const wxUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
    const wxResponse = await fetch(wxUrl)
    const wxData = await wxResponse.json()

    if (wxData?.errcode || !wxData?.openid) {
      return NextResponse.json(
        { success: false, error: "INVALID_CODE", message: wxData?.errmsg || "code 无效" },
        { status: 401 }
      )
    }

    const openid = String(wxData.openid)
    const nickName = resolveDisplayName(body?.nickName)
    const email = buildWechatEmail(openid)
    let userId: string
    let userName: string | null = null

    if (isTencentTarget()) {
      const pool = await getMariaPool()
      const rows = await pool.query(
        "SELECT id, email, name, _openid AS openid FROM `User` WHERE email = ? OR _openid = ? LIMIT 1",
        [email, openid]
      )
      const existing = Array.isArray(rows) && rows.length > 0 ? rows[0] : null
      if (!existing) {
        userId = crypto.randomUUID()
        const rawPassword = generateRandomPassword()
        const hashedPassword = await bcrypt.hash(rawPassword, 10)
        const displayName = nickName || email.split("@")[0]
        await pool.query(
          "INSERT INTO `User` (id, email, name, password, createdAt, updatedAt, _openid) VALUES (?, ?, ?, ?, NOW(), NOW(), ?)",
          [userId, email, displayName, hashedPassword, openid]
        )
        userName = displayName
      } else {
        userId = String(existing.id)
        userName = existing.name ? String(existing.name) : null
        const nextName = userName || nickName
        const shouldUpdateName = nextName && nextName !== userName
        const shouldUpdateOpenId = !existing.openid || String(existing.openid).trim() !== openid
        if (shouldUpdateName || shouldUpdateOpenId) {
          const updateName = shouldUpdateName ? nextName : userName
          await pool.query(
            "UPDATE `User` SET name = ?, _openid = ?, updatedAt = NOW() WHERE id = ? LIMIT 1",
            [updateName, openid, userId]
          )
          userName = updateName ?? null
        }
      }
    } else {
      const prisma = await getPrisma()
      const existing = await prisma.user.findFirst({
        where: {
          OR: [{ email }, { openid }],
        },
      })
      if (!existing) {
        const rawPassword = generateRandomPassword()
        const hashedPassword = await bcrypt.hash(rawPassword, 10)
        const displayName = nickName || email.split("@")[0]
        const created = await prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            name: displayName,
            openid,
          },
        })
        userId = created.id
        userName = created.name ?? null
      } else {
        userId = existing.id
        userName = existing.name ?? null
        const nextName = userName || nickName
        const shouldUpdateName = nextName && nextName !== userName
        const shouldUpdateOpenId = !existing.openid || existing.openid !== openid
        if (shouldUpdateName || shouldUpdateOpenId) {
          const updated = await prisma.user.update({
            where: { id: existing.id },
            data: {
              name: shouldUpdateName ? nextName : existing.name,
              openid,
            },
          })
          userName = updated.name ?? null
        }
      }
    }

    const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "7d" })
    const hasProfile = Boolean(userName)
    const expiresIn = 7 * 24 * 60 * 60

    const response = NextResponse.json({
      success: true,
      exists: true,
      hasProfile,
      openid,
      token,
      expiresIn,
      userName,
      userAvatar: null,
    })
    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: expiresIn,
      path: "/",
    })
    return response
  } catch (error) {
    if (isTencentTarget() && process.env.NODE_ENV !== "production" && isMariaDbConnectionError(error)) {
      return NextResponse.json({ success: false, error: "Database unavailable" })
    }
    console.error("[wxlogin/check] Error:", error)
    return NextResponse.json(
      { success: false, error: "SERVER_ERROR", message: "服务器错误" },
      { status: 500 }
    )
  }
}
