import { forEachValue } from '../util'

// Base data struct for store's module, package with some attribute and method
// 创建模块的类定义：
// 构造函数： 定义模块的相关属性和方法：
//  _children，_rawModule，state，addChild，removeChild，update，forEachChild，
// forEachGetter，forEachMutation，forEachAction等等。
// state: 一个对象，开发者配置的对象或者空对象。作用：存储组件的共享状态
// _children： 子模块集合
// forEachChild： 提供遍历该模块所有子模块的方法，
// forEachGetter，forEachMutation，forEachAction：提供遍历该模块getters,mutactions,actions
// 的接口。
export default class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    // Store some children item
    this._children = Object.create(null)
    // Store the origin module object which passed by programmer
    this._rawModule = rawModule
    const rawState = rawModule.state

    // Store the origin module's state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }

  // 获取该模块是否定义了命名空间
  get namespaced () {
    return !!this._rawModule.namespaced
  }

  // 在该模块中添加一个子模块
  addChild (key, module) {
    this._children[key] = module
  }

  // 在该模块中移除一个子模块
  removeChild (key) {
    delete this._children[key]
  }

  // 获取该模块中的一个子模块
  getChild (key) {
    return this._children[key]
  }

  // 提供更新该模块的namespaced，actions，mutations，getters的方法。
  // 即：可以使用该方法开重新赋值该模块的以上的属性的值
  update (rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }

  // 提供遍历该模块的所有子模块的接口，会把值和键作为参数执行遍历的回调函数
  forEachChild (fn) {
    forEachValue(this._children, fn)
  }

  // 提供遍历该模块中定义的getters，会把值和键作为参数执行遍历的回调函数
  forEachGetter (fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }

  // 提供遍历该模块中定义的actions，会把值和键作为参数执行遍历的回调函数
  forEachAction (fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }

  // 提供遍历该模块中定义的mutations，会把值和键作为参数执行遍历的回调函数
  forEachMutation (fn) {
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
