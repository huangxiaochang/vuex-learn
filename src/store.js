import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert, partial } from './util'

let Vue // bind on install

/*
  Store类的定义：
  创建实例对象的过程：
    1.根据开发者传来的配置options定义了一些属性和方法：
      _modules，_actions，_watcherVM，_mutations，_subscribers，dispatch，commit，
      state存储器属性，watch等等。
 */
 /*
  options = {
    // 根模块
    getters: {
      rootgetter: (state) => {}
    },
    actions: {
      rootaction: ({commit}, data) => {
  
      }
    },
    state: {
      rootstate: '111'
    },
    mutations: {
      rootmutation: () => {}
    },
    modules: {
      // 子模块
      a: {
        namespaced: true,
        state,
        getters,
        actions,
        mutations: {
          a_mutation: (state, data) => {}
        }
      }
    }
  }
 */
export class Store {
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    const {
      plugins = [],
      strict = false
    } = options

    // store internal state
    this._committing = false
    this._actions = Object.create(null) // 存储经过处理后开发者定义的actions
    this._actionSubscribers = []
    this._mutations = Object.create(null) // 存储经过处理后开发者定义的mutations
    this._wrappedGetters = Object.create(null) //存储经过处理后开发者定义的getters
    this._modules = new ModuleCollection(options) // 初始化模块，构建模块树
    this._modulesNamespaceMap = Object.create(null) // 存储有命名空间到模块之间的映射表
    this._subscribers = []
    // 创建一个Vue实例，利用$watch来监听store数据的变化
    this._watcherVM = new Vue()

    // bind commit and dispatch to self
    // 把dispatch,commit函数中的this绑定为Store实例对象store
    const store = this
    const { dispatch, commit } = this
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict

    // 根模块的state
    const state = this._modules.root.state

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    // 安装模块，目的是对模块中的state，getters，mutations，actions做初始化工作
    installModule(this, state, [], this._modules.root)

    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)
    // 初始化store._vm,该属性负责state的响应式
    resetStoreVM(this, state)

    // apply plugins，插件的应用，把Store实例对象store作为参数传入
    plugins.forEach(plugin => plugin(this))

    const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
    if (useDevtools) {
      devtoolPlugin(this)
    }
  }

  // 设置存储器属性state，即我们访问store.state时，实际上访问的是
  // store._vm._data.$$state。（在构造函数中，会把state当做Vue的data选项创建了一个Vue实例对象）
  get state () {
    return this._vm._data.$$state
  }

  // 确保store.state为只读属性
  set state (v) {
    if (process.env.NODE_ENV !== 'production') {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  // 原型上的commit方法，因为在构造函数中，已经绑定了commit内部的this指向了Store实例对象store，
  // 所以commit方法的内部的this指向的是store
  commit (_type, _payload, _options) {
    // check object-style commit
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    const entry = this._mutations[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    this._withCommit(() => {
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })
    this._subscribers.forEach(sub => sub(mutation, this.state))

    if (
      process.env.NODE_ENV !== 'production' &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  // 原型上的dispatch方法
  dispatch (_type, _payload) {
    // check object-style dispatch
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    const entry = this._actions[type]
    if (!entry) {
      if (process.env.NODE_ENV !== 'production') {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    try {
      this._actionSubscribers
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }

    const result = entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)

    return result.then(res => {
      try {
        this._actionSubscribers
          .filter(sub => sub.after)
          .forEach(sub => sub.after(action, this.state))
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[vuex] error in after action subscribers: `)
          console.error(e)
        }
      }
      return res
    })
  }

  subscribe (fn) {
    return genericSubscribe(fn, this._subscribers)
  }

  subscribeAction (fn) {
    const subs = typeof fn === 'function' ? { before: fn } : fn
    return genericSubscribe(subs, this._actionSubscribers)
  }

  watch (getter, cb, options) {
    if (process.env.NODE_ENV !== 'production') {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  // 提供了动态注册一个新的模块
  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    // 注册模块的路径只能是字符串或者数组，并且只能动态注册非根模块
    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    // 把新的模块加入模块树中
    this._modules.register(path, rawModule)
    // 然后注册新加进来的模块
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...
    // 重新实例化store._vm
    resetStoreVM(this, this.state)
  }

  // 动态取消注册模块
  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    // 取消的模块的路径只能是字符串或者数组
    if (process.env.NODE_ENV !== 'production') {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    // 在模块树种取消注册该模块
    this._modules.unregister(path)
    // 删除state访问路径中药删除的模块的state
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    // 重置store，即把store的_actions、_mutations、_wrappedGetters 和 _modulesNamespaceMap 都清空，
    // 然后重新执行 installModule 安装所有模块以及 resetStoreVM 重置 store._vm
    resetStore(this)
  }

  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  // 用于控制state的修改只能是通过mutation来修改，原理是内部的修改会在fn中修改state,
  // 会首先设置_committing为true,所以当state变化的时候，判断_committing是否为true，如果
  // 为true，则为内部通过mutation修改的，否者为外部其他形式的修改，会进行错误的提醒。
  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

function genericSubscribe (fn, subs) {
  if (subs.indexOf(fn) < 0) {
    subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

// 把store的_actions、_mutations、_wrappedGetters 和 _modulesNamespaceMap 都清空，
// 然后重新执行 installModule 安装所有模块以及 resetStoreVM 重置 store._vm
function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

// 该函数的实际作用是建立getters和state的联系，并且希望getters依赖的state
// 能够被缓存，只有当值发生的时候，才进行重新计算，所以使用了Vue中的计算属性
// 来实现。
// 1.设置store.getters成代理属性，代理访问store._vm上的同名计算属性，该计算属性内部会调用开发者定义的getter
// 2.创建一个Vue实例store._vm，把state当做store._vm._data.$$state的属性值，把开发者定义的getters,映射成store._vm
//    的计算属性。这样state变成了响应式的数据，同时getter是一个计算属性，只有当state发生变化时，才会重新求值。
// 3.严格模式下，创建一个Vue的watch来监视state的变化，当发生变化时，判断是否是内部的改变，如果不是，则错误提示。
// 4.如果存在旧的store._vm实例，则销毁。
function resetStoreVM (store, state, hot) {
  // 获取旧的Vue实例对象
  const oldVm = store._vm

  // bind store public getters
  // 把开发者定义的getter设置到store的getters属性上，同时把该属性设置成存储器属性进行了一层代理
  // 即访问store.getters上的属性时，实际上访问的是store._vm上的同名属性，该同名属性是store._vm的一个计算属性，
  // 在计算属性里面，会把相应的参数传递给开发者定义的getter执行得到结果。
  store.getters = {}
  const wrappedGetters = store._wrappedGetters
  // 创建一个Vue的计算属性
  const computed = {}
  // 遍历store._wrappedGetters，
  forEachValue(wrappedGetters, (fn, key) => {
    // fn => wrappedGetter,
    // use computed to leverage its lazy-caching mechanism
    // direct inline function use will lead to closure preserving oldVm.
    // using partial to return function with only arguments preserved in closure enviroment.
    computed[key] = partial(fn, store)
    // computed[key] = () => fn(store)
    // 设置代理，让this.$store.getters.xxxgetter => store.vm.xxxgetter，vm.xxxgetter即为vm的计算属性，也就是实际
    // 上访问computed[xxxgetter],在执行computed[xxxgetter]时，会执行对应的rawGetter方法（开发者定义的getter），开发者
    // 在rawGetter中会访问store.state,实际访问的是store._vm._data.$$state
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  // Vue.config.silent是否取消Vue所有的日志与警告
  const silent = Vue.config.silent
  Vue.config.silent = true
  // 创建一个Vue实例，因为Vue实例中data选项是响应式的，所以经过以下的设置之后，state就变成了
  // 响应式的数据。然后由于同时把getters中的选项定义成了计算属性，所以在getters中依赖的state发生
  // 变化的时候，计算属性中订阅者会得到通知，并进行相应的操作
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  // 开启严格模式，即state的改变只能是通过mutation来改变，不能是外部其他的方式。
  // 原理：创建Vue的$watch来监听state，state变化时，判断store._committing是否为true，如果不是，
  // 则为非法修改，因为内部修改state，都会先把store._committing设置成true。
  if (store.strict) {
    enableStrictMode(store)
  }

  // 销毁旧的Vue实例对象
  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}

// 定义安装模块的函数，实际上是对模块的state，getters，actions，mutations进行初始化工作,
//  即在store的_actions,_mutations,_wrappedGetters属性中建立开发者相应的配置的对应关系.(有命名空间时，
//  会根据模块注册的路径调整命名)
// 并且递归安装所有的子模块
/*
  参数： store: Store实例对象，rootState: 根模块的state, path:模块访问的路径，module：当前模块
          hot: 是否热更新
  安装模块：
    1.在store上建立命名空间到模块之间的映射表
    2.设置模块的context属性，该属性包含dispatch,commit,getters,state的处理方式，目的是
      在执行开发者定义的dispatch,commit,gettres,actions,mutations时，能够传进相应的state,
      getters,commit等参数
    3.设置store.state属性，即支持通过store.state和模块名，访问到相应模块的state属性
    4.注册模块中mutations： 即在store的_mutations属性中加入经过传参，命名空间处理后的开发者定义的mutations
    5.注册模块中actions： 即在store的_actions属性中加入经过传参，命名空间处理后的开发者定义的actions
    6.注册模块中getters： 即在store的_wrappedGetters属性中加入经过传参，命名空间处理后的getters
    7.递归注册子模块

 */
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length
  // 获取当前路径对应的模块的命名空间：命名空间由模块key和/组成的字符串
  /* 如： new Vuex({
    modules: {
      a: moduleA
    }
  })
  如果moduleA中设置命名空间为true的话，则moduleA的命名空间为'a/'
  */
  const namespace = store._modules.getNamespace(path)

  // register in namespace map
  // 建立命名空间到相应模块的映射表，目的：能够根据命名空间快速找到对应的模块
  if (module.namespaced) {
    store._modulesNamespaceMap[namespace] = module
  }

  // set state
  // 如果不是根模块并且不是热更新
  if (!isRoot && !hot) {
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      // 作用：设置store.rootstate.modulea.state
      Vue.set(parentState, moduleName, module.state)
    })
  }

  // 在模块中构建一个本地上下文环境，该上下文对象定义了dispatch，commit，getters，state，该上下文存储在模块的context属性中
  // 在有命名空间和没有命名空间的情况下相应的处理方式
  const local = module.context = makeLocalContext(store, namespace, path)

  // 以下对模块中配置的mutaions,actions, getters进行注册
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  module.forEachAction((action, key) => {
    // 如果action中配置了root: true,则直接注册到根store的_actions中，不需要通过命名空间来调整命名
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  // 安装子模块
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 创建一个本地上下文环境
 参数： store: Store实例对象， namespace: 命名空间， path： 模块的访问路径
 返回一个上下文环境对象，该对象拥有：
 dispatch，commit，getters，state属性方法
 */
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  // 定义一个local对象，
  // 对象的dispatch属性： 如果没有命名空间，直接指向根store的dispatch方法，
  //  否者创建一个新的函数, 该函数会先统一不同的风格，type拼接上命名空间之后，
  //  再调用store上的dispatch方法
  // 对象的commit属性：如果没有命名空间，直接指向根store的commit方法，
  //  否者创建一个新的函数，该函数会先统一不同的风格，type拼接上命名空间之后，
  //  再调用store上的dispatch方法
  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        // 类型加上命名空间
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      // type加上命名空间之后，调用store上的dispatch 
      // type: 有命名空间是 type => a/moduleAmutation
      return store.dispatch(type, payload)
    },

    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  // 在local对象上定义getters方法属性，如果没有命名空间，则定义一个函数直接返回store的getters,
  //  否者，定义一个函数，该函数会先根据命名空间找到store.getters相应的getter返回
  // 在local对象上定义一个state方法属性，该方法
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      // getNestedState会根据模块访问路径，返回相应模块的state
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

// 在有命名空间的情况下，创建一个本地的getters环境，
// 
function makeLocalGetters (store, namespace) {
  const gettersProxy = {}

  const splitPos = namespace.length
  // 遍历store上的getters
  Object.keys(store.getters).forEach(type => {
    // skip if the target getter is not match this namespace
    // 如果目标getter没有匹配当前的命名空间，跳过
    if (type.slice(0, splitPos) !== namespace) return

    // extract local getter type
  // 提取本地getter的类型
    const localType = type.slice(splitPos)

    // Add a port to the getters proxy.
    // Define as getter property because
    // we do not want to evaluate the getters in this time.
    // 增加代理，即访问本地getter的type时，实际上访问的是store上getters同名的type
    Object.defineProperty(gettersProxy, localType, {
      get: () => store.getters[type],
      enumerable: true
    })
  })

  return gettersProxy
}

// 注册mutation，即把开发者定义的nutation设置到store._mutations中
// 
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}

// 注册action，即把开发者定义的action设置到store._actions中
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload, cb) {
    // 执行开发者定义的action
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload, cb)

    // 如果得到的结果不是一个promise，则包装成一个promise
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }

    // 返回结果
    // 当devtools开启时，让它能捕获promise的报错
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

// 注册getter：在store的_wrappedGetters属性上定义与开发者定义的getter同名函数，该函数
// 会传进local state ， local getters, root state, root getters参数去执行开发者定义
// 的getter函数，并返回执行的结果
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    // 返回开发者定义的getter函数执行的结果，
    // 开发者的getter函数的参数：本地的state，本地的getters，根state，根getters
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

// 开启严格模式，即创建一个Vue的watch去监听state,如果state变化的时候，store._committing属性不为
// true的时候，即是非法的改变，因为内部改变state的时候，都会先把store._committing设置为true，修改完成后
// 在恢复store._committing的值
function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (process.env.NODE_ENV !== 'production') {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}

// state 的实现，根据模块的访问路径，
// 通过该路径，找到相应的模块，然后返回该模块的state，
// 如果是根模块，直接返回根模块的state
function getNestedState (state, path) {
  return path.length
    ? path.reduce((state, key) => state[key], state)
    : state
}

// 统一对象风格
// 在vuex的commit，dispatch方法中，参数可以是一个对象，也可以是分开传进mutations的type
// 和要提交的值，该方法就是用来统一这两种风格的，即统一获取到type，payload(传进的数据)，
// 如： store.commit({type: 'add', data: 1})
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}

// 安装vuex插件的方法
// 1.使用全局变量Vue存储Vue构造函数，便于其他地方使用，避免了引入，减少了项目的体积
// 2.全局（在每一个Vue实例中）注入一个beforeCreate钩子函数，在该钩子函数中进行初始化的工作
export function install (_Vue) {
  // 确保vuex只能安装一次
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}
