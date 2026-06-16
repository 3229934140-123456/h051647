// ==================== 虚拟 DOM 模块 (vdom.js) ====================
// 负责: 虚拟节点(VNode)的表示、createElement 工厂函数、以及节点类型判断

export const VNodeType = {
  TEXT: 'TEXT',
  ELEMENT: 'ELEMENT',
  COMPONENT: 'COMPONENT',
  FRAGMENT: 'FRAGMENT'
}

export function createVNode(type, props, children) {
  const vnode = {
    type,
    props: props || {},
    children: normalizeChildren(children),
    key: props?.key ?? null,
    ref: props?.ref ?? null,
    _dom: null,
    _component: null,
    _parent: null
  }
  return vnode
}

export function createTextVNode(text) {
  return {
    type: VNodeType.TEXT,
    props: { nodeValue: String(text) },
    children: [],
    key: null,
    ref: null,
    _dom: null,
    _component: null,
    _parent: null
  }
}

export function createElement(type, config, ...children) {
  const props = {}
  let key = null
  let ref = null

  if (config != null) {
    if (config.key !== undefined) {
      key = '' + config.key
    }
    if (config.ref !== undefined) {
      ref = config.ref
    }
    for (const propName in config) {
      if (propName === 'key' || propName === 'ref') continue
      if (Object.prototype.hasOwnProperty.call(config, propName)) {
        props[propName] = config[propName]
      }
    }
  }

  if (key != null) props.key = key
  if (ref != null) props.ref = ref

  const vnode = createVNode(type, props, children)
  return vnode
}

function normalizeChildren(children) {
  const result = []
  const flatten = (arr) => {
    for (let i = 0; i < arr.length; i++) {
      const child = arr[i]
      if (child === null || child === undefined || typeof child === 'boolean') {
        continue
      }
      if (Array.isArray(child)) {
        flatten(child)
      } else if (typeof child === 'string' || typeof child === 'number') {
        result.push(createTextVNode(child))
      } else {
        result.push(child)
      }
    }
  }
  flatten(children)
  return result
}

export function isTextVNode(vnode) {
  return vnode && vnode.type === VNodeType.TEXT
}

export function isElementVNode(vnode) {
  return vnode && typeof vnode.type === 'string' && vnode.type !== VNodeType.TEXT && vnode.type !== VNodeType.FRAGMENT
}

export function isComponentVNode(vnode) {
  return vnode && typeof vnode.type === 'function'
}

export function isFragmentVNode(vnode) {
  return vnode && vnode.type === VNodeType.FRAGMENT
}

export function isSameVNodeType(n1, n2) {
  if (n1 == null || n2 == null) return false
  if (n1.key !== n2.key) return false
  if (isTextVNode(n1) && isTextVNode(n2)) return true
  if (isElementVNode(n1) && isElementVNode(n2)) return n1.type === n2.type
  if (isComponentVNode(n1) && isComponentVNode(n2)) return n1.type === n2.type
  if (isFragmentVNode(n1) && isFragmentVNode(n2)) return true
  return false
}

export function Fragment(props) {
  return createVNode(VNodeType.FRAGMENT, {}, props?.children || [])
}
