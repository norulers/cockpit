<template>
  <div>
    <v-tooltip :text="tooltipText" location="bottom">
      <template #activator="{ props: tooltipProps }">
        <div v-bind="tooltipProps" class="relative cursor-pointer" :class="indicatorClass" @click="openConfigMenu">
          <FontAwesomeIcon icon="fa-solid fa-gamepad" size="xl" />
          <FontAwesomeIcon
            v-if="!joystickConnected || !controllerStore.enableForwarding"
            icon="fa-solid fa-slash"
            size="xl"
            class="absolute left-0"
          />
        </div>
      </template>
    </v-tooltip>

    <InteractionDialog
      v-model:show-dialog="widgetStore.miniWidgetManagerVars(miniWidget.hash).configMenuOpen"
      :title="$t('Joystick RC Channel Setup')"
      max-width="500px"
      variant="text-only"
    >
      <template #content>
        <JoystickChannelSetup />
      </template>
      <template #actions>
        <v-btn @click="widgetStore.miniWidgetManagerVars(miniWidget.hash).configMenuOpen = false">
          {{ $t('Close') }}
        </v-btn>
      </template>
    </InteractionDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'

import InteractionDialog from '@/components/InteractionDialog.vue'
import JoystickChannelSetup from '@/components/JoystickChannelSetup.vue'
import { joystickManager } from '@/libs/joystick/manager'
import { useControllerStore } from '@/stores/controller'
import { useWidgetManagerStore } from '@/stores/widgetManager'
import type { MiniWidget } from '@/types/widgets'

const props = defineProps<{
  /**
   *
   */
  miniWidget: MiniWidget
}>()
const miniWidget = toRefs(props).miniWidget

const widgetStore = useWidgetManagerStore()
const controllerStore = useControllerStore()
const { t } = useI18n()
const joystickConnected = ref(false)

onMounted(() => {
  joystickManager.onJoystickConnectionUpdate((event) => (joystickConnected.value = event.size !== 0))
})

const openConfigMenu = (): void => {
  logUserAction('Opened the joystick RC channel setup menu')
  widgetStore.miniWidgetManagerVars(miniWidget.value.hash).configMenuOpen = true
}

const indicatorClass = computed(() => {
  if (!joystickConnected.value) return 'text-gray-700'
  if (!controllerStore.enableForwarding) return 'text-yellow-500'
  return 'text-slate-50'
})

const tooltipText = computed(() => {
  if (!joystickConnected.value) return t('Joystick disconnected')
  if (!controllerStore.enableForwarding) return t('Connected but disabled')
  return t('Connected and enabled')
})
</script>
