"use client"

import { useEffect } from "react"
import { isMiniProgram } from "@/lib/wechat-mp"

type WechatMiniProgramDetectorProps = {
  onDetect?: (value: boolean) => void
}

export function WechatMiniProgramDetector({ onDetect }: WechatMiniProgramDetectorProps) {
  useEffect(() => {
    onDetect?.(isMiniProgram())
  }, [onDetect])

  return null
}
