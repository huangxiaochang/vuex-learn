<template>
  <ul>
    <li
      v-for="product in products"
      :key="product.id">
      {{ product.title }} - {{ product.price | currency }}
      <br>
      <button
        :disabled="!product.inventory"
        @click="addProductToCart(product)">
        Add to cart
      </button>
    </li>
  </ul>
</template>

<script>
import { mapState, createNamespacedHelpers } from 'vuex'

const namespace = createNamespacedHelpers('cart')

export default {
  computed: mapState({
    products: state => state.products.all
  }),
  methods: namespace.mapActions([
    'addProductToCart'
  ]),
  created () {
    this.$store.dispatch('products/getAllProducts')
  }
}
</script>
