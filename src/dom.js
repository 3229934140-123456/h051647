// ==================== DOM 操作模块 (dom.js) ====================
// 负责: 真实 DOM 的创建、属性/事件更新、节点的插入与移除、以及根据 VNode 获取对应的真实 DOM

import { isTextVNode, isElementVNode, isFragmentVNode } from './vdom.js'

export function createDOMElement(vnode) {
  if (isTextVNode(vnode)) {
    const dom = document.createTextNode(vnode.props.nodeValue)
    vnode._dom = dom
    return dom
  }

  if (isFragmentVNode(vnode)) {
    const dom = document.createDocumentFragment()
    vnode._dom = dom
    return dom
  }

  if (isElementVNode(vnode)) {
    const { type, props } = vnode
    const dom = document.createElement(type)
    vnode._dom = dom

    updateProps(dom, {}, props)

    if (vnode.ref) {
      setRef(vnode.ref, dom)
    }

    return dom
  }

  throw new Error('Invalid VNode type for createDOMElement: ' + (vnode && vnode.type))
}

export function updateProps(dom, oldProps, newProps) {
  if (oldProps === newProps) return

  for (const key in oldProps) {
    if (!(key in newProps)) {
      removeProp(dom, key, oldProps[key])
    }
  }

  for (const key in newProps) {
    if (key === 'children' || key === 'key' || key === 'ref') continue
    const oldVal = oldProps[key]
    const newVal = newProps[key]
    if (oldVal !== newVal) {
      setProp(dom, key, oldVal, newVal)
    }
  }
}

function setProp(dom, key, oldVal, newVal) {
  if (key === 'style') {
    updateStyle(dom, oldVal || {}, newVal || {})
    return
  }

  if (key === 'className') {
    dom.setAttribute('class', newVal || '')
    return
  }

  if (key.startsWith('on') && typeof newVal === 'function') {
    const eventName = key.slice(2).toLowerCase()
    if (oldVal) {
      dom.removeEventListener(eventName, oldVal)
    }
    dom.addEventListener(eventName, newVal)
    return
  }

  if (key === 'innerHTML' || key === 'dangerouslySetInnerHTML') {
    const html = newVal?.__html ?? newVal
    if (html != null) {
      dom.innerHTML = html
    }
    return
  }

  if (key === 'value') {
    dom.value = newVal != null ? newVal : ''
    return
  }

  if (key === 'checked') {
    dom.checked = !!newVal
    return
  }

  if (newVal === true) {
    dom.setAttribute(key, '')
  } else if (newVal === false || newVal == null) {
    dom.removeAttribute(key)
  } else {
    dom.setAttribute(key, String(newVal))
  }
}

function removeProp(dom, key, oldVal) {
  if (key === 'style') {
    dom.style.cssText = ''
    return
  }

  if (key === 'className') {
    dom.removeAttribute('class')
    return
  }

  if (key.startsWith('on') && typeof oldVal === 'function') {
    const eventName = key.slice(2).toLowerCase()
    dom.removeEventListener(eventName, oldVal)
    return
  }

  if (key === 'innerHTML' || key === 'dangerouslySetInnerHTML') {
    dom.innerHTML = ''
    return
  }

  if (key === 'value' || key === 'checked') {
    dom[key] = ''
    return
  }

  dom.removeAttribute(key)
}

function updateStyle(dom, oldStyle, newStyle) {
  const style = dom.style

  for (const key in oldStyle) {
    if (!(key in newStyle)) {
      if (key.startsWith('--')) {
        style.removeProperty(key)
      } else {
        style[toCamelCase(key)] = ''
      }
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

const unitlessProperties = new Set([
  'animationIterationCount', 'aspectRatio', 'borderImageOutset', 'borderImageSlice',
  'borderImageWidth', 'boxFlex', 'boxFlexGroup', 'boxOrdinalGroup', 'columnCount',
  'columns', 'flex', 'flexGrow', 'flexPositive', 'flexShrink', 'flexNegative',
  'flexOrder', 'gridArea', 'gridRow', 'gridRowEnd', 'gridRowSpan', 'gridRowStart',
  'gridColumn', 'gridColumnEnd', 'gridColumnSpan', 'gridColumnStart', 'fontWeight',
  'lineClamp', 'lineHeight', 'opacity', 'order', 'orphans', 'tabSize', 'widows',
  'zIndex', 'zoom', 'fillOpacity', 'floodOpacity', 'stopOpacity', 'strokeDasharray',
  'strokeDashoffset', 'strokeMiterlimit', 'strokeOpacity', 'strokeWidth'
])

function isUnitless(key) {
  return unitlessProperties.has(key)
}

function toCamelCase(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

export function insertBefore(parentDom, newDom, nextDom) {
  if (nextDom) {
    parentDom.insertBefore(newDom, nextDom)
  } else {
    parentDom.appendChild(newDom)
  }
}

export function removeElement(parentDom, dom) {
  if (parentDom && dom && dom.parentNode === parentDom) {
    parentDom.removeChild(dom)
  }
}

export function getFirstDOM(vnode) {
  if (!vnode) return null
  if (vnode._dom && vnode._dom.nodeType === 11) {
    const children = vnode._dom.childNodes
    return children.length > 0 ? children[0] : null
  }
  return vnode._dom
}

export function getLastDOM(vnode) {
  if (!vnode) return null
  if (vnode._anchor) {
    return vnode._anchor
  }
  if (vnode._dom && vnode._dom.nodeType === 11) {
    const children = vnode._dom.childNodes
    return children.length > 0 ? children[children.length - 1] : null
  }
  return vnode._dom
}

export function collectDOMSiblings(vnode, container) {
  const doms = []
  if (vnode._anchor) {
    const start = vnode._dom
    const end = vnode._anchor
    let current = start
    while (current) {
      doms.push(current)
      if (current === end) break
      current = current.nextSibling
    }
  } else if (vnode._dom && vnode._dom.nodeType === 11) {
    let child = getFirstDOM(vnode)
    const last = getLastDOM(vnode)
    while (child) {
      doms.push(child)
      if (child === last) break
      child = child.nextSibling
    }
  } else if (vnode._dom) {
    doms.push(vnode._dom)
  }
  return doms
}

export function updateTextContent(dom, newText) {
  if (dom.nodeValue !== newText) {
    dom.nodeValue = newText
  }
}

function setRef(ref, dom) {
  if (typeof ref === 'function') {
    ref(dom)
  } else if (ref && typeof ref === 'object') {
    ref.current = dom
  }
}

export function detachRef(vnode) {
  if (vnode.ref) {
    setRef(vnode.ref, null)
  }
}
