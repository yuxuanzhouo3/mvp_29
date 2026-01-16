'use server'

import { createClient } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// 初始化 Supabase 客户端 (优先使用 Service Role Key)
const getSupabase = () => createClient(supabaseUrl, supabaseKey)

// 删除用户
export async function deleteUser(userId: string) {
  try {
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
    const supabase = getSupabase()
    
    const { error } = await supabase
      .from('rooms')
      .insert({
        name: name,
        created_at: new Date().toISOString()
      })

    if (error) throw error

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
    const supabase = getSupabase()
    
    const { error } = await supabase
      .from('rooms')
      .delete()
      .eq('id', roomId)

    if (error) throw error

    revalidatePath('/admin/rooms')
    return { success: true }
  } catch (error: unknown) {
    console.error('Delete room error:', error)
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}
