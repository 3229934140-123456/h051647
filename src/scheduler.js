// ==================== 调度器模块 (scheduler.js) ====================
// 负责: 组件更新的批量调度,避免同步多次 setState 导致多次渲染
// 使用微任务(Promise)优先,退化到宏任务(setTimeout)

let isFlushPending = false
let isFlushing = false

const pendingPreFlushCbs = []
const pendingUpdateQueue = []
const pendingPostFlushCbs = []

let activePreFlushCbs = null
let activePostFlushCbs = null
let activeUpdateQueue = null

let preFlushIndex = 0
let postFlushIndex = 0
let updateIndex = 0

let currentFlushPromise = null

const resolvedPromise = Promise.resolve()

export function nextTick(fn) {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(this ? fn.bind(this) : fn) : p
}

export function queueJob(job) {
  if (!pendingUpdateQueue.includes(job) &&
      !(activeUpdateQueue && activeUpdateQueue.includes(job))) {
    pendingUpdateQueue.push(job)
    queueFlush()
  }
}

export function invalidateJob(job) {
  const i = pendingUpdateQueue.indexOf(job)
  if (i > -1) {
    pendingUpdateQueue.splice(i, 1)
  }
  if (activeUpdateQueue) {
    const i2 = activeUpdateQueue.indexOf(job)
    if (i2 > updateIndex) {
      activeUpdateQueue.splice(i2, 1)
    }
  }
}

export function queuePreFlushCb(cb) {
  if (!pendingPreFlushCbs.includes(cb) &&
      !(activePreFlushCbs && activePreFlushCbs.includes(cb))) {
    pendingPreFlushCbs.push(cb)
    queueFlush()
  }
}

export function queuePostFlushCb(cb) {
  if (!pendingPostFlushCbs.includes(cb) &&
      !(activePostFlushCbs && activePostFlushCbs.includes(cb))) {
    pendingPostFlushCbs.push(cb)
    queueFlush()
  }
}

function queueFlush() {
  if (!isFlushPending && !isFlushing) {
    isFlushPending = true
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

function flushJobs() {
  isFlushPending = false
  isFlushing = true

  flushPreFlushCbs()

  activeUpdateQueue = [...pendingUpdateQueue]
  pendingUpdateQueue.length = 0
  activeUpdateQueue.sort((a, b) => {
    const aId = a.id ?? 0
    const bId = b.id ?? 0
    return aId - bId
  })

  for (updateIndex = 0; updateIndex < activeUpdateQueue.length; updateIndex++) {
    const job = activeUpdateQueue[updateIndex]
    if (job.allowRecurse || !job._running) {
      job._running = true
      callWithErrorHandling(job)
      job._running = false
    }
  }
  updateIndex = 0
  activeUpdateQueue = null

  flushPostFlushCbs()

  isFlushing = false
  currentFlushPromise = null

  if (
    pendingPreFlushCbs.length ||
    pendingUpdateQueue.length ||
    pendingPostFlushCbs.length
  ) {
    flushJobs()
  }
}

function flushPreFlushCbs() {
  if (pendingPreFlushCbs.length) {
    activePreFlushCbs = [...new Set(pendingPreFlushCbs)]
    pendingPreFlushCbs.length = 0
    for (preFlushIndex = 0; preFlushIndex < activePreFlushCbs.length; preFlushIndex++) {
      activePreFlushCbs[preFlushIndex]()
    }
    activePreFlushCbs = null
    preFlushIndex = 0
  }
}

function flushPostFlushCbs() {
  if (pendingPostFlushCbs.length) {
    const deduped = [...new Set(pendingPostFlushCbs)]
    pendingPostFlushCbs.length = 0

    if (activePostFlushCbs) {
      activePostFlushCbs.push(...deduped)
      return
    }

    activePostFlushCbs = deduped
    activePostFlushCbs.sort((a, b) => {
      const aId = a.id ?? 0
      const bId = b.id ?? 0
      return aId - bId
    })

    for (postFlushIndex = 0; postFlushIndex < activePostFlushCbs.length; postFlushIndex++) {
      activePostFlushCbs[postFlushIndex]()
    }
    activePostFlushCbs = null
    postFlushIndex = 0
  }
}

export function flushSync(fn) {
  if (fn) {
    const job = () => {
      fn()
    }
    job.id = -1
    queueJob(job)
  }
  if (isFlushPending) {
    flushJobs()
  }
  if (pendingUpdateQueue.length) {
    flushJobs()
  }
}

function callWithErrorHandling(fn) {
  try {
    fn()
  } catch (e) {
    console.error('[Scheduler] Error in job:', e)
    throw e
  }
}

export function getSchedulerState() {
  return {
    isFlushPending,
    isFlushing,
    pendingUpdates: pendingUpdateQueue.length,
    pendingPre: pendingPreFlushCbs.length,
    pendingPost: pendingPostFlushCbs.length
  }
}
