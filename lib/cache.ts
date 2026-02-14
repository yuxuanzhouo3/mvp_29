// 简单的内存缓存实现
interface CacheEntry<T> {
  value: T
  expiresAt: number
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<unknown>>()
  private readonly defaultTTL: number

  constructor(defaultTTLMs: number = 60000) {
    this.defaultTTL = defaultTTLMs
    // 定期清理过期缓存
    setInterval(() => this.cleanup(), 60000)
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }
    
    return entry.value as T
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTTL)
    this.cache.set(key, { value, expiresAt })
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return false
    }
    
    return true
  }

  clear(): void {
    this.cache.clear()
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
      }
    }
  }
}

// 全局缓存实例
export const globalCache = new MemoryCache(30000) // 默认30秒TTL

// 房间数据缓存（更短的TTL）
export const roomCache = new MemoryCache(5000) // 5秒TTL

// 设置缓存（较长的TTL）
export const settingsCache = new MemoryCache(60000) // 60秒TTL
