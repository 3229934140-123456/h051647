// ==================== 组件系统模块 (component.js) ====================
// 负责: Component 基类、状态管理、生命周期、函数式组件、
// 以及与 diff/reconcile 的集成 (mount/update/unmount)

import {
  createVNode,
  isComponentVNode,
  isFragmentVNode
} from './vdom.js'

import {
  patch,
  unmount,
  setComponentHandlers,
  patchChildren
} from './diff.js'

import {
  createDOMElement,
  insertBefore,
  getFirstDOM,
  getLastDOM,
  removeElement
} from './dom.js'

import {
  queueJob,
  queuePostFlushCb,
  nextTick,
  flushSync
} from './scheduler.js'

let componentIdCounter = 0

export class Component {
  constructor(props) {
    this._id = ++componentIdCounter
    this.props = props || {}
    this.state = this.getInitialState ? this.getInitialState() : {}
    this._vnode = null
    this._subTree = null
    this._container = null
    this._parentVNode = null
    this._isMounted = false
    this._updateJob = null
    this._pendingState = null
    this._pendingCallbacks = []
    this._unmounted = false
    this._dirty = false

    if (this.constructor.contextTypes) {
      this.context = {}
    }
  }

  setState(partialState, callback) {
    if (this._unmounted) return

    if (partialState != null) {
      if (this._pendingState === null) {
        this._pendingState = {}
      }
      if (typeof partialState === 'function') {
        const prevState = this._pendingState && Object.keys(this._pendingState).length
          ? Object.assign({}, this.state, this._pendingState)
          : this.state
        const nextState = partialState.call(this, prevState, this.props)
        if (nextState != null) {
          Object.assign(this._pendingState, nextState)
        }
      } else {
        Object.assign(this._pendingState, partialState)
      }
    }

    if (callback) {
      this._pendingCallbacks.push(callback)
    }

    this._enqueueUpdate()
  }

  replaceState(nextState, callback) {
    if (this._unmounted) return
    this._pendingState = typeof nextState === 'object' ? { ...nextState } : null
    if (callback) {
      this._pendingCallbacks.push(callback)
    }
    this._enqueueUpdate()
  }

  forceUpdate(callback) {
    if (this._unmounted) return
    this._forceUpdate = true
    if (callback) {
      this._pendingCallbacks.push(callback)
    }
    this._enqueueUpdate()
  }

  _enqueueUpdate() {
    if (!this._updateJob) {
      this._updateJob = () => this._update()
      this._updateJob.id = this._id
      this._updateJob.allowRecurse = true
      queueJob(this._updateJob)
    }
  }

  _update() {
    if (this._unmounted) return

    const prevProps = this.props
    const prevState = this.state

    let nextState = prevState
    if (this._pendingState !== null) {
      nextState = Object.assign({}, prevState, this._pendingState)
      this._pendingState = null
    }

    const shouldUpdate = this._forceUpdate ||
      this._shouldUpdate(prevProps, nextState, prevState) ||
      !shallowEqual(prevProps, this.props)

    this._forceUpdate = false

    if (this.componentWillUpdate && this._isMounted) {
      this.componentWillUpdate(this.props, nextState)
    }

    if (this.UNSAFE_componentWillUpdate && this._isMounted) {
      this.UNSAFE_componentWillUpdate(this.props, nextState)
    }

    if (shouldUpdate) {
      this.state = nextState
      this._dirty = false
      this._renderAndPatch(prevProps, prevState)
    } else {
      this.state = nextState
    }

    if (this.componentDidUpdate && this._isMounted) {
      queuePostFlushCb(() => {
        if (!this._unmounted) {
          this.componentDidUpdate(prevProps, prevState)
        }
      })
    }

    this._flushCallbacks()
  }

  _shouldUpdate(nextProps, nextState, prevState) {
    if (this.shouldComponentUpdate) {
      return this.shouldComponentUpdate(nextProps, nextState) !== false
    }
    if (this instanceof PureComponent) {
      return !shallowEqual(this.props, nextProps) || !shallowEqual(this.state, nextState)
    }
    return true
  }

  _renderAndPatch(prevProps, prevState) {
    const prevSubTree = this._subTree
    const nextSubTree = this._render()

    const container = this._container
    const anchor = this._getAnchor()

    this._subTree = nextSubTree
    patch(prevSubTree, nextSubTree, container, anchor)
  }

  _render() {
    try {
      let rendered = this.render()
      if (rendered == null || typeof rendered === 'boolean') {
        rendered = createVNode('div', { style: { display: 'none' } }, [])
      }
      if (typeof rendered === 'string' || typeof rendered === 'number') {
        return createTextVNodeInternal(rendered)
      }
      return rendered
    } catch (e) {
      console.error('[Component] Render error in', this.constructor.name || 'Component', e)
      if (this.componentDidCatch) {
        this.componentDidCatch(e, { componentStack: '' })
      }
      return createVNode('div', { style: { color: 'red', padding: '8px' } },
        [`Error: ${e.message}`])
    }
  }

  _getAnchor() {
    if (this._parentVNode) {
      const siblings = this._parentVNode.children || []
      const idx = siblings.indexOf(this._vnode)
      if (idx > -1 && idx + 1 < siblings.length) {
        return getFirstDOM(siblings[idx + 1])
      }
    }
    return null
  }

  _flushCallbacks() {
    if (this._pendingCallbacks.length) {
      const callbacks = this._pendingCallbacks.slice()
      this._pendingCallbacks.length = 0
      queuePostFlushCb(() => {
        for (const cb of callbacks) {
          if (!this._unmounted) {
            try { cb.call(this) } catch (e) { console.error(e) }
          }
        }
      })
    }
  }

  isMounted() {
    return this._isMounted && !this._unmounted
  }
}

export class PureComponent extends Component {
  _shouldUpdate(nextProps, nextState) {
    return !shallowEqual(this.props, nextProps) || !shallowEqual(this.state, nextState)
  }
}

function shallowEqual(objA, objB) {
  if (objA === objB) return true
  if (typeof objA !== 'object' || objA === null ||
      typeof objB !== 'object' || objB === null) {
    return false
  }
  const keysA = Object.keys(objA)
  const keysB = Object.keys(objB)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key) ||
        objA[key] !== objB[key]) {
      return false
    }
  }
  return true
}

function createTextVNodeInternal(text) {
  return {
    type: 'TEXT',
    props: { nodeValue: String(text) },
    children: [],
    key: null,
    ref: null,
    _dom: null,
    _component: null,
    _parent: null
  }
}

export function createRef(initialValue = null) {
  return { current: initialValue }
}

// ==================== 组件挂载/更新/卸载 (与 diff 集成) ====================

function mountComponent(vnode, container, anchor) {
  const ComponentClass = vnode.type
  const props = resolveProps(vnode)

  let instance
  if (typeof ComponentClass === 'function' &&
      !(ComponentClass.prototype && ComponentClass.prototype.render) &&
      !isClassComponent(ComponentClass)) {
    instance = mountFunctionalComponent(vnode, container, anchor, ComponentClass, props)
  } else {
    instance = mountClassComponent(vnode, container, anchor, ComponentClass, props)
  }

  vnode._component = instance
}

function isClassComponent(Ctor) {
  return Ctor.prototype instanceof Component ||
         (Ctor.prototype && typeof Ctor.prototype.render === 'function')
}

function mountClassComponent(vnode, container, anchor, Ctor, props) {
  const instance = new Ctor(props)
  instance._vnode = vnode
  instance._container = container
  instance._parentVNode = vnode._parent

  if (instance.componentWillMount) {
    instance.componentWillMount()
  }
  if (instance.UNSAFE_componentWillMount) {
    instance.UNSAFE_componentWillMount()
  }

  const subTree = instance._render()
  instance._subTree = subTree
  subTree._parent = vnode

  patch(null, subTree, container, anchor)

  instance._isMounted = true

  if (instance.componentDidMount) {
    queuePostFlushCb(() => {
      if (!instance._unmounted) {
        instance.componentDidMount()
      }
    })
  }

  if (vnode.ref) {
    if (typeof vnode.ref === 'function') {
      queuePostFlushCb(() => vnode.ref(instance))
    } else if (vnode.ref && typeof vnode.ref === 'object') {
      vnode.ref.current = instance
    }
  }

  return instance
}

function mountFunctionalComponent(vnode, container, anchor, fn, props) {
  const instance = createFunctionalInstance(vnode, fn, props)
  vnode._component = instance

  instance._vnode = vnode
  instance._container = container
  instance._parentVNode = vnode._parent

  try {
    const subTree = fn(props, {})
    instance._subTree = subTree || createEmptyVNode()
    if (instance._subTree) {
      instance._subTree._parent = vnode
    }
    patch(null, instance._subTree, container, anchor)
  } catch (e) {
    console.error('[FunctionalComponent] Error:', fn.name, e)
    const errVNode = createVNode('div', { style: { color: 'red' } }, [`Error: ${e.message}`])
    instance._subTree = errVNode
    patch(null, errVNode, container, anchor)
  }

  instance._isMounted = true
  return instance
}

function createFunctionalInstance(vnode, fn, props) {
  return {
    _id: ++componentIdCounter,
    _fn: fn,
    props,
    state: {},
    _vnode: vnode,
    _subTree: null,
    _container: null,
    _parentVNode: null,
    _isMounted: false,
    _unmounted: false,
    _isFunctional: true
  }
}

function createEmptyVNode() {
  return {
    type: 'div',
    props: { style: { display: 'none' } },
    children: [],
    key: null,
    ref: null,
    _dom: null,
    _component: null,
    _parent: null
  }
}

function updateComponent(oldVNode, newVNode) {
  const instance = oldVNode._component
  newVNode._component = instance
  instance._vnode = newVNode

  if (instance._isFunctional) {
    updateFunctionalComponent(instance, oldVNode, newVNode)
  } else {
    updateClassComponent(instance, oldVNode, newVNode)
  }
}

function updateClassComponent(instance, oldVNode, newVNode) {
  const oldProps = instance.props
  const newProps = resolveProps(newVNode)
  const havePropsChanged = !shallowEqual(oldProps, newProps)

  if (instance.UNSAFE_componentWillReceiveProps) {
    instance.UNSAFE_componentWillReceiveProps(newProps)
  }
  if (instance.componentWillReceiveProps) {
    instance.componentWillReceiveProps(newProps)
  }

  instance.props = newProps

  const prevState = instance.state
  let nextState = prevState
  if (instance._pendingState !== null) {
    nextState = Object.assign({}, prevState, instance._pendingState)
    instance._pendingState = null
  }

  if (instance.getDerivedStateFromProps) {
    const derived = instance.getDerivedStateFromProps(newProps, nextState)
    if (derived != null) {
      nextState = Object.assign({}, nextState, derived)
    }
  }

  if (instance.getSnapshotBeforeUpdate && instance._isMounted) {
    const snapshot = instance.getSnapshotBeforeUpdate(oldProps, prevState)
    instance._snapshot = snapshot
  }

  const shouldUpdate = instance._forceUpdate ||
    instance._shouldUpdate(newProps, nextState, prevState) ||
    havePropsChanged

  instance._forceUpdate = false

  if (instance.componentWillUpdate && instance._isMounted) {
    instance.componentWillUpdate(newProps, nextState)
  }
  if (instance.UNSAFE_componentWillUpdate && instance._isMounted) {
    instance.UNSAFE_componentWillUpdate(newProps, nextState)
  }

  if (shouldUpdate) {
    instance.state = nextState
    const prevSubTree = instance._subTree
    const nextSubTree = instance._render()
    instance._subTree = nextSubTree
    if (nextSubTree) nextSubTree._parent = newVNode

    const container = instance._container
    const anchor = getNextDOM(instance, newVNode)
    patch(prevSubTree, nextSubTree, container, anchor)
  } else {
    instance.state = nextState
  }

  if (instance.componentDidUpdate && instance._isMounted) {
    const snapshot = instance._snapshot
    instance._snapshot = undefined
    queuePostFlushCb(() => {
      if (!instance._unmounted) {
        instance.componentDidUpdate(oldProps, prevState, snapshot)
      }
    })
  }

  instance._flushCallbacks && instance._flushCallbacks()

  if (oldVNode.ref !== newVNode.ref) {
    if (oldVNode.ref) {
      if (typeof oldVNode.ref === 'function') oldVNode.ref(null)
      else if (oldVNode.ref && typeof oldVNode.ref === 'object') oldVNode.ref.current = null
    }
    if (newVNode.ref) {
      if (typeof newVNode.ref === 'function') queuePostFlushCb(() => newVNode.ref(instance))
      else if (newVNode.ref && typeof newVNode.ref === 'object') newVNode.ref.current = instance
    }
  }
}

function updateFunctionalComponent(instance, oldVNode, newVNode) {
  const fn = instance._fn
  const newProps = resolveProps(newVNode)
  instance.props = newProps

  const prevSubTree = instance._subTree
  try {
    const nextSubTree = fn(newProps, {}) || createEmptyVNode()
    instance._subTree = nextSubTree
    if (nextSubTree) nextSubTree._parent = newVNode

    const container = instance._container
    const anchor = getNextDOM(instance, newVNode)
    patch(prevSubTree, nextSubTree, container, anchor)
  } catch (e) {
    console.error('[FunctionalComponent] Update error:', fn.name, e)
  }
}

function unmountComponent(vnode, parentComponent, doRemove) {
  const instance = vnode._component
  if (!instance) return

  if (instance._unmounted) return
  instance._unmounted = true

  if (!instance._isFunctional) {
    if (instance.componentWillUnmount) {
      try { instance.componentWillUnmount() } catch (e) { console.error(e) }
    }
    if (instance._updateJob) {
      instance._updateJob = null
    }
    if (vnode.ref) {
      if (typeof vnode.ref === 'function') vnode.ref(null)
      else if (vnode.ref && typeof vnode.ref === 'object') vnode.ref.current = null
    }
  }

  if (instance._subTree) {
    unmount(instance._subTree, instance, null, doRemove)
  }
}

function resolveProps(vnode) {
  const props = { ...(vnode.props || {}) }
  if (vnode.children && vnode.children.length) {
    props.children = vnode.children.length === 1 ? vnode.children[0] : vnode.children
  }
  if (props.key !== undefined) delete props.key
  if (props.ref !== undefined) delete props.ref
  return props
}

function getNextDOM(instance, vnode) {
  const parent = vnode._parent
  if (parent && parent.children) {
    const idx = parent.children.indexOf(vnode)
    if (idx > -1 && idx + 1 < parent.children.length) {
      return getFirstDOM(parent.children[idx + 1])
    }
  }
  return null
}

setComponentHandlers({
  mount: mountComponent,
  update: updateComponent,
  unmount: unmountComponent
})

export {
  mountComponent,
  updateComponent,
  unmountComponent,
  nextTick,
  flushSync
}
