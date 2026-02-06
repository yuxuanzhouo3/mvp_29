"use client"

import { useEffect } from "react"
import { ensureMiniProgramEnv, isMiniProgram } from "@/lib/wechat-mp"

type WechatMiniProgramDetectorProps = {
  onDetect?: (value: boolean) => void
}

export function WechatMiniProgramDetector({ onDetect }: WechatMiniProgramDetectorProps) {
  useEffect(() => {
    let mounted = true
    const run = async () => {
      const base = isMiniProgram()
      if (base) onDetect?.(true)
      const ensured = await ensureMiniProgramEnv()
      if (mounted) onDetect?.(ensured)
    }
    void run()
    return () => {
      mounted = false
    }
  }, [onDetect])

  return null
}
