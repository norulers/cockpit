<template>
  <div>
    <v-tooltip :text="isFullScreen ? $t('Exit full screen') : $t('Go full screen')" location="bottom">
      <template #activator="{ props: tooltipProps }">
        <div v-bind="tooltipProps" class="relative cursor-pointer" @click="toggleFullScreen">
          <FontAwesomeIcon :icon="fullScreenToggleIcon" size="xl text-white" />
        </div>
      </template>
    </v-tooltip>
  </div>
</template>

<script setup lang="ts">
import { useFullscreen } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'

// In Electron the native fullscreen does not fire the browser Fullscreen API,
// so we manage state via IPC instead of relying on useFullscreen's internal listener.
const isElectron = !!window.electronAPI

const browserApi = isElectron ? null : useFullscreen()
const isFullscreen = browserApi ? browserApi.isFullscreen : ref(false)

onMounted(() => {
  if (!window.electronAPI) return
  window.electronAPI.onFullscreenChanged?.((fs: boolean) => { isFullscreen.value = fs })
  window.electronAPI.isFullscreen?.().then((fs: boolean) => { isFullscreen.value = fs })
})

const fullScreenToggleIcon = computed(() => (isFullscreen.value ? 'fa-solid fa-compress' : 'fa-solid fa-expand'))
const isFullScreen = computed(() => isFullscreen.value)

const toggleFullScreen = (): void => {
  if (window.electronAPI?.toggleFullscreen) {
    window.electronAPI.toggleFullscreen()
  } else {
    browserApi?.toggle()
  }
  logUserAction(`${isFullscreen.value ? 'Exited' : 'Entered'} fullscreen via mini-widget`)
}
</script>
