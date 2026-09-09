/**
 * AI 检查工具 — 轨道式背景圆角矩形流动动画
 *
 * v3: Canvas + OffscreenCanvas + Web Worker（优先）
 *    Worker 不可用时自动回退主线程 Canvas 渲染
 *
 * 几何模型（坐标系：左下角原点，X右 Y上）：
 *   屏幕高度 H 均分 8 等份 → 水平条带 → 绕屏幕中心逆时针旋转 θ
 *   得到 8 条平行斜向轨道，方向 = 主对角线（左下→右上）
 */

;(function () {
  'use strict'

  // ================================================================
  // 参数
  // ================================================================
  var N_TRACKS = 8
  var RECTS_PER_TRACK = 4
  var SLOW_CYCLE_S = 27
  var FAST_CYCLE_S = 7
  var LERP_FACTOR = 0.035

  // ================================================================
  // 双色调配色方案
  // ================================================================
  var COOL_COLORS = [
    'rgba(46, 125, 50, 0.08)',
    'rgba(160, 185, 205, 0.10)',
    'rgba(195, 205, 215, 0.09)',
    'rgba(140, 170, 190, 0.08)',
    'rgba(46, 125, 50, 0.06)',
  ]
  var WARM_COLORS = [
    'rgba(198, 40, 40, 0.10)',
    'rgba(230, 110, 45, 0.11)',
    'rgba(249, 168, 37, 0.10)',
    'rgba(235, 140, 55, 0.09)',
    'rgba(210, 70, 35, 0.08)',
  ]

  // ================================================================
  // 状态
  // ================================================================
  var container = null, canvas = null, ctx = null
  var worker = null, useOffscreen = false
  var isWarm = false, targetSpeed = 0, currentSpeed = 0
  var vpW = 0, vpH = 0
  var resizeTimer = null, resizeHandler = null
  var animId = null, lastFrameTime = 0

  // ── 几何 ──
  var angleAB = 0, dirDx = 0, dirDy = 0, perpDx = 0, perpDy = 0
  var trackW = 0, trackLen = 0, minD = 0, maxD = 0
  var _cosD = 0, _sinD = 0, _marginX = 0, _marginY = 0
  var _trackOrigin = [], trackSlowSpd = [], trackFastSpd = []
  var rects = []

  // ================================================================
  // 工具
  // ================================================================
  function rand(a, b) { return a + Math.random() * (b - a) }
  function lerp(a, b, t) { return a + (b - a) * t }

  // Canvas roundRect polyfill for older browsers (Chrome < 99)
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2)
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + r, r)
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
    ctx.arcTo(x, y + h, x, y + h - r, r)
    ctx.arcTo(x, y, x + r, y, r)
    ctx.closePath()
  }

  // ================================================================
  // 几何计算
  // ================================================================
  function calcGeometry() {
    angleAB = Math.atan2(vpH, vpW)
    dirDx = Math.cos(angleAB); dirDy = -Math.sin(angleAB)
    perpDx = Math.sin(angleAB); perpDy = Math.cos(angleAB)
    minD = -vpH * perpDy; maxD = vpW * perpDx
    trackW = (maxD - minD) / N_TRACKS
    trackLen = Math.sqrt(vpW * vpW + vpH * vpH) * 1.6

    trackSlowSpd = []; trackFastSpd = []
    for (var i = 0; i < N_TRACKS; i++) {
      trackSlowSpd.push(trackLen / (SLOW_CYCLE_S * rand(0.65, 1.35)))
      trackFastSpd.push(trackLen / (FAST_CYCLE_S * rand(0.55, 1.45)))
    }

    _marginX = vpW * 0.45; _marginY = vpH * 0.45
    _cosD = Math.cos(angleAB); _sinD = -Math.sin(angleAB)

    _trackOrigin = []
    for (var i = 0; i < N_TRACKS; i++) {
      var halfW = trackW / 2
      var D = (minD + halfW) + i * trackW
      var baseMX = vpW * 0.35
      _trackOrigin.push({ x0: -baseMX, y0: vpH + (D + baseMX * perpDx) / perpDy })
    }
  }

  function toScreen(trackIdx, t) {
    var orig = _trackOrigin[trackIdx]
    return { x: orig.x0 + t * dirDx, y: orig.y0 + t * dirDy }
  }

  // ================================================================
  // 矩形初始化
  // ================================================================
  function initRects() {
    rects = []
    var wrapGuard = trackLen * 0.02
    for (var tk = 0; tk < N_TRACKS; tk++) {
      var effectiveLen = trackLen - wrapGuard
      var slotW = effectiveLen / RECTS_PER_TRACK
      for (var r = 0; r < RECTS_PER_TRACK; r++) {
        var rectLen = rand(slotW * 0.30, slotW * 0.55)
        var maxOffset = slotW - rectLen
        var offset = rand(0, maxOffset)
        var t = r * slotW + offset
        var rectW = rand(trackW * 0.3, trackW * 0.88)
        rects.push({
          trackIdx: tk, t: t, len: rectLen, width: rectW,
          halfLen: rectLen / 2, halfH: rectW / 2,
          color: getRandomColor(false)
        })
      }
    }
  }

  function getRandomColor(warm) {
    var pal = warm ? WARM_COLORS : COOL_COLORS
    return pal[Math.floor(Math.random() * pal.length)]
  }

  var _colorPending = false  // 是否有待执行的渐变色切换
  var _colorWarm = false      // 目标色调方向
  var _colorIdx = 0           // 当前刷新进度

  function startColorTransition(warm) {
    _colorPending = true
    _colorWarm = warm
    _colorIdx = 0
  }

  // ================================================================
  // 主线程 Canvas 渲染（回退模式）
  // ================================================================
  function drawMainThread(trackDisp) {
    ctx.clearRect(0, 0, vpW, vpH)
    for (var i = 0; i < rects.length; i++) {
      var d = rects[i]
      d.t += trackDisp[d.trackIdx]
      if (d.t >= trackLen) d.t -= trackLen

      var pos = toScreen(d.trackIdx, d.t)
      if (pos.x > vpW + _marginX || pos.x + d.len < -_marginX ||
          pos.y < -_marginY || pos.y - d.width > vpH + _marginY) continue

      var cx = pos.x + d.halfLen * dirDx
      var cy = pos.y + d.halfLen * dirDy

      ctx.save()
      ctx.fillStyle = d.color
      ctx.translate(cx, cy)
      ctx.rotate(-angleAB)
      ctx.beginPath()
      roundRect(ctx, -d.halfLen, -d.halfH, d.len, d.width, 50)
      ctx.fill()
      ctx.restore()
    }
  }

  function frameMainThread(now) {
    animId = requestAnimationFrame(frameMainThread)
    if (document.hidden) return
    if (!lastFrameTime) lastFrameTime = now
    var dt = Math.min(now - lastFrameTime, 100) / 1000
    lastFrameTime = now

    currentSpeed = lerp(currentSpeed, targetSpeed, LERP_FACTOR)

    var trackDisp = []
    for (var tk = 0; tk < N_TRACKS; tk++) {
      trackDisp.push(lerp(trackSlowSpd[tk], trackFastSpd[tk], currentSpeed) * dt)
    }
    drawMainThread(trackDisp)

    // 渐变色切换：每帧刷新 4 个矩形，8 帧内平滑过渡
    if (_colorPending) {
      for (var c = 0; c < 4 && _colorIdx < rects.length; c++, _colorIdx++) {
        rects[_colorIdx].color = getRandomColor(_colorWarm)
      }
      if (_colorIdx >= rects.length) _colorPending = false
    }
  }

  function startMainThread() {
    if (animId) { cancelAnimationFrame(animId); animId = null }
    lastFrameTime = 0
    animId = requestAnimationFrame(frameMainThread)
  }

  // ================================================================
  // DOM 管理
  // ================================================================
  function ensureContainer() {
    var el = document.getElementById('bg-layer')
    if (!el) {
      el = document.createElement('div')
      el.id = 'bg-layer'
      el.className = 'bg-layer'
      document.body.insertBefore(el, document.body.firstChild)
    }
    return el
  }

  function createCanvas() {
    var el = document.createElement('canvas')
    el.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;'
    el.width = vpW; el.height = vpH
    container.appendChild(el)
    return el
  }

  function removeCanvas() {
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
    canvas = null; ctx = null
  }

  // ================================================================
  // Worker 管理
  // ================================================================
  function supportsOffscreen() {
    try { return typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined' }
    catch (e) { return false }
  }

  function getWorkerUrl() {
    var scripts = document.getElementsByTagName('script')
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || ''
      if (src.indexOf('background-animation.js') !== -1) {
        return src.replace('background-animation.js', 'bg-worker.js')
      }
    }
    return 'bg-worker.js'
  }

  function initWorker() {
    try {
      var workerUrl = getWorkerUrl()
      worker = new Worker(workerUrl)
      var offscreen = canvas.transferControlToOffscreen()
      worker.postMessage({
        type: 'init',
        canvas: offscreen,
        vpW: vpW, vpH: vpH,
        coolColors: COOL_COLORS,
        warmColors: WARM_COLORS,
      }, [offscreen])
      return true
    } catch (e) {
      console.warn('[BgAnim] Worker 初始化失败，回退主线程模式:', e.message)
      destroyWorker()
      return false
    }
  }

  function postWorker(msg) {
    if (worker) { try { worker.postMessage(msg) } catch (e) {} }
  }

  function destroyWorker() {
    if (worker) {
      try { worker.postMessage({ type: 'destroy' }) } catch (e) {}
      try { worker.terminate() } catch (e) {}
      worker = null
    }
  }

  // ================================================================
  // Resize
  // ================================================================
  function debounceResize() {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(function () {
      resizeTimer = null
      resize()
    }, 200)
  }

  function resize() {
    vpW = window.innerWidth; vpH = window.innerHeight
    if (canvas) {
      canvas.width = vpW; canvas.height = vpH
      canvas.style.width = vpW + 'px'; canvas.style.height = vpH + 'px'
    }
    if (useOffscreen) {
      postWorker({ type: 'resize', vpW: vpW, vpH: vpH })
    } else {
      calcGeometry()
      initRects()
      lastFrameTime = 0
    }
  }

  // ================================================================
  // 公开 API
  // ================================================================
  window.BgAnimation = {

    init: function () {
      container = ensureContainer()
      vpW = window.innerWidth; vpH = window.innerHeight
      removeCanvas()
      canvas = createCanvas()

      useOffscreen = supportsOffscreen()
      if (useOffscreen) {
        useOffscreen = initWorker()
      }
      if (!useOffscreen) {
        ctx = canvas.getContext('2d')  // 仅在降级模式获取上下文（Worker 模式由 Worker 管理）
        console.warn('[BgAnim] 使用主线程 Canvas 模式')
        calcGeometry()
        initRects()
        startMainThread()
      }

      if (!resizeHandler) {
        resizeHandler = debounceResize
        window.addEventListener('resize', resizeHandler)
      }
    },

    /** @param {number} target - 0.0 慢速/冷调 / 1.0 快速/暖调 */
    setSpeed: function (target) {
      target = Math.max(0, Math.min(1, Number(target) || 0))
      var shouldWarm = target > 0.3
      if (shouldWarm !== isWarm) {
        isWarm = shouldWarm
        if (isWarm) document.body.classList.add('is-checking')
        else document.body.classList.remove('is-checking')
        if (useOffscreen) {
          postWorker({ type: 'speed', target: target })
        } else {
          startColorTransition(isWarm)
        }
      }
      targetSpeed = target
    },

    resize: function () {
      if (container) resize()
    },

    destroy: function () {
      if (animId) { cancelAnimationFrame(animId); animId = null }
      destroyWorker()
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler)
        resizeHandler = null
      }
      if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null }
      removeCanvas()
      container = null
      rects = []
    }
  }
})()
