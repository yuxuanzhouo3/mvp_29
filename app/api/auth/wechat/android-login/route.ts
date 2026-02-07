import { NextResponse } from "next/server"
import { getMariaPool, getPrisma, isMariaDbConnectionError } from "@/lib/prisma"
import jwt from "jsonwebtoken"

export const runtime = "nodejs"

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key"
// User provided credentials for Android App
const ANDROID_APP_ID = "wxd2f4ea51e526a132"
const ANDROID_APP_SECRET = "52b548b2e9482f5b8d9176073bacfc4c"

const isTencentTarget = () => {
  const publicTarget = String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
  const privateTarget = String(process.env.DEPLOY_TARGET ?? "").trim().toLowerCase()
  return publicTarget === "tencent" || privateTarget === "tencent"
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { code } = body

    if (!code) {
      return NextResponse.json({ error: "Code is required" }, { status: 400 })
    }

    // 1. Exchange code for access_token and openid
    const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${ANDROID_APP_ID}&secret=${ANDROID_APP_SECRET}&code=${code}&grant_type=authorization_code`

    const tokenRes = await fetch(tokenUrl)
    const tokenData = await tokenRes.json()

    if (tokenData.errcode) {
      console.error("WeChat API Error:", tokenData)
      return NextResponse.json({ error: tokenData.errmsg || "WeChat login failed" }, { status: 400 })
    }

    const { openid, access_token } = tokenData

    // 2. Get user info
    const userInfoUrl = `https://api.weixin.qq.com/sns/userinfo?access_token=${access_token}&openid=${openid}`
    const userInfoRes = await fetch(userInfoUrl)
    const userInfo = await userInfoRes.json()

    if (userInfo.errcode) {
      console.error("WeChat UserInfo Error:", userInfo)
      return NextResponse.json({ error: userInfo.errmsg || "Failed to get user info" }, { status: 400 })
    }

    const nickname = userInfo.nickname || `WeChat User ${openid.slice(-4)}`
    const avatar = userInfo.headimgurl || ""
    const unionid = userInfo.unionid // Available if developer account linked

    // 3. Find or create user in database
    let user: { id: string; email?: string | null; name?: string | null } | null = null

    if (isTencentTarget()) {
      const pool = await getMariaPool()

      // Try to find user by openid
      const queryResult = await pool.query("SELECT * FROM `User` WHERE _openid = ? LIMIT 1", [openid])
      const rows = Array.isArray(queryResult) ? queryResult[0] : []
      const existingUsers = Array.isArray(rows) ? rows : []

      if (existingUsers.length > 0) {
        user = existingUsers[0]
        // Update user info
        await pool.query("UPDATE `User` SET name = ?, updatedAt = NOW() WHERE id = ?", [nickname, user!.id])
      } else {
        // Create new user
        const id = crypto.randomUUID()
        const fakeEmail = `wechat_${openid}@mornspeaker.local`

        // Ensure email doesn't exist (edge case)
        const emailQueryResult = await pool.query("SELECT id FROM `User` WHERE email = ? LIMIT 1", [fakeEmail])
        const emailRows = Array.isArray(emailQueryResult) ? emailQueryResult[0] : []
        const existingEmails = Array.isArray(emailRows) ? emailRows : []

        if (existingEmails.length > 0) {
          // Should not happen if openid is unique, but just in case
          user = existingEmails[0]
        } else {
          await pool.query(
            "INSERT INTO `User` (id, email, name, password, _openid, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, NOW(), NOW())",
            [id, fakeEmail, nickname, "wechat_login_no_password", openid]
          )
          user = { id, email: fakeEmail, name: nickname }
        }
      }
    } else {
      const prisma = await getPrisma()

      user = await prisma.user.findFirst({
        where: { openid: openid }
      })

      if (user) {
        await prisma.user.update({
          where: { id: user.id },
          data: { name: nickname } // Schema doesn't have image field for User, but Profile does? User schema has 'image' column in SQL but Prisma schema shows only specific fields?
          // Let's check schema.prisma again. User model has: id, email, name, password, uiLocale, createdAt, updatedAt, openid. No image.
          // Wait, in mp-callback route, it updates name.
          // Let's stick to name.
        })
      } else {
        const fakeEmail = `wechat_${openid}@mornspeaker.local`
        // Check if fakeEmail exists
        const existingEmailUser = await prisma.user.findUnique({ where: { email: fakeEmail } })
        if (existingEmailUser) {
          user = existingEmailUser
          await prisma.user.update({
            where: { id: user.id },
            data: { openid: openid, name: nickname }
          })
        } else {
          user = await prisma.user.create({
            data: {
              email: fakeEmail,
              name: nickname,
              password: "wechat_login_no_password",
              openid: openid
            }
          })
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: "Failed to create/find user" }, { status: 500 })
    }

    // 4. Generate JWT
    // Use the same structure as other auth methods
    const payload = {
      userId: user.id,
      email: user.email,
      name: user.name,
      openid: openid
    }

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" })

    const res = NextResponse.json({ success: true, user })
    res.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    })

    return res

  } catch (error) {
    if (isTencentTarget() && process.env.NODE_ENV !== "production" && isMariaDbConnectionError(error)) {
      return NextResponse.json({ success: false, error: "Database unavailable" })
    }
    console.error("[android-login] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
