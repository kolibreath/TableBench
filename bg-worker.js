/**
 * 背景动画 Canvas Worker — 独立线程渲染，不受主线程 SSE/JS 阻塞影响
 *
 * 通信协议：
 *   主线程 → Worker: { type: 'init', canvas: OffscreenCanvas, vpW, vpH, colors }
 *                   { type: 'speed', target: 0-1 }
 *                   { type: 'resize', vpW, vpH }
 *   Worker → 主线程: 无（Canvas 自动合成）
 */

'use strict'

// ── 可调参数 ──
var N_TRACKS = 8
var RECTS_PER_TRACK = 4
var SLOW_CYCLE_S = 27
var FAST_CYCLE_S = 7
var LERP_FACTOR = 0.035

// ── 内部状态 ──
var canvas = null
var ctx = null
var vpW = 0, vpH = 0
var targetSpeed = 0, currentSpeed = 0
var isWarm = false
var coolColors = []
var warmColors = []
var currentPalette = []
var animId = null
var lastFrameTime = 0
var rects = []  // [{ trackIdx, t, len, width, halfLen, halfH, color }]

// 渐变色切换
var colorPending = false, colorWarm = false, colorIdx = 0

// ── 几何参数 ──
var angleAB = 0, dirDx = 0, dirDy = 0, perpDx = 0, perpDy = 0
var trackW = 0, trackLen = 0, minD = 0, maxD = 0
var _cosD = 0, _sinD = 0, _marginX = 0, _marginY = 0
var _trackOrigin = []
var trackSlowSpd = [], trackFastSpd = []

// ── 工具 ──
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

// ── 几何 ──
function calcGeometry() {
  angleAB = Math.atan2(vpH, vpW)
  dirDx = Math.cos(angleAB)
  dirDy = -Math.sin(angleAB)
  perpDx = Math.sin(angleAB)
  perpDy = Math.cos(angleAB)
  minD = -vpH * perpDy
  maxD = vpW * perpDx
  trackW = (maxD - minD) / N_TRACKS
  var diag = Math.sqrt(vpW * vpW + vpH * vpH)
  trackLen = diag * 1.6

  trackSlowSpd = [], trackFastSpd = []
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

// ── 矩形初始化 ──
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
        color: currentPalette[Math.floor(Math.random() * currentPalette.length)]
      })
    }
  }
}

// ── 绘制 ──
function draw(trackDisp) {
  ctx.clearRect(0, 0, vpW, vpH)
  for (var i = 0; i < rects.length; i++) {
    var d = rects[i]
    d.t += trackDisp[d.trackIdx]
    if (d.t >= trackLen) d.t -= trackLen

    var pos = toScreen(d.trackIdx, d.t)
    var offScreen = pos.x > vpW + _marginX || pos.x + d.len < -_marginX ||
      pos.y < -_marginY || pos.y - d.width > vpH + _marginY
    if (offScreen) continue

    var cx = pos.x + d.halfLen * dirDx
    var cy = pos.y + d.halfLen * dirDy

    ctx.save()
    ctx.fillStyle = d.color
    ctx.translate(cx, cy)
    ctx.rotate(-angleAB)  // CSS rotate 方向
    ctx.beginPath()
    roundRect(ctx, -d.halfLen, -d.halfH, d.len, d.width, 50)
    ctx.fill()
    ctx.restore()
  }
}

// ── 动画循环 ──
function frame(now) {
  animId = requestAnimationFrame(frame)
  if (!lastFrameTime) lastFrameTime = now
  var dt = Math.min(now - lastFrameTime, 100) / 1000
  lastFrameTime = now

  currentSpeed = lerp(currentSpeed, targetSpeed, LERP_FACTOR)

  var trackDisp = []
  for (var tk = 0; tk < N_TRACKS; tk++) {
    var pxPerS = lerp(trackSlowSpd[tk], trackFastSpd[tk], currentSpeed)
    trackDisp.push(pxPerS * dt)
  }
  draw(trackDisp)

  // 渐变色切换：每帧刷 4 个矩形
  if (colorPending) {
    for (var c = 0; c < 4 && colorIdx < rects.length; c++, colorIdx++) {
      var pal = colorWarm ? warmColors : coolColors
      rects[colorIdx].color = pal[Math.floor(Math.random() * pal.length)]
    }
    if (colorIdx >= rects.length) colorPending = false
  }
}

// ── 消息处理 ──
self.onmessage = function (e) {
  var msg = e.data
  switch (msg.type) {
    case 'init':
      canvas = msg.canvas
      ctx = canvas.getContext('2d')
      vpW = msg.vpW; vpH = msg.vpH
      coolColors = msg.coolColors || []
      warmColors = msg.warmColors || []
      currentPalette = coolColors
      calcGeometry()
      initRects()
      lastFrameTime = 0
      if (animId) { cancelAnimationFrame(animId); animId = null }
      animId = requestAnimationFrame(frame)
      break

    case 'speed':
      targetSpeed = Math.max(0, Math.min(1, Number(msg.target) || 0))
      var shouldWarm = targetSpeed > 0.3
      if (shouldWarm !== isWarm) {
        isWarm = shouldWarm
        currentPalette = isWarm ? warmColors : coolColors
        colorPending = true
        colorWarm = isWarm
        colorIdx = 0
      }
      break

    case 'resize':
      vpW = msg.vpW; vpH = msg.vpH
      canvas.width = vpW; canvas.height = vpH
      calcGeometry()
      initRects()
      lastFrameTime = 0
      break

    case 'destroy':
      if (animId) { cancelAnimationFrame(animId); animId = null }
      ctx = null; canvas = null; rects = []
      break
  }
}
