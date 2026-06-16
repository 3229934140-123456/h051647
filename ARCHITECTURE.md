# MinReact - 虚拟DOM与组件渲染框架 架构说明

> 一个精简版 React 核心实现,包含 6 个模块:虚拟DOM、DOM操作、Diff/Reconcile、调度器、组件系统、入口整合。

---

## 📁 目录结构

```
47/
├── src/
│   ├── vdom.js        # 1. 虚拟 DOM 模块
│   ├── dom.js         # 2. DOM 操作模块
│   ├── diff.js        # 3. Diff / Reconcile 模块
│   ├── scheduler.js   # 4. 调度器模块
│   ├── component.js   # 5. 组件系统模块
│   └── index.js       # 6. 入口 / API 整合
├── index.html         # 示例演示页面
└── ARCHITECTURE.md    # 本文档
```

---

## 🔷 模块一:虚拟 DOM (vdom.js)

### 核心职责
用纯 JavaScript 对象描述 UI 结构,代替手写 DOM 操作。

### VNode 数据结构
每个虚拟节点的标准格式:

```javascript
{
  type,          // 节点类型: string('div') / function(组件类) / Symbol(TEXT/FRAGMENT)
  props,         // 属性对象: { id, className, onClick, style, children... }
  children,      // 子节点数组 (已 normalize)
  key,           // 列表 diff 的唯一标识
  ref,           // DOM 引用
  _dom,          // 绑定的真实 DOM (运行时填充)
  _component,    // 绑定的组件实例 (运行时填充)
  _parent        // 父 VNode (运行时填充)
}
```

### createElement 工厂函数
对应 JSX 编译后的调用,提供声明式构建方式:

```javascript
// JSX:  <div className="box" onClick={handler}>
//          <span>Hello</span> World
//        </div>
// 编译后:
createElement('div', { className: 'box', onClick: handler },
  createElement('span', null, 'Hello'),
  'World'
)
```

### 关键函数
| 函数 | 作用 |
|------|------|
| `createElement(type, config, ...children)` | JSX 工厂函数 |
| `createVNode(type, props, children)` | 底层 VNode 创建 |
| `createTextVNode(text)` | 创建文本节点 VNode |
| `normalizeChildren(children)` | 递归扁平化、过滤、字符串转 TextVNode |
| `isSameVNodeType(n1, n2)` | 两节点是否同类(key+type 都相同) |

### UI 如何用虚拟 DOM 树描述
1. **树 = 嵌套的 VNode**:根节点的 `children` 递归包含整棵 UI
2. **文字/数字/布尔/null 自动标准化**:布尔和 null/undefined 会被过滤,避免渲染
3. **数组自动展开**:支持 `list.map(item => <li key={item.id}>{item.text}</li>)`
4. **Fragment 支持无包裹多根节点**

---

## 🔶 模块二:DOM 操作 (dom.js)

### 核心职责
将 VNode 翻译为真实 DOM 操作:创建、更新属性、插入、移除。

### 关键 API

#### 1. `createDOMElement(vnode)` —— 递归创建真实 DOM
```
createElement('div', {class:'a'}, [
  createElement('span', null, ['Hi'])
])
↓
<div class="a">           ← document.createElement
  <span>Hi</span>         ← 递归 createDOMElement + appendChild
</div>
```

#### 2. `updateProps(dom, oldProps, newProps)` —— 差异属性更新
分类处理属性类型:
- **事件** (on*):removeEventListener + addEventListener
- **style**:增量更新,数值自动加 `px`(除 unitless 属性列表)
- **className/class**:setAttribute('class', ...)
- **value/checked**:直接 DOM 赋值(表单受控)
- **innerHTML/dangerouslySetInnerHTML**:安全 HTML 注入
- **普通属性**:setAttribute / removeAttribute

#### 3. 节点位置操作
- `insertBefore(parentDom, newDom, nextDom)` —— 有锚点插锚点前,无则 append
- `removeElement(parentDom, dom)` —— 从父节点移除
- `getFirstDOM / getLastDOM(vnode)` —— 获取 Fragment 的首尾(用于移动锚点)

---

## 💠 模块三:Diff / Reconcile (diff.js) —— 核心算法

### 核心思想
**相同位置、相同类型的节点,才复用并更新;否则销毁重建。**

### patch 主流程 (oldVNode, newVNode, container, anchor)

```
patch(n1, n2, container, anchor)
  │
  ├─ 同 key + 同 type ?
  │     YES → 进入具体类型 process (更新)
  │     NO  → unmount(n1) → mount(n2) (替换)
  │
  └─ 按类型分发:
       processText      → 文本:对比 nodeValue 更新内容
       processElement   → 元素:updateProps + patchChildren
       processComponent → 组件:调用 mount/update 回调
       processFragment  → 片段:patchChildren(无包裹容器)
```

### 🌳 普通树 Diff (同层递归)
- **深度优先、同层比较**:O(n) 时间复杂度
- 跳过跨层移动识别(实际业务极罕见,换取 O(n) 而非 O(n³))

### 📋 列表 Diff:双端比较 + Key 复用 + LIS

**patchKeyedChildren** 实现了与 Vue/React 一致的高效算法,分 5 步:

#### 第 1、2 步:首尾同步扫描 (prefix / suffix)
用双指针从两端向中间收缩,跳过首尾相同的序列:
```
旧: [a b c d e f]
新: [a b X d e f]
     ↑↑         ↑↑
   跳过前缀  跳过后缀
只需比较中间的 [c] vs [X]
```

#### 第 3 步:旧序列已耗尽 → 直接挂载剩余新节点
```
旧: [a b]
新: [a b c d e]
         ↑ ↑ ↑  →  mount(c), mount(d), mount(e)
```

#### 第 4 步:新序列已耗尽 → 卸载多余旧节点
```
旧: [a b c d e]
新: [a b]
         ↑ ↑ ↑  →  unmount(c), unmount(d), unmount(e)
```

#### 第 5 步:中间未知序列 —— 核心算法
```
旧中间: [c d e f g]   s1..e1
新中间: [e c d h f]   s2..e2
```

**5a. 建立 key → newIndex 的 Map**  
`Map { e→0, c→1, d→2, h→3, f→4 }` (O(1) 查找)

**5b. 遍历旧序列找对应关系**  
对每个旧节点:
- 用 key 在 Map 中 O(1) 查位置
- 找到 → 记录 newIndexToOldIndexMap、递归 patch 子树
- 没找到 → unmount 该节点
- 同时通过 `maxNewIndexSoFar` 判断是否有移动需要

**5c. 计算最长递增子序列 (LIS) —— 最小移动次数的关键**  
例如 `newIndexToOldIndexMap = [3, 1, 2, 0, 4]` 表示:
- 新[0]对应旧[3]、新[1]对应旧[1]、新[2]对应旧[2]、新[3]新造、新[4]对应旧[4]

LIS = `[1, 2, 4]` (递增的索引表示这些节点相对顺序正确,**不需要移动**)

**5d. 倒序处理 + 锚点移动**  
从末尾向前遍历:
- 若在 LIS 中 → 跳过(位置已正确)
- 不在 LIS 中 → 移动到后续节点前
- newIndexToOldIndexMap[i] == 0 → 新建节点

### key 的作用总结
| 有 key (用唯一 id) | 无 key (用 index) |
|---|---|
| 同 key 节点复用,内容更新 | 同位置假设同类,内容强制覆盖 |
| 反转/打乱 → 只移动 DOM | 反转/打乱 → 全部重建子树 |
| 插入开头 → 1 次创建 + 0 重建 | 插入开头 → 所有子节点销毁重建 |
| 表单控件不会错位 | 输入框在删除项时错位(值与节点绑定错) |

---

## ⚙️ 模块四:调度器 (scheduler.js)

### 解决的问题
同步多次 `setState` 如果每次都渲染 → 性能灾难。

### 核心思想
**微任务(Promise.then) 批处理:所有同步的 setState 合并为 1 次 render**

### 三层回调队列
```
┌────────────────────────────────────────────────────┐
│  flushJobs (Promise.then 中执行,微任务阶段)        │
│                                                    │
│  1. flushPreFlushCbs  (beforeUpdate 等前置)        │
│  2. 执行 updateQueue  (组件 _update 渲染)          │
│     → 按组件 _id 排序,父先于子渲染                 │
│  3. flushPostFlushCbs (didMount/didUpdate/回调)    │
│                                                    │
│  └→ 若过程中又产生任务 → 递归 flushJobs            │
└────────────────────────────────────────────────────┘
```

### 批量调度工作流程
```
用户同步调用:
  setState({a:1})  →  pendingState 合并入对象
  setState({b:2})  →  pendingState 合并
  setState({c:3})  →  queueJob 入队 (首次入队触发 flush)
                     |
                     ↓  Promise.then(微任务)
                     [组件._update()]
                       → pendingState 合并 + 浅合并到 this.state
                       → 一次 render + patch 完成
                       → setState 回调依次调用
```

### 其他 API
- `nextTick(fn)`:下一次刷新完成后执行
- `flushSync(fn)`:立即同步刷新(跳过批量)
- `getSchedulerState()`:调试用,查看当前队列状态

---

## 🧩 模块五:组件系统 (component.js)

### 类组件 (Component 基类)

#### 状态持有与更新
```javascript
class MyComp extends Component {
  constructor(props) {
    super(props)
    this.state = { count: 0 }  // 初始状态
  }
  onClick = () => {
    // 对象式或函数式(可拿 prevState)
    this.setState(prev => ({ count: prev.count + 1 }), () => {
      console.log('更新完成回调')
    })
  }
  render() {
    return createElement('button', { onClick: this.onClick }, this.state.count)
  }
}
```

#### setState 内部流程
```
setState(partial, cb)
  │
  ├─ 合并到 _pendingState (支持对象/函数)
  ├─ cb 存入 _pendingCallbacks 数组
  └─ _enqueueUpdate()
        │
        └─ queueJob(组件._update)
              │
              └─ [调度器微任务中执行]
                    │
                    ├─ _pendingState 浅合并入 this.state
                    ├─ shouldComponentUpdate / PureComponent 浅比较
                    ├─ → 可渲染?
                    │     YES → render() 生成新 VNode 树
                    │            patch(旧子树, 新子树, container)
                    │            componentDidUpdate 后回调
                    │     NO  → 仅更新 state
                    │
                    └─ _pendingCallbacks flush
```

### 生命周期钩子 (在协调过程中触发)

#### 挂载 (patch 中 oldVNode == null 时走 mountComponent)
```
mountComponent(vnode, container, anchor)
  ├─ new ComponentClass(props)       // 构造函数
  ├─ componentWillMount()            // 即将挂载
  ├─ render() → subTree              // 生成子虚拟树
  ├─ patch(null, subTree, ...)       // 递归创建 DOM
  ├─ [postFlushCb 微任务中]
  │     └─ componentDidMount()       // 挂载完成,可操作 DOM/发请求
  └─ ref(instance) 赋值
```

#### 更新 (props/state 变化 → patchComponent)
```
updateComponent(oldVNode, newVNode)
  ├─ componentWillReceiveProps(newProps)  // props 变化
  ├─ getDerivedStateFromProps (static)    // 派生状态
  ├─ shouldComponentUpdate(nextProps, nextState) → false 则跳过
  ├─ componentWillUpdate(nextProps, nextState)
  ├─ getSnapshotBeforeUpdate(prevP, prevS) → 返回 snapshot
  ├─ render() → newSubTree
  ├─ patch(oldSubTree, newSubTree, ...)   // DIFF 打补丁
  └─ [postFlushCb 微任务中]
        └─ componentDidUpdate(prevP, prevS, snapshot)
```

#### 卸载 (patch 中类型不同或 unmountChildren)
```
unmountComponent(vnode)
  ├─ componentWillUnmount()            // 可清定时器/监听器
  ├─ invalidateJob(_updateJob)         // 取消队列中未执行的更新
  ├─ ref(null) 清空引用
  └─ unmount(subTree)                  // 递归卸载所有子节点
          │
          └─ unmountChildren → 倒序 unmount 子组件
```

### 完整生命周期图
```
                    首次挂载
                       │
                       ▼
          constructor → componentWillMount
                       │
                       ▼
                    render()
                       │
                       ▼
                 DOM mount 完成
                       │
                       ▼
                componentDidMount ────┐
                       │              │
            ┌──────────┘              │ setProps/setState
            │ props/state 变化         │
            ▼                         │
  componentWillReceiveProps            │
            │                         │
            ▼                         │
   getDerivedStateFromProps           │
            │                         │
            ▼                         │
   shouldComponentUpdate? ──NO────────┘
            │YES
            ▼
    componentWillUpdate ──→ render() ──→ patch DOM
                                            │
                                            ▼
                              getSnapshotBeforeUpdate
                                            │
                                            ▼
                                 componentDidUpdate
                                            │
                                     (持续循环或卸载)
                                            │
                                            ▼
                                  componentWillUnmount
```

### PureComponent
在 `_shouldUpdate` 中对 props 和 state 做 `shallowEqual`(一层浅比较):
- props/state 引用完全相同或浅层值全相等 → 跳过 render
- 适用于纯展示组件,避免不必要的渲染

### 函数式组件
```javascript
function UserCard({ user, onClick }) {
  return createElement('div', { onClick }, user.name)
}
```
- 无自己的 state(简化版),仅 props → UI 的纯函数
- 内部包装成 FunctionalInstance(无生命周期钩子)
- 与类组件走同一套 patch/mount/unmount 流程

---

## 🏁 模块六:入口整合 (index.js)

### 暴露 API
| API | 说明 |
|-----|------|
| `createElement / h` | JSX 工厂函数 |
| `Component / PureComponent` | 基类 |
| `createRef` | 创建 ref 对象 `{ current: null }` |
| `Fragment` | 多根无包裹组件 |
| `render(vnode, container, cb?)` | 挂载或更新整棵应用 |
| `unmountAt(container)` | 卸载根节点 |
| `nextTick(fn)` | 下一次刷新后执行 |
| `flushSync(fn)` | 同步刷新 |

### render 首次挂载 vs 后续更新
```javascript
// 首次
render(<App/>, root)
  → container.innerHTML = ''   // 清空
  → patch(null, appVNode, root) // 递归 mount

// 后续(container 上有 __minreact_root_vnode__ 引用)
render(<App newProps/>, root)
  → patch(prevRoot, newRoot, root) // DIFF 增量更新
```

---

## 🎯 完整数据流 (从点击到渲染)

以计数器为例,点击 "+连续+5" 按钮后的完整链路:

```
  用户点击按钮
      │
      ▼ [真实 DOM click 事件]
  eventListener → handler.increment()
      │
      │ for (let i = 0; i < 5; i++)
      │   this.setState({ count: this.state.count + 1 })
      │
      ▼ [5 次 setState 同步调用]
  ┌─────────────────────────────────────┐
  │ _pendingState = { count: 0+1+1+1+1+1 } │ 合并
  │ _pendingCallbacks = [...]           │
  │ queueJob(首次) → Promise.then(flush) │
  └─────────────────────────────────────┘
      │
      ▼ [同步代码结束,进入微任务]
  flushJobs() 调度器执行
      │
      ▼
  component._update()
      │
      ├─ this.state = merge(prevState, _pendingState)  // count 合并 = 5
      ├─ shouldComponentUpdate → true
      ├─ render() → 生成新 VNode 树 (count=5 显示)
      │
      ▼ [核心 Diff]
  patch(旧VNode树{count:0}, 新VNode树{count:5}, container)
      │
      ├─ <Counter> 同类 → updateComponent
      │   └─ <div> 同类 → patchElement
      │        └─ props 都一样 → patchChildren
      │             └─ 文字节点: 比较 nodeValue 不同
      │                  → updateTextContent('5')
      │                     (仅 1 次 DOM 操作!)
      │
      ▼ [postFlush]
  componentDidUpdate 等回调 + setState 回调执行
      │
      ▼
  浏览器重绘,用户看到 count = 5 ✔️
```

**关键点**: 5 次 setState → **1 次 render → 1 次 DOM 更新**。  
若无调度器,会发生 5 次 render + 5 次 diff,性能差 5 倍。

---

## 🔧 性能优化总结

| 优化点 | 实现位置 | 说明 |
|---|---|---|
| 批量 setState | scheduler.js | 微任务合并,同轮事件循环只 1 次 render |
| 类型+key 复用 | diff.js `isSameVNodeType` | 只有同类同 key 才更新,否则直接替换 |
| 前缀后缀跳过 | diff.js `patchKeyedChildren` 步骤 1-2 | O(n) 先跳过头尾相同序列 |
| LIS 最小移动 | diff.js `getSequence` | 最长递增序列 → 节点移动数最小化 |
| key Map 查找 | diff.js `keyToNewIndexMap` | O(1) 找对应节点,避免 O(n²) |
| 属性增量更新 | dom.js `updateProps` | 只 patch 差异属性,事件用 remove/add |
| style 增量更新 | dom.js `updateStyle` | 只改不同的 key,数值自动 px |
| PureComponent | component.js `shallowEqual` | 浅层比较 props/state 跳过无意义渲染 |
| 调度去重 | scheduler.js `queueJob includes` | 同一组件同轮多次只执行一次 |
| 倒序卸载 + DOM 复用 | diff.js unmountChildren | 倒序便于拿锚点,Fragment 复用 DocumentFragment |

---

## 📝 使用示例

```javascript
import { createElement as h, Component, render } from './src/index.js'

class App extends Component {
  constructor(p) {
    super(p)
    this.state = { list: ['A', 'B', 'C'] }
  }
  add = () => this.setState({ list: [Date.now(), ...this.state.list] })
  render() {
    return h('div', null,
      h('button', { onClick: this.add, style: { padding: '8px 16px' } }, '添加项 (key 优化)'),
      h('ul', null,
        this.state.list.map(item =>
          h('li', { key: item, style: { padding: '4px' } }, item)
        )
      )
    )
  }
}

render(h(App), document.getElementById('root'))
```

---

## ✨ 总结:各模块如何协作

```
          用户写 JSX
             │
             ▼  [Babel 编译]
      createElement(...)  ← vdom.js
             │
             ▼
      VNode 树 (内存中的纯对象)
             │
             ▼
    render(vnode, container)  ← index.js
             │
    ┌────────┴────────┐
    ▼                 ▼
首次挂载           更新路径
    │                 │
mountComponent   updateComponent ← component.js
    │                 │
    │  props/state 改变触发 setState
    │         │        │
    │         ▼        │
    │    调度器 (scheduler.js)  合并→批量
    │         │        │
    └────► patch ◄────┘
             │      ← diff.js
             ▼
  类型判断 + 子节点递归 + 列表 key 双端比较 + LIS
             │
             ▼
  create/update/remove DOM  ← dom.js
             │
             ▼
        浏览器渲染 ✅
```
