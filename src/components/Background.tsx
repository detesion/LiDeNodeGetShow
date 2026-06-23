export function Background() {
  return (
    <div id="nodeget-video-background" className="fixed inset-0 -z-10 overflow-hidden bg-soft" aria-hidden>
      <video
        className="h-full w-full object-cover"
        src={`${import.meta.env.BASE_URL}bg.mp4`}
        autoPlay
        muted
        loop
        playsInline
      />
    </div>
  )
}
