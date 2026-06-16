// ==================== 框架入口 (index.js) ====================
// 整合所有模块, 提供对外统一的 API:
//   createElement / h
//   Component / PureComponent
//   render / unmountAt
//   createRef / Fragment
//   nextTick / flushSync

import {
  createElement,
  createVNode,
  createTextVNode,
  Fragment,
  VNodeType,
  isTextVNode,
  isElementVNode,
  isComponentVNode,
  isFragmentVNode
} from './vdom.js'

import {
  patch,
  unmount,
  getSequence,
  PatchFlags
} from './diff.js'

import {
  Component,
  PureComponent,
  createRef,
  nextTick,
  flushSync
} from './component.js'

import {
  createDOMElement,
  updateProps,
  getFirstDOM,
  getLastDOM,
  insertBefore,
  removeElement
} from './dom.js'

import { getSchedulerState, queueJob } from './scheduler.js'

const ROOT_VNODE_KEY = '__minreact_root_vnode__'

export function render(vnode, container, callback) {
  if (container == null) {
    throw new Error('[render] Container cannot be null or undefined')
  }

  if (vnode == null || typeof vnode === 'boolean') {
    unmountAt(container)
    if (callback) callback()
    return
  }

  if (typeof vnode === 'string' || typeof vnode === 'number') {
    vnode = createTextVNode(vnode)
  }

  if (typeof vnode !== 'object') {
    throw new Error('[render] Invalid vnode: ' + typeof vnode)
  }

  const prevRootVNode = container[ROOT_VNODE_KEY] || null

  if (prevRootVNode) {
    patch(prevRootVNode, vnode, container, null)
  } else {
    container.innerHTML = ''
    patch(null, vnode, container, null)
  }

  container[ROOT_VNODE_KEY] = vnode

  if (callback) {
    queueJob(() => callback())
  }

  return vnode
}

export function unmountAt(container) {
  const rootVNode = container[ROOT_VNODE_KEY]
  if (rootVNode) {
    unmount(rootVNode, null, null, true)
    delete container[ROOT_VNODE_KEY]
  }
  container.innerHTML = ''
}

export function hydrate(vnode, container, callback) {
  return render(vnode, container, callback)
}

export {
  createElement,
  createElement as h,
  createVNode,
  createTextVNode,
  Fragment,
  Component,
  PureComponent,
  createRef,
  nextTick,
  flushSync,
  VNodeType,
  PatchFlags,
  getSequence,
  isTextVNode,
  isElementVNode,
  isComponentVNode,
  isFragmentVNode,
  createDOMElement,
  updateProps,
  getSchedulerState
}

export default {
  createElement,
  h: createElement,
  createVNode,
  createTextVNode,
  Fragment,
  Component,
  PureComponent,
  createRef,
  render,
  unmountAt,
  hydrate,
  nextTick,
  flushSync,
  VNodeType,
  PatchFlags,
  getSchedulerState
}
