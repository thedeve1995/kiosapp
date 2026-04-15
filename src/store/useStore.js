import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useStore = create(
  persist(
    (set) => ({
  user: null,         // Owner or Employee
  setUser: (user) => set({ user }),

  cart: [],
  addToCart: (product, qty = 1) => set((state) => {
    const existing = state.cart.find(item => item.id === product.id);
    if (existing) {
      return { cart: state.cart.map(item => item.id === product.id ? { ...item, qty: item.qty + qty } : item) };
    }
    return { cart: [...state.cart, { ...product, qty }] };
  }),
  updateCartQty: (productId, qty) => set((state) => ({
    cart: state.cart.map(item => item.id === productId ? { ...item, qty: Math.max(1, qty) } : item)
  })),
  removeFromCart: (productId) => set((state) => ({
    cart: state.cart.filter(item => item.id !== productId)
  })),
  clearCart: () => set({ cart: [] }),
  
  shift: null,        // current shift info
  setShift: (shift) => set({ shift }),
}), {
  name: 'kios-finance-storage',
}));
