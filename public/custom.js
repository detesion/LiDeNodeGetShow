// 你可以自定义这里

(() => {
  const mount = () => {
    if (document.getElementById('nodeget-video-background')) return

    const bg = document.createElement('div')
    bg.id = 'nodeget-video-background'
    bg.setAttribute('aria-hidden', 'true')

    const video = document.createElement('video')
    video.autoplay = true
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.preload = 'auto'

    const sources = ['./public/bg.mp4', './bg.mp4']
    let sourceIndex = 0
    video.src = sources[sourceIndex]
    video.addEventListener('error', () => {
      sourceIndex += 1
      if (sourceIndex < sources.length) video.src = sources[sourceIndex]
    })

    bg.appendChild(video)
    document.body.prepend(bg)
    video.play().catch(() => {})
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }
})()
