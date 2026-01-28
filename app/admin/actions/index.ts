'use server'

import { createClient } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"
import { getPrisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import bcrypt from "bcryptjs"
import crypto from "node:crypto"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// 初始化 Supabase 客户端 (优先使用 Service Role Key)
const getSupabase = () => createClient(supabaseUrl, supabaseKey)

const isTencentTarget = () => {
  const target = String(process.env.DEPLOY_TARGET ?? process.env.NEXT_PUBLIC_DEPLOY_TARGET ?? "")
    .trim()
    .toLowerCase()
  return target === "tencent"
}

// 删除用户
export async function deleteUser(userId: string) {
  try {
    if (isTencentTarget()) {
      const prisma = await getPrisma()
      await prisma.profile.deleteMany({ where: { id: userId } })
      await prisma.user.delete({ where: { id: userId } })
      revalidatePath('/admin/users')
      return { success: true }
    }
    const supabase = getSupabase()

    // 1. 从 profiles 表删除 (如果设置了外键级联删除，这一步可能就够了)
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId)

    if (profileError) throw profileError

    // 2. 从 auth.users 删除 (需要 Service Role Key)
    // 注意：只能通过 admin API 删除 auth 用户
    const { error: authError } = await supabase.auth.admin.deleteUser(userId)

    if (authError) throw authError

    revalidatePath('/admin/users')
    return { success: true }
  } catch (error: unknown) {
    console.error('Delete user error:', error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

// 更新用户
export async function updateUser(userId: string, data: { displayName?: string, email?: string }) {
  try {
    if (isTencentTarget()) {
      const prisma = await getPrisma()
      const updateData: { name?: string; email?: string } = {}
      if (typeof data.displayName === "string") updateData.name = data.displayName
      if (typeof data.email === "string") updateData.email = data.email
      if (Object.keys(updateData).length === 0) {
        revalidatePath('/admin/users')
        return { success: true }
      }
      await prisma.user.update({
        where: { id: userId },
        data: updateData,
      })
      revalidatePath('/admin/users')
      return { success: true }
    }
    const supabase = getSupabase()

    // 更新 profiles 表
    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: data.displayName,
        email: data.email,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)

    if (error) throw error

    // 如果需要更新 auth.users 的 email，也需要调用 admin API
    if (data.email) {
      const { error: authError } = await supabase.auth.admin.updateUserById(userId, { email: data.email })
      if (authError) throw authError
    }

    revalidatePath('/admin/users')
    return { success: true }
  } catch (error: unknown) {
    console.error('Update user error:', error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

// 创建用户
export async function createUser(data: { email: string, password?: string, displayName?: string }) {
  try {
    if (isTencentTarget()) {
      const prisma = await getPrisma()
      const existing = await prisma.user.findUnique({ where: { email: data.email } })
      if (existing) {
        return { success: false, error: "User already exists" }
      }
      const rawPassword = data.password && data.password.trim() ? data.password : "12345678"
      const hashedPassword = await bcrypt.hash(rawPassword, 10)
      const displayName = data.displayName && data.displayName.trim() ? data.displayName : data.email.split("@")[0]
      const user = await prisma.user.create({
        data: {
          id: crypto.randomUUID(),
          email: data.email,
          name: displayName,
          password: hashedPassword,
        },
      })
      revalidatePath('/admin/users')
      return { success: true, userId: user.id }
    }
    const supabase = getSupabase()

    // 1. 创建 auth 用户
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: data.email,
      password: data.password || '12345678', // 默认密码
      email_confirm: true,
      user_metadata: {
        display_name: data.displayName
      }
    })

    if (authError) throw authError
    if (!authData.user) throw new Error("用户创建失败")

    // 2. 确保 profiles 表中有记录 (通常通过 trigger 自动创建，但为了保险起见，这里可以检查或更新)
    // 如果你的 Supabase 配置了 trigger on auth.users insert -> public.profiles insert，这一步可能不需要手动 insert，
    // 但可能需要 update display_name

    // 稍微等待一下 trigger 执行（如果依赖 trigger）
    // 或者直接 upsert profile
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: authData.user.id,
        email: data.email,
        display_name: data.displayName || data.email.split('@')[0],
        updated_at: new Date().toISOString()
      })

    if (profileError) {
      console.warn("Profile update failed, but user created:", profileError)
      // 不抛出错误，因为用户已经创建成功
    }

    revalidatePath('/admin/users')
    return { success: true, userId: authData.user.id }
  } catch (error: unknown) {
    console.error('Create user error:', error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

// 创建房间
export async function createRoom(name: string) {
  try {
    if (isTencentTarget()) {
      const prisma = await getPrisma()
      await prisma.room.upsert({
        where: { id: name },
        create: {
          id: name,
          createdAt: new Date(),
          lastActivityAt: new Date(),
        },
        update: {
          lastActivityAt: new Date(),
        },
      })
    } else {
      const supabase = getSupabase()
      const now = new Date().toISOString()
      const preferred = await supabase.from("rooms").insert({
        name: name,
        created_at: now,
        last_activity_at: now,
      })

      if (preferred.error) {
        const fallback = await supabase.from("rooms").insert({
          name: name,
          created_at: now,
        })
        if (fallback.error) throw fallback.error
      }
    }

    revalidatePath('/admin/rooms')
    return { success: true }
  } catch (error: unknown) {
    console.error('Create room error:', error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

// 删除房间
export async function deleteRoom(roomId: string) {
  try {
    if (isTencentTarget()) {
      const prisma = await getPrisma()
      await prisma.room.delete({ where: { id: roomId } })
    } else {
      const supabase = getSupabase()
      const { error } = await supabase
        .from('rooms')
        .delete()
        .eq('id', roomId)

      if (error) throw error
    }

    revalidatePath('/admin/rooms')
    return { success: true }
  } catch (error: unknown) {
    console.error('Delete room error:', error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

export async function createAd(data: { slotKey: string; title: string; imageUrl?: string; linkUrl?: string; isActive: boolean }) {
  try {
    if (isTencentTarget()) {
      const prisma = await getPrisma()
      await prisma.ad.create({
        data: {
          slotKey: data.slotKey,
          title: data.title,
          imageUrl: data.imageUrl || null,
          linkUrl: data.linkUrl || null,
          isActive: data.isActive,
        },
      })
    } else {
      const supabase = getSupabase()

      const now = new Date().toISOString()
      const { error } = await supabase.from("ads").insert({
        slot_key: data.slotKey,
        title: data.title,
        image_url: data.imageUrl || null,
        link_url: data.linkUrl || null,
        is_active: data.isActive,
        created_at: now,
        updated_at: now,
      })

      if (error) throw error
    }
    revalidatePath("/admin/ads")
    return { success: true }
  } catch (error: unknown) {
    console.error("Create ad error:", error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

export async function updateAd(
  adId: string,
  data: { slotKey: string; title: string; imageUrl?: string; linkUrl?: string; isActive: boolean },
) {
  try {
    if (isTencentTarget()) {
      const prisma = await getPrisma()
      await prisma.ad.update({
        where: { id: adId },
        data: {
          slotKey: data.slotKey,
          title: data.title,
          imageUrl: data.imageUrl || null,
          linkUrl: data.linkUrl || null,
          isActive: data.isActive,
        },
      })
    } else {
      const supabase = getSupabase()

      const { error } = await supabase
        .from("ads")
        .update({
          slot_key: data.slotKey,
          title: data.title,
          image_url: data.imageUrl || null,
          link_url: data.linkUrl || null,
          is_active: data.isActive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", adId)

      if (error) throw error
    }
    revalidatePath("/admin/ads")
    return { success: true }
  } catch (error: unknown) {
    console.error("Update ad error:", error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

export async function setAdActive(adId: string, isActive: boolean) {
  try {
    if (isTencentTarget()) {
      const prisma = await getPrisma()
      await prisma.ad.update({
        where: { id: adId },
        data: { isActive },
      })
    } else {
      const supabase = getSupabase()
      const { error } = await supabase
        .from("ads")
        .update({ is_active: isActive, updated_at: new Date().toISOString() })
        .eq("id", adId)

      if (error) throw error
    }
    revalidatePath("/admin/ads")
    return { success: true }
  } catch (error: unknown) {
    console.error("Set ad active error:", error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

export async function deleteAd(adId: string) {
  try {
    if (isTencentTarget()) {
      const prisma = await getPrisma()
      await prisma.ad.delete({ where: { id: adId } })
    } else {
      const supabase = getSupabase()
      const { error } = await supabase.from("ads").delete().eq("id", adId)
      if (error) throw error
    }
    revalidatePath("/admin/ads")
    return { success: true }
  } catch (error: unknown) {
    console.error("Delete ad error:", error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}

const ROOM_AUTO_DELETE_SETTING_KEY = "rooms_auto_delete_after_24h"

export async function getRoomsAutoDeleteEnabled() {
  try {
    if (isTencentTarget()) {
      const prisma = await getPrisma()
      const row = await prisma.appSetting.findUnique({ where: { key: ROOM_AUTO_DELETE_SETTING_KEY } })
      const value = row?.value
      const enabled =
        typeof value === "boolean"
          ? value
          : typeof value === "object" && value !== null && typeof (value as { enabled?: unknown }).enabled === "boolean"
            ? Boolean((value as { enabled: boolean }).enabled)
            : false
      return { success: true, enabled }
    }

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", ROOM_AUTO_DELETE_SETTING_KEY)
      .maybeSingle()

    if (error) return { success: true, enabled: false }
    const value = (data as { value?: unknown } | null)?.value
    const enabled =
      typeof value === "boolean"
        ? value
        : typeof value === "object" && value !== null && typeof (value as { enabled?: unknown }).enabled === "boolean"
          ? Boolean((value as { enabled: boolean }).enabled)
          : false

    return { success: true, enabled }
  } catch (error: unknown) {
    console.error("Get rooms auto delete setting error:", error)
    return { success: true, enabled: false }
  }
}

export async function setRoomsAutoDeleteEnabled(enabled: boolean) {
  try {
    if (isTencentTarget()) {
      const prisma = await getPrisma()
      const value = Boolean(enabled) as Prisma.InputJsonValue
      await prisma.appSetting.upsert({
        where: { key: ROOM_AUTO_DELETE_SETTING_KEY },
        create: { key: ROOM_AUTO_DELETE_SETTING_KEY, value },
        update: { value },
      })
    } else {
      const supabase = getSupabase()
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          {
            key: ROOM_AUTO_DELETE_SETTING_KEY,
            value: Boolean(enabled),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" },
        )

      if (error) throw error
    }

    revalidatePath("/admin/rooms")
    return { success: true }
  } catch (error: unknown) {
    console.error("Set rooms auto delete setting error:", error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}
