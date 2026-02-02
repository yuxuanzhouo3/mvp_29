import { type NextRequest, NextResponse } from "next/server"
import { getMariaPool, getPrisma, isMariaDbConnectionError } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import crypto from "node:crypto"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json()
    const publicTarget = String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
    const privateTarget = String(process.env.DEPLOY_TARGET ?? "").trim().toLowerCase()
    const isTencent = publicTarget === "tencent" || privateTarget === "tencent"

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password are required" },
        { status: 400 }
      )
    }

    if (isTencent) {
      const pool = await getMariaPool()
      const existingRows = await pool.query(
        "SELECT id, email, name, password FROM `User` WHERE email = ? LIMIT 1",
        [email]
      )
      if (Array.isArray(existingRows) && existingRows.length > 0) {
        return NextResponse.json(
          { success: false, error: "User already exists" },
          { status: 400 }
        )
      }

      const hashedPassword = await bcrypt.hash(password, 10)
      const userId = crypto.randomUUID()
      const displayName = name || email.split("@")[0]
      await pool.query(
        "INSERT INTO `User` (id, email, name, password, createdAt, updatedAt, _openid) VALUES (?, ?, ?, ?, NOW(), NOW(), ?)",
        [userId, email, displayName, hashedPassword, ""]
      )
      return NextResponse.json({
        success: true,
        user: {
          id: userId,
          email,
          name: displayName,
        },
      })
    }

    const prisma = await getPrisma()
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: "User already exists" },
        { status: 400 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || email.split("@")[0],
      },
    })

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    })
  } catch (error) {
    const publicTarget = String(process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "").trim().toLowerCase()
    const privateTarget = String(process.env.DEPLOY_TARGET ?? "").trim().toLowerCase()
    const isTencent = publicTarget === "tencent" || privateTarget === "tencent"
    if (isTencent && process.env.NODE_ENV !== "production" && isMariaDbConnectionError(error)) {
      return NextResponse.json({ success: false, error: "Database unavailable" })
    }
    console.error("Registration error:", error)
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    )
  }
}
