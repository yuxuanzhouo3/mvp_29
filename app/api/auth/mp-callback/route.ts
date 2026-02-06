import { NextResponse } from "next/server"
import { getMariaPool, getPrisma, isMariaDbConnectionError } from "@/lib/prisma"
import jwt from "jsonwebtoken"

export const runtime = "nodejs"

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key"

const isTencentTarget = () => {
  const publicTarget = String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  const privateTarget = String(process.env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  return publicTarget === "tencent" || privateTarget === "tencent"
}

const resolveDisplayName = (value?: string | null) => {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      token?: string
      openid?: string
      expiresIn?: string | number | null
      nickName?: string | null
      avatarUrl?: string | null
    }
    const token = typeof body.token === "string" ? body.token.trim() : ""
    const openid = typeof body.openid === "string" ? body.openid.trim() : ""

    if (!token || !openid) {
      return NextResponse.json({ error: "Token and openid required" }, { status: 400 })
    }

    let decoded: { userId?: string; email?: string } | null = null
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { userId?: string; email?: string }
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }

    const displayName = resolveDisplayName(body.nickName)
    if (displayName && decoded) {
      if (isTencentTarget()) {
        const pool = await getMariaPool()
        if (decoded.email) {
          await pool.query("UPDATE `User` SET name = ?, updatedAt = NOW() WHERE email = ? LIMIT 1", [
            displayName,
            decoded.email,
          ])
        } else if (decoded.userId) {
          await pool.query("UPDATE `User` SET name = ?, updatedAt = NOW() WHERE id = ? LIMIT 1", [
            displayName,
            decoded.userId,
          ])
        }
      } else {
        const prisma = await getPrisma()
        if (decoded.userId) {
          await prisma.user.update({
            where: { id: decoded.userId },
            data: { name: displayName },
          })
        } else if (decoded.email) {
          const user = await prisma.user.findUnique({ where: { email: decoded.email } })
          if (user) {
            await prisma.user.update({
              where: { id: user.id },
              data: { name: displayName },
            })
          }
        }
      }
    }

    const maxAge = body.expiresIn ? parseInt(String(body.expiresIn), 10) : 60 * 60 * 24 * 7
    const res = NextResponse.json({ success: true, openid })
    res.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge,
      path: "/",
    })
    return res
  } catch (error) {
    if (isTencentTarget() && process.env.NODE_ENV !== "production" && isMariaDbConnectionError(error)) {
      return NextResponse.json({ success: false, error: "Database unavailable" })
    }
    console.error("[mp-callback] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
