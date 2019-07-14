import 'babel-polyfill'
import Vue from 'vue'
import Counter from './Counter.vue'
import store from './store'

new Vue({
  el: '#app',
  store, // store may be a function
  render: h => h(Counter)
})
