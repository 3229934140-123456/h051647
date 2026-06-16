// ==================== Diff / Reconcile 模块 (diff.js) ====================
// 负责: 新旧虚拟树的差异比较、计算最小更新、列表 key 优化
// 与组件系统的交互通过 mountComponent/updateComponent/unmountComponent 回调注入

import {
  isTextVNode,
  isElementVNode,
  isComponentVNode,
  isFragmentVNode,
  isSameVNodeType,
  VNodeType
} from './vdom.js'

import {
  createDOMElement,
  updateProps,
  updateTextContent,
  insertBefore,
  removeElement,
  getFirstDOM,
  getLastDOM,
  detachRef,
  collectDOMSiblings
} from './dom.js'

export const PatchFlags = {
  TEXT: 1,
  CLASS: 2,
  STYLE: 4,
  PROPS: 8,
  FULL_PROPS: 16,
  NEED_PATCH: 32,
  KEYED_FRAGMENT: 64,
  UNKEYED_FRAGMENT: 128,
  NEED_HYDRATION: 256,
  DYNAMIC_SLOTS: 512,
  HOISTED: -1,
  BAIL: -2
}

let componentHandlers = {
  mount: null,
  update: null,
  unmount: null
}

export function setComponentHandlers(handlers) {
  componentHandlers = { ...componentHandlers, ...handlers }
}

export function patch(oldVNode, newVNode, container, anchor = null) {
  if (oldVNode === newVNode) return

  if (oldVNode && !isSameVNodeType(oldVNode, newVNode)) {
    anchor = getNextSibling(oldVNode)
    unmount(oldVNode, null, null, true)
    oldVNode = null
  }

  const { type } = newVNode

  if (isTextVNode(newVNode)) {
    processText(oldVNode, newVNode, container, anchor)
  } else if (isElementVNode(newVNode)) {
    processElement(oldVNode, newVNode, container, anchor)
  } else if (isComponentVNode(newVNode)) {
    processComponent(oldVNode, newVNode, container, anchor)
  } else if (isFragmentVNode(newVNode)) {
    processFragment(oldVNode, newVNode, container, anchor)
  } else {
    throw new Error(`Unknown VNode type: ${type}`)
  }
}

function processText(oldVNode, newVNode, container, anchor) {
  if (oldVNode == null) {
    const dom = createDOMElement(newVNode)
    insertBefore(container, dom, anchor)
  } else {
    const dom = oldVNode._dom
    newVNode._dom = dom
    if (newVNode.props.nodeValue !== oldVNode.props.nodeValue) {
      updateTextContent(dom, newVNode.props.nodeValue)
    }
  }
}

function processElement(oldVNode, newVNode, container, anchor) {
  if (oldVNode == null) {
    mountElement(newVNode, container, anchor)
  } else {
    patchElement(oldVNode, newVNode)
  }
}

function mountElement(vnode, container, anchor) {
  const el = createDOMElement(vnode)
  insertBefore(container, el, anchor)
}

function patchElement(oldVNode, newVNode) {
  const el = (newVNode._dom = oldVNode._dom)

  const oldProps = oldVNode.props || {}
  const newProps = newVNode.props || {}

  if (newProps.dynamicProps) {
    if (newProps.patchFlag & PatchFlags.FULL_PROPS) {
      updateProps(el, oldProps, newProps)
    } else {
      if (newProps.patchFlag & PatchFlags.CLASS) {
        if (oldProps.class !== newProps.class) {
          el.className = newProps.class || ''
        }
      }
      if (newProps.patchFlag & PatchFlags.STYLE) {
        updateStyleProp(el, oldProps.style || {}, newProps.style || {})
      }
      if (newProps.patchFlag & PatchFlags.PROPS) {
        for (let i = 0; i < newProps.dynamicProps.length; i++) {
          const key = newProps.dynamicProps[i]
          if (oldProps[key] !== newProps[key]) {
            updateProp(el, key, oldProps[key], newProps[key])
          }
        }
      }
      if (newProps.patchFlag & PatchFlags.TEXT) {
        if (oldProps.children !== newProps.children) {
          el.textContent = newProps.children
        }
      }
    }
  } else {
    updateProps(el, oldProps, newProps)
  }

  const oldRef = oldVNode.ref
  const newRef = newVNode.ref
  if (oldRef !== newRef) {
    if (oldRef) {
      setRefValue(oldRef, null)
    }
    if (newRef) {
      setRefValue(newRef, el)
    }
  }

  patchChildren(oldVNode, newVNode, el, null)
}

function updateStyleProp(el, oldStyle, newStyle) {
  const style = el.style
  for (const key in oldStyle) {
    if (!(key in newStyle)) {
      style[key.startsWith('--') ? 'removeProperty' : toCamelCase(key)] = key.startsWith('--') ? [key] : ''
      if (key.startsWith('--')) style.removeProperty(key)
      else style[toCamelCase(key)] = ''
    }
  }
  for (const key in newStyle) {
    const oldVal = oldStyle[key]
    const newVal = newStyle[key]
    if (oldVal !== newVal) {
      if (key.startsWith('--')) {
        style.setProperty(key, newVal)
      } else {
        style[toCamelCase(key)] = typeof newVal === 'number' && !isUnitless(key)
          ? newVal + 'px'
          : newVal != null ? newVal : ''
      }
    }
  }
}

function updateProp(el, key, oldVal, newVal) {
  if (key === 'style') {
    updateStyleProp(el, oldVal || {}, newVal || {})
  } else if (key === 'className') {
    el.setAttribute('class', newVal || '')
  } else if (key.startsWith('on') && typeof newVal === 'function') {
    const eventName = key.slice(2).toLowerCase()
    if (oldVal) el.removeEventListener(eventName, oldVal)
    el.addEventListener(eventName, newVal)
  } else if (key === 'value') {
    el.value = newVal != null ? newVal : ''
  } else if (key === 'checked') {
    el.checked = !!newVal
  } else if (newVal === true) {
    el.setAttribute(key, '')
  } else if (newVal === false || newVal == null) {
    el.removeAttribute(key)
  } else {
    el.setAttribute(key, String(newVal))
  }
}

function setRefValue(ref, value) {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref && typeof ref === 'object') {
    ref.current = value
  }
}

const unitlessProperties = new Set([
  'animationIterationCount', 'aspectRatio', 'borderImageOutset',
  'boxFlex', 'columnCount', 'flex', 'flexGrow', 'flexShrink',
  'fontWeight', 'lineHeight', 'opacity', 'order', 'zIndex', 'zoom'
])
function isUnitless(key) { return unitlessProperties.has(key) }
function toCamelCase(str) { return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) }

function processComponent(oldVNode, newVNode, container, anchor) {
  if (oldVNode == null) {
    if (componentHandlers.mount) {
      componentHandlers.mount(newVNode, container, anchor)
    }
  } else {
    if (componentHandlers.update) {
      componentHandlers.update(oldVNode, newVNode)
    }
  }
}

function processFragment(oldVNode, newVNode, container, anchor) {
  const fragmentStartAnchor = (newVNode._dom = oldVNode ? oldVNode._dom : null)
  const fragmentEndAnchor = (newVNode._anchor = oldVNode ? oldVNode._anchor : null)

  let fragmentAnchor = anchor
  if (!oldVNode) {
    const startComment = document.createComment('[')
    const endComment = document.createComment(']')
    newVNode._dom = startComment
    newVNode._anchor = endComment
    insertBefore(container, startComment, anchor)
    insertBefore(container, endComment, anchor)
    fragmentAnchor = endComment
  } else {
    fragmentAnchor = getNextSibling(oldVNode)
  }

  patchChildren(oldVNode, newVNode, container, fragmentAnchor)
}

export function patchChildren(oldVNode, newVNode, container, parentAnchor) {
  const oldChildren = oldVNode ? oldVNode.children : []
  const newChildren = newVNode.children

  const oldLen = oldChildren.length
  const newLen = newChildren.length

  const commonLength = Math.min(oldLen, newLen)

  let patched = false
  let patchFlag = newVNode.props?.patchFlag ?? 0
  let optimized = patchFlag > 0

  if (optimized) {
    if (patchFlag & PatchFlags.KEYED_FRAGMENT) {
      patchKeyedChildren(oldChildren, newChildren, container, parentAnchor, oldVNode, newVNode)
      patched = true
    } else if (patchFlag & PatchFlags.UNKEYED_FRAGMENT) {
      patchUnkeyedChildren(oldChildren, newChildren, container, parentAnchor)
      patched = true
    }
  }

  if (!patched) {
    if (oldLen === 0) {
      mountChildren(newChildren, container, parentAnchor)
    } else if (newLen === 0) {
      unmountChildren(oldChildren)
    } else {
      const hasKey = oldChildren.some(c => c.key != null) ||
                     newChildren.some(c => c.key != null)
      if (hasKey) {
        patchKeyedChildren(oldChildren, newChildren, container, parentAnchor, oldVNode, newVNode)
      } else {
        patchUnkeyedChildren(oldChildren, newChildren, container, parentAnchor)
      }
    }
  }
}

function mountChildren(children, container, anchor) {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    patch(null, child, container, anchor)
  }
}

function unmountChildren(children) {
  for (let i = children.length - 1; i >= 0; i--) {
    unmount(children[i], null, null, false)
  }
}

function patchUnkeyedChildren(oldChildren, newChildren, container, parentAnchor) {
  const commonLength = Math.min(oldChildren.length, newChildren.length)

  for (let i = 0; i < commonLength; i++) {
    const nextChild = newChildren[i]
    const anchor = (i + 1 < newChildren.length) ? getFirstDOM(newChildren[i + 1]) : parentAnchor
    patch(oldChildren[i], nextChild, container, anchor)
  }

  if (oldChildren.length > newChildren.length) {
    for (let i = commonLength; i < oldChildren.length; i++) {
      unmount(oldChildren[i], null, null, false)
    }
  } else if (newChildren.length > oldChildren.length) {
    for (let i = commonLength; i < newChildren.length; i++) {
      const anchor = (i + 1 < newChildren.length) ? getFirstDOM(newChildren[i + 1]) : parentAnchor
      patch(null, newChildren[i], container, anchor)
    }
  }
}

// 双端比较算法 - 核心列表diff优化
function patchKeyedChildren(oldChildren, newChildren, container, parentAnchor, oldParent, newParent) {
  let i = 0
  let e1 = oldChildren.length - 1
  let e2 = newChildren.length - 1

  // 1. 从头部开始同步比较 (prefix)
  while (i <= e1 && i <= e2) {
    const n1 = oldChildren[i]
    const n2 = newChildren[i]
    if (isSameVNodeType(n1, n2)) {
      const anchor = (i + 1 <= e2) ? getFirstDOM(newChildren[i + 1]) : parentAnchor
      patch(n1, n2, container, anchor)
    } else {
      break
    }
    i++
  }

  // 2. 从尾部开始同步比较 (suffix)
  while (i <= e1 && i <= e2) {
    const n1 = oldChildren[e1]
    const n2 = newChildren[e2]
    if (isSameVNodeType(n1, n2)) {
      const anchor = (e2 + 1 <= newChildren.length - 1) ? getFirstDOM(newChildren[e2 + 1]) : parentAnchor
      patch(n1, n2, container, anchor)
    } else {
      break
    }
    e1--
    e2--
  }

  // 3. 旧节点已全部匹配, 剩下的新节点直接挂载
  if (i > e1) {
    if (i <= e2) {
      const nextPos = e2 + 1
      const anchor = nextPos < newChildren.length ? getFirstDOM(newChildren[nextPos]) : parentAnchor
      while (i <= e2) {
        patch(null, newChildren[i], container, anchor)
        i++
      }
    }
  }
  // 4. 新节点已全部匹配, 剩余的旧节点直接卸载
  else if (i > e2) {
    while (i <= e1) {
      unmount(oldChildren[i], null, null, false)
      i++
    }
  }
  // 5. 中间未知子序列 - 需要通过 Map 找对应关系并计算最长递增子序列
  else {
    const s1 = i
    const s2 = i

    // 建立 key -> index 的 Map 用于 O(1) 查找
    const keyToNewIndexMap = new Map()
    for (i = s2; i <= e2; i++) {
      const nextChild = newChildren[i]
      if (nextChild.key != null) {
        if (keyToNewIndexMap.has(nextChild.key)) {
          console.warn('[Diff] Duplicate keys found:', nextChild.key)
        }
        keyToNewIndexMap.set(nextChild.key, i)
      }
    }

    let j
    let patched = 0
    const toBePatched = e2 - s2 + 1
    let moved = false
    let maxNewIndexSoFar = 0

    // newIndex -> oldIndex 的映射表, 0 表示未找到对应节点(需要新建)
    const newIndexToOldIndexMap = new Array(toBePatched).fill(0)

    // 遍历旧子序列, 寻找可复用的节点
    for (i = s1; i <= e1; i++) {
      const prevChild = oldChildren[i]

      if (patched >= toBePatched) {
        unmount(prevChild, null, null, false)
        continue
      }

      let newIndex
      if (prevChild.key != null) {
        newIndex = keyToNewIndexMap.get(prevChild.key)
      } else {
        for (j = s2; j <= e2; j++) {
          if (newIndexToOldIndexMap[j - s2] === 0 &&
              isSameVNodeType(prevChild, newChildren[j])) {
            newIndex = j
            break
          }
        }
      }

      if (newIndex === undefined) {
        unmount(prevChild, null, null, false)
      } else {
        newIndexToOldIndexMap[newIndex - s2] = i + 1
        if (newIndex >= maxNewIndexSoFar) {
          maxNewIndexSoFar = newIndex
        } else {
          moved = true
        }
        const anchor = (newIndex + 1 <= e2) ? getFirstDOM(newChildren[newIndex + 1]) : parentAnchor
        patch(prevChild, newChildren[newIndex], container, anchor)
        patched++
      }
    }

    // 仅当节点需要移动时计算最长递增子序列(LIS)
    const increasingNewIndexSequence = moved
      ? getSequence(newIndexToOldIndexMap)
      : []

    j = increasingNewIndexSequence.length - 1

    // 倒序遍历, 确保移动时有正确的参考锚点
    for (i = toBePatched - 1; i >= 0; i--) {
      const nextIndex = s2 + i
      const nextChild = newChildren[nextIndex]
      const anchor = nextIndex + 1 < newChildren.length
        ? getFirstDOM(newChildren[nextIndex + 1])
        : parentAnchor

      if (newIndexToOldIndexMap[i] === 0) {
        patch(null, nextChild, container, anchor)
      } else if (moved) {
        if (j < 0 || i !== increasingNewIndexSequence[j]) {
          move(nextChild, container, anchor)
        } else {
          j--
        }
      }
    }
  }
}

function move(vnode, container, anchor) {
  if (isComponentVNode(vnode) && vnode._component) {
    vnode._component.subTree && move(vnode._component.subTree, container, anchor)
    return
  }

  if (isFragmentVNode(vnode)) {
    const doms = collectDOMSiblings(vnode, container)
    for (const dom of doms) {
      insertBefore(container, dom, anchor)
    }
    return
  }

  if (vnode._dom) {
    insertBefore(container, vnode._dom, anchor)
  }
}

export function unmount(vnode, parentComponent, parentSuspense, doRemove = false) {
  const { type, ref, _component } = vnode

  if (ref) {
    setRefValue(ref, null)
    detachRef(vnode)
  }

  if (_component) {
    if (componentHandlers.unmount) {
      componentHandlers.unmount(vnode, parentComponent, doRemove)
    }
    return
  }

  if (isFragmentVNode(vnode)) {
    unmountChildren(vnode.children)
    if (vnode._dom && doRemove) {
      const container = vnode._dom.parentNode
      if (container) {
        const start = vnode._dom
        const end = vnode._anchor
        let next
        while (start && start !== end) {
          next = start.nextSibling
          removeElement(container, start)
          start = next
        }
        if (end) removeElement(container, end)
      }
    }
    return
  }

  if (vnode.children) {
    unmountChildren(vnode.children)
  }

  if (doRemove && vnode._dom) {
    const container = vnode._dom.parentNode
    if (container) {
      removeElement(container, vnode._dom)
    }
  }
}

function getNextSibling(vnode) {
  if (isComponentVNode(vnode)) {
    return vnode._component ? getNextSibling(vnode._component.subTree) : null
  }
  if (isFragmentVNode(vnode) && vnode._anchor) {
    return vnode._anchor.nextSibling
  }
  if (vnode._dom) {
    return vnode._dom.nextSibling
  }
  return null
}

// 最长递增子序列算法 (O(n log n))
// 返回递增子序列的索引数组
export function getSequence(arr) {
  const p = arr.slice()
  const result = [0]
  let i, j, u, v, c
  const len = arr.length
  for (i = 0; i < len; i++) {
    const arrI = arr[i]
    if (arrI !== 0) {
      j = result[result.length - 1]
      if (arr[j] < arrI) {
        p[i] = j
        result.push(i)
        continue
      }
      u = 0
      v = result.length - 1
      while (u < v) {
        c = (u + v) >> 1
        if (arr[result[c]] < arrI) {
          u = c + 1
        } else {
          v = c
        }
      }
      if (arrI < arr[result[u]]) {
        if (u > 0) {
          p[i] = result[u - 1]
        }
        result[u] = i
      }
    }
  }
  u = result.length
  v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}
