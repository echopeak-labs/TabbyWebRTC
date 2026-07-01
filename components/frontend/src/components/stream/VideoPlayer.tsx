import { useEffect, useRef } from 'react'

export interface VideoPlayerProps {
  stream: MediaStream
  sourceId: string
  nativeWidth: number
  nativeHeight: number
}

export function VideoPlayer({ stream, sourceId, nativeWidth, nativeHeight }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (video) {
      video.srcObject = stream
    }
    return () => {
      if (video) {
        video.srcObject = null
      }
    }
  }, [stream])

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={false}
      data-source-id={sourceId}
      data-native-width={nativeWidth}
      data-native-height={nativeHeight}
      className="h-full w-full object-contain"
    />
  )
}
