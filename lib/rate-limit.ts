import { type NextRequest, NextResponse } from "next/server"

// 简单的内存限流器
interface RateLimitEntry {
  count: number
  resetTime: number
}

const rateLimitMap = new Map<string, RateLimitEntry>()

// 清理过期的限流记录
function cleanupRateLimit() {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(key)
    }
  }
}

// 每5分钟清理一次
setInterval(cleanupRateLimit, 5 * 60 * 1000)

interface RateLimitOptions {
  maxRequests?: number      // 最大请求次数
  windowMs?: number         // 时间窗口（毫秒）
  keyGenerator?: (req: NextRequest) => string  // 生成限流key的函数
}

export function rateLimit(options: RateLimitOptions = {}) {
  const {
    maxRequests = 60,        // 默认每分钟60次
    windowMs = 60 * 1000,    // 默认1分钟
    keyGenerator = (req: NextRequest) => {
      // 使用 IP + 路径作为key
      const ip = req.headers.get("x-forwarded-for") || 
                 req.headers.get("x-real-ip") || 
                 "unknown"
      const path = req.nextUrl.pathname
      return `${ip}:${path}`
    }
  } = options

  return async function rateLimitMiddleware(
    req: NextRequest
  ): Promise<NextResponse | null> {
    const key = keyGenerator(req)
    const now = Date.now()
    
    const existing = rateLimitMap.get(key)
    
    if (!existing || now > existing.resetTime) {
      // 新的时间窗口
      rateLimitMap.set(key, {
        count: 1,
        resetTime: now + windowMs
      })
      return null
    }
    
    if (existing.count >= maxRequests) {
      // 超过限流阈值
      return NextResponse.json(
        { 
          success: false, 
          error: "Too many requests",
          retryAfter: Math.ceil((existing.resetTime - now) / 1000)
        },
        { 
          status: 429,
          headers: {
            "X-RateLimit-Limit": String(maxRequests),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil(existing.resetTime / 1000))
          }
        }
      )
    }
    
    // 增加计数
    existing.count++
    return null
  }
}

// 针对 rooms API 的特殊限流（更严格的限制）
export function roomsRateLimit() {
  return rateLimit({
    maxRequests: 30,          // 每分钟30次
    windowMs: 60 * 1000,
    keyGenerator: (req: NextRequest) => {
      const ip = req.headers.get("x-forwarded-for") || 
                 req.headers.get("x-real-ip") || 
                 "unknown"
      return `rooms:${ip}`
    }
  })
}

// 针对通用 API 的宽松限流
export function apiRateLimit() {
  return rateLimit({
    maxRequests: 100,         // 每分钟100次
    windowMs: 60 * 1000
  })
}
