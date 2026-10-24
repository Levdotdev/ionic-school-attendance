import { ref } from 'vue'

const collapsed = ref(false)
try { collapsed.value = localStorage.getItem('minsu-sidebar-collapsed') === 'true' } catch { /* Private browsing. */ }
export function useNavigation() {
  function toggleSidebar() {
    collapsed.value = !collapsed.value
    try { localStorage.setItem('minsu-sidebar-collapsed', String(collapsed.value)) } catch { /* In-memory preference still works. */ }
  }
  return { collapsed, toggleSidebar }
}
