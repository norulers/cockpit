<template>
  <div>
    <div class="flex items-center gap-2 mb-3">
      <v-select
        v-model="selectedJoystickIndex"
        :items="joystickItems"
        :label="$t('Gamepad')"
        density="compact"
        variant="outlined"
        hide-details
        theme="dark"
        class="flex-1"
      />
      <v-btn size="small" :color="enableDirectControl ? 'red' : 'green'" variant="tonal" @click="toggleForwarding">
        {{ enableDirectControl ? $t('Disable') : $t('Enable') }}
      </v-btn>
      <v-btn size="small" color="green" variant="tonal" :disabled="saved" @click="saveChannels">
        {{ saved ? $t('saved') : $t('Save') }}
      </v-btn>
    </div>

    <div class="text-xs opacity-70 mb-2">
      {{
        detecting >= 0
          ? $t('Move the axis you want to assign...')
          : $t('Click Detect and move an axis to map each channel.')
      }}
    </div>

    <div v-for="ch in channels" :key="ch.id" class="flex items-center gap-2 mb-1 py-1 border-b border-[#FFFFFF11]">
      <span class="w-8 text-xs font-mono">{{ ch.label }}</span>

      <v-select
        v-model="ch.axis"
        :items="axisOptions"
        density="compact"
        variant="outlined"
        hide-details
        theme="dark"
        class="w-[100px] text-xs"
        @update:model-value="onAxisChange(ch)"
      />

      <v-btn size="x-small" variant="outlined" class="text-xs" @click="detectAxis(ch)">
        {{ $t('Detect') }}
      </v-btn>

      <div class="flex-1 h-4 bg-[#FFFFFF11] rounded relative overflow-hidden">
        <div class="absolute h-full bg-green-600 rounded transition-all" :style="{ width: ch.barWidth + '%' }" />
      </div>

      <span class="w-10 text-xs font-mono text-right" :class="ch.pwmText === '\u2014' ? 'opacity-40' : ''">
        {{ ch.pwmText }}
      </span>

      <v-checkbox
        v-model="ch.reversed"
        density="compact"
        hide-details
        color="white"
        class="ml-1"
        @update:model-value="(v: boolean) => logUserAction(`${v ? 'Reversed' : 'Unreversed'} ${ch.label}`)"
      />
    </div>

    <p class="text-xs opacity-50 mt-2">
      {{ $t('RC1=Roll, RC2=Pitch, RC3=Throttle, RC4=Yaw') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useBlueOsStorage } from '@/composables/settingsSyncer'
import { useControllerStore } from '@/stores/controller'
import { Joystick } from '@/types/joystick'

const { t } = useI18n()
const controllerStore = useControllerStore()

const toggleForwarding = (): void => {
  enableDirectControl.value = !enableDirectControl.value
  localStorage.setItem('cockpit-rc-direct-control-enabled', String(enableDirectControl.value))
  controllerStore.enableForwarding = false
  controllerStore.preventJoystickForwarding = enableDirectControl.value
  logUserAction(`${enableDirectControl.value ? 'Enabled' : 'Disabled'} joystick control`)
}

/** Dropdown items for joystick selection */
const joystickItems = computed(() => {
  const items: {
    /**
     *
     */
    title: string
    /**
     *
     */
    value: number
  }[] = []
  for (const [idx, js] of controllerStore.joysticks) {
    items.push({ title: js.gamepad.id, value: idx })
  }
  if (items.length === 0) {
    items.push({ title: t('No joystick connected'), value: -1 })
  }
  return items
})

const selectedJoystickIndex = ref(
  controllerStore.joysticks.size > 0 ? controllerStore.joysticks.keys().next().value ?? -1 : -1
)

/**
 * Get the currently selected joystick, or the first available.
 * @returns {Joystick | undefined}
 */
function selectedJoystick(): Joystick | undefined {
  const idx = selectedJoystickIndex.value
  if (idx >= 0) return controllerStore.joysticks.get(idx)
  return controllerStore.joysticks.values().next().value
}

const axisOptions = computed(() => [
  { title: t('None'), value: -1 },
  { title: 'A0 (Left Y)', value: 0 },
  { title: 'A1 (Left X)', value: 1 },
  { title: 'A2 (Right Y)', value: 2 },
  { title: 'A3 (Right X)', value: 3 },
  { title: 'A4', value: 4 },
  { title: 'A5', value: 5 },
  { title: 'A6', value: 6 },
  { title: 'A7', value: 7 },
])

const CHANNEL_NAMES = ['RC1', 'RC2', 'RC3', 'RC4', 'RC5', 'RC6', 'RC7', 'RC8']
const CHANNEL_FUNCS = ['Roll', 'Pitch', 'Throttle', 'Yaw', '\u2014', '\u2014', '\u2014', '\u2014']

/** Persisted RC channel-to-axis mapping shape */
interface PersistedRcMapping {
  /** Gamepad axis index per channel (-1 = none) */
  axes: number[]
  /** Whether each channel's axis direction is reversed */
  reversed: boolean[]
}

const defaultRcMapping = (): PersistedRcMapping => ({
  axes: CHANNEL_NAMES.map(() => -1),
  reversed: CHANNEL_NAMES.map(() => false),
})

const persistedMapping = useBlueOsStorage<PersistedRcMapping>('cockpit-rc-channel-axis-mapping', defaultRcMapping())

/** RC channel row displayed in the setup UI */
interface ChannelRow {
  /** Zero-based channel index */
  id: number
  /** Channel label, e.g. "RC1" */
  label: string
  /** Human-readable function name, e.g. "Roll" */
  func: string
  /** Mapped gamepad axis index (-1 = none) */
  axis: number
  /** Whether the axis direction is reversed */
  reversed: boolean
  /** Current PWM value as a string, or em-dash when unavailable */
  pwmText: string
  /** PWM bar fill width as percentage (0-100) */
  barWidth: number
}

const channels = reactive<ChannelRow[]>(
  CHANNEL_NAMES.map((label, i) => ({
    id: i,
    label,
    func: CHANNEL_FUNCS[i],
    axis: persistedMapping.value.axes[i] ?? -1,
    reversed: persistedMapping.value.reversed[i] ?? false,
    pwmText: '\\u2014',
    barWidth: 0,
  }))
)

const saved = ref(true)

/** Flag to enable/disable direct control (mutual exclusivity) */
const enableDirectControl = ref(localStorage.getItem('cockpit-rc-direct-control-enabled') === 'true')

const saveChannels = (): void => {
  logUserAction('Saved RC channel axis mapping')
  const data = { axes: channels.map((ch) => ch.axis), reversed: channels.map((ch) => ch.reversed) }
  persistedMapping.value = data
  localStorage.setItem('cockpit-rc-channel-axis-mapping', JSON.stringify(data))
  saved.value = true
}

// Track unsaved changes
watch(
  () => channels.map((ch) => ({ axis: ch.axis, reversed: ch.reversed })),
  (newVal) => {
    const current = persistedMapping.value
    const same = newVal.every((ch, i) => ch.axis === current.axes[i] && ch.reversed === current.reversed[i])
    saved.value = same
  },
  { deep: true }
)

const onAxisChange = (ch: ChannelRow): void => {
  logUserAction(`Mapped ${ch.label} to axis ${ch.axis}`)
}

const detecting = ref(-1)
const activeDetectionTimers: ReturnType<typeof setInterval>[] = []
const activeDetectionTimeouts: ReturnType<typeof setTimeout>[] = []

const detectAxis = (ch: ChannelRow): void => {
  const js = selectedJoystick()
  if (!js?.gamepad) return
  logUserAction(`Started axis detection for ${ch.label}`)
  const axes = js.gamepad.axes
  detecting.value = ch.id

  // Record current axis positions as baseline, then monitor for movement
  const baseline = [...axes]
  let maxDeviation = 0
  let maxIdx = -1

  const checkInterval = setInterval(() => {
    const currentAxes = js.gamepad.axes
    for (let i = 0; i < Math.min(currentAxes.length, 8); i++) {
      const deviation = Math.abs(currentAxes[i] - (baseline[i] ?? 0))
      if (deviation > maxDeviation) {
        maxDeviation = deviation
        maxIdx = i
      }
    }
    // Stop when significant movement detected
    if (maxDeviation > 0.4) {
      clearInterval(checkInterval)
      ch.axis = maxIdx
      detecting.value = -1
      logUserAction(`Axis detection completed for ${ch.label}: axis ${maxIdx}`)
    }
  }, 50)
  activeDetectionTimers.push(checkInterval)

  // Safety timeout after 5 seconds
  const timeout = setTimeout(() => {
    clearInterval(checkInterval)
    if (maxIdx >= 0 && maxDeviation > 0.1) ch.axis = maxIdx
    detecting.value = -1
  }, 5000)
  activeDetectionTimeouts.push(timeout)
}

// Live PWM polling
let pwmPollInterval: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  pwmPollInterval = setInterval(() => {
    const js = selectedJoystick()
    if (!js?.gamepad) return
    const axes = js.gamepad.axes
    if (!axes || axes.length < 4) return

    for (const ch of channels) {
      if (ch.axis < 0 || ch.axis >= axes.length) {
        ch.pwmText = '\u2014'
        ch.barWidth = 0
        continue
      }
      let raw = axes[ch.axis] ?? 0
      if (ch.reversed) raw = -raw
      const pwm = Math.round(((raw + 1) / 2) * 1000 + 1000)
      ch.pwmText = pwm.toString()
      ch.barWidth = ((pwm - 1000) / 1000) * 100
    }
  }, 100)
})

onUnmounted(() => {
  if (pwmPollInterval) clearInterval(pwmPollInterval)
  activeDetectionTimers.forEach(clearInterval)
  activeDetectionTimeouts.forEach(clearTimeout)
})
</script>
