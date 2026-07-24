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
import { isElectron } from '@/libs/utils'
import { computed, onMounted, ref } from 'vue'

const electronFullscreen = ref(false)

const isFullScreen = computed(() => electronFullscreen.value)

const fullScreenToggleIcon = computed(() => (isFullScreen.value ? 'fa-solid fa-compress' : 'fa-solid fa-expand'))

const toggleFullScreen = async (): Promise<void> => {
  logUserAction(`${isFullScreen.value ? 'Exited' : 'Entered'} fullscreen via mini-widget`)
  if (isElectron() && window.electronAPI?.toggleFullscreen) {
    electronFullscreen.value = await window.electronAPI.toggleFullscreen()
  } else {
    // Fallback for browser: use Fullscreen API
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      electronFullscreen.value = false
    } else {
      await document.documentElement.requestFullscreen()
      electronFullscreen.value = true
    }
  }
}

onMounted(async () => {
  if (isElectron() && window.electronAPI?.isFullscreen) {
    electronFullscreen.value = await window.electronAPI.isFullscreen()
  }
})
</script>
