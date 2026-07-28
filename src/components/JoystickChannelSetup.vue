<template>
  <div>
    <v-switch
      :model-value="controllerStore.enableForwarding"
      hide-details
      :label="controllerStore.enableForwarding ? $t('Commands enabled') : $t('Commands paused')"
      color="white"
      class="mb-3"
      @update:model-value="setForwarding"
    />

    <div class="text-xs opacity-70 mb-2">
      {{ detecting >= 0 ? $t('Move the axis you want to assign...') : $t('Click Detect and move an axis to map each channel.') }}
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

      <v-btn
        size="x-small"
        variant="outlined"
        class="text-xs"
        @click="detectAxis(ch)"
      >
        {{ $t('Detect') }}
      </v-btn>

      <div class="flex-1 h-4 bg-[#FFFFFF11] rounded relative overflow-hidden">
        <div
          class="absolute h-full bg-green-600 rounded transition-all"
          :style="{ width: ch.barWidth + '%' }"
        />
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
      />
    </div>

    <p class="text-xs opacity-50 mt-2">
      {{ $t('RC1=Roll, RC2=Pitch, RC3=Throttle, RC4=Yaw') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useControllerStore } from '@/stores/controller'

const { t } = useI18n()
const controllerStore = useControllerStore()

const setForwarding = (v: boolean | null): void => {
  controllerStore.enableForwarding = Boolean(v)
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
]

const CHANNEL_NAMES = ['RC1', 'RC2', 'RC3', 'RC4', 'RC5', 'RC6', 'RC7', 'RC8']
const CHANNEL_FUNCS = ['Roll', 'Pitch', 'Throttle', 'Yaw', '—', '—', '—', '—']

interface ChannelRow {
  id: number
  label: string
  func: string
  axis: number
  reversed: boolean
  pwmText: string
  barWidth: number
}

const channels = reactive<ChannelRow[]>(
  CHANNEL_NAMES.map((label, i) => ({
    id: i,
    label,
    func: CHANNEL_FUNCS[i],
    axis: -1, // All default to None — user must click Detect
    reversed: false,
    pwmText: '—',
    barWidth: 0,
  }))
)

const onAxisChange = (ch: ChannelRow): void => {
  console.log(`Channel ${ch.label} mapped to axis ${ch.axis}`)
}

const detecting = ref(-1)

const detectAxis = (ch: ChannelRow): void => {
  const js = controllerStore.joysticks.values().next().value
  if (!js?.gamepad) return
  const axes = js.gamepad.axes
  detecting.value = ch.id

  // Record current axis positions as baseline, then monitor for 3 seconds
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
    // Stop when significant movement detected, or timeout after 5s
    if (maxDeviation > 0.4) {
      clearInterval(checkInterval)
      ch.axis = maxIdx
      detecting.value = -1
    }
  }, 50)

  // Safety timeout after 5 seconds
  setTimeout(() => {
    clearInterval(checkInterval)
    if (maxIdx >= 0 && maxDeviation > 0.1) ch.axis = maxIdx
    detecting.value = -1
  }, 5000)
}

// Live PWM polling
let intervalId: ReturnType<typeof setInterval> | undefined
intervalId = setInterval(() => {
  const js = controllerStore.joysticks.values().next().value
  if (!js?.gamepad) return
  const axes = js.gamepad.axes
  if (!axes || axes.length < 4) return

  for (const ch of channels) {
    if (ch.axis < 0 || ch.axis >= axes.length) {
      ch.pwmText = '—'
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

onUnmounted(() => { if (intervalId) clearInterval(intervalId) })
</script>
