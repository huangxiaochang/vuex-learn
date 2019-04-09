import Module from './module'
import { assert, forEachValue } from '../util'

// 定义构建模块树的类
// ModuleCollection类的作用是根据开发者定义的options中的模块，
// 构建一个模块树，由roor属性指向根模块，每个模块中由_children属性收集着所有的子模块，
// 同时提供了在模块树中注册一个新模块和取消注册一个模块的方法，根据路径来或者模块树中
// 的某个模块的方法，更新整个模块树的方法
export default class ModuleCollection {
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    // 参数： rawRootModule：options（用户的vuex配置）
    // 注册根模块
    this.register([], rawRootModule, false)
  }

  // 该函数返回一个模块
  get (path) {
    // reduce函数函数： 
    // 1.function(total，currentValue, currentIndex, arr){}
    //    total: 初始值，或者计算结束后的返回值
    // 2.初始值（传递给1中function的第一个参数）
    // 3. 如果path是一个空数组，那么path.reduce()的值为初始值，不会执行第一个函数参数
    // 4.如果path是一个空数组，并且没有提供初始值的话，会报错
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  // 获取模块的命名空间
  // 返回由模块名(/隔开)组成的字符串，根模块的命名空间默认为''
  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      // key可以认为是模块名
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  // 提供更新模块树的接口
  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }

  // 参数：path：构建模块树时维持的路径, rawModule: 开发者的模块配置，runtime：是否是
  // 运行时创建的模块
  register (path, rawModule, runtime = true) {
    if (process.env.NODE_ENV !== 'production') {
      // 生产环境下，对开发者定义的actions,getters,mutactions中的项进行类型检查
      assertRawModule(path, rawModule)
    }

    // 创建一个模块
    const newModule = new Module(rawModule, runtime)
    if (path.length === 0) {
      this.root = newModule
    } else {
      // path.slice(0, -1)：path中开始到倒数第一个元素的全部元素，即不包含最后一个元素
      const parent = this.get(path.slice(0, -1))
      parent.addChild(path[path.length - 1], newModule)
    }

    // register nested modules
    // 注册嵌套模块
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        // concat()的参数可以是一个数组，也可以是一个具体的值，效果都是返回一个
        // 新的数组，新数组中的值为path中的项，和concat中的项
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  // 取消注册一个模块，即把相应的模块从父模块的_children属性中移除
  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    if (!parent.getChild(key).runtime) return

    parent.removeChild(key)
  }
}

// 更新模块树的函数，即替换模块_rawModule属性的_actions等值
function update (path, targetModule, newModule) {
  if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, newModule)
  }

  // update target module
  targetModule.update(newModule)

  // update nested modules
  // 更新子模块
  if (newModule.modules) {
    for (const key in newModule.modules) {
      // 不能通过更新来注册一个新的模块, 只能更新原模块树中已经存在的模块
      if (!targetModule.getChild(key)) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `[vuex] trying to add a new module '${key}' on hot reloading, ` +
            'manual reload is needed'
          )
        }
        return
      }
      update(
        path.concat(key),
        targetModule.getChild(key),
        newModule.modules[key]
      )
    }
  }
}

// 函数断言
const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}

// 对象断言
const objectAssert = {
  assert: value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}

const assertTypes = {
  getters: functionAssert,
  mutations: functionAssert,
  actions: objectAssert
}

// 该函数的作用是：
// 对于开发者定义的getters，mutations，actions中的项进行类型检查，
// 如果不是希望的类型，会抛出一个Error实例
function assertRawModule (path, rawModule) {
  Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return

    const assertOptions = assertTypes[key]

    // forEachValue的作用：遍历一个对象，把value,key作为参数执行第二个函数参数
    forEachValue(rawModule[key], (value, type) => {
      // assert函数的作用是进行错误信息的打印
      assert(
        assertOptions.assert(value), // 返回boolean,是否希望的类型
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}

// 输出定义类型错误的消息
// key: getters,mutations,actions,
// type、value: 开发者定义的getters,mutations,actions中的键、值
// expected：希望的；类型
function makeAssertionMessage (path, key, type, value, expected) {
  let buf = `${key} should be ${expected} but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`
  return buf
}
