<template>
  <div>
    <v-tooltip :text="tooltipText" location="bottom">
      <template #activator="{ props: tooltipProps }">
        <div v-bind="tooltipProps" class="relative cursor-pointer" :class="indicatorClass" @click="openConfigMenu">
          <FontAwesomeIcon icon="fa-solid fa-gamepad" size="xl" />
          <FontAwesomeIcon
            v-if="!joystickConnected || !directControlEnabled"
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
import { computed, onMounted, onUnmounted, ref, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InteractionDialog from '@/components/InteractionDialog.vue'
import JoystickChannelSetup from '@/components/JoystickChannelSetup.vue'
import { sendMavlinkMessage } from '@/libs/communication/mavlink'
import { ConnectionManager } from '@/libs/connection/connection-manager'
import { MAVLinkType } from '@/libs/connection/m2r/messages/mavlink2rest-enum'
import { joystickManager } from '@/libs/joystick/manager'
import { type DirectUdpRcSender, createDirectUdpRcSender } from '@/libs/joystick/rc-direct-udp'
import {
  type RcChannelRange,
  applyExpo,
  buildClearRcOverrideMessage,
  getRcChannelRange,
} from '@/libs/joystick/rc-params'
import { isElectron, scale } from '@/libs/utils'
import { useControllerStore } from '@/stores/controller'
import { useMainVehicleStore } from '@/stores/mainVehicle'
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
const mainVehicleStore = useMainVehicleStore()
const { t } = useI18n()
const joystickConnected = ref(false)

/** Reactive mirror of cockpit-rc-direct-control-enabled localStorage flag */
const directControlEnabled = ref(localStorage.getItem('cockpit-rc-direct-control-enabled') === 'true')
const pollTimer = setInterval(() => {
  directControlEnabled.value = localStorage.getItem('cockpit-rc-direct-control-enabled') === 'true'
}, 500)

const pwmFromAxis = (val: number, range: RcChannelRange, expo: number): number => {
  const adjusted = applyExpo(val / 1000, expo) // val is in [-1000, 1000]
  return Math.round(scale(adjusted, -1, 1, range.min, range.max))
}
let directControlTimer: ReturnType<typeof setInterval> | undefined
let rcSender: DirectUdpRcSender | null = null
let useRcSender: (msg: any) => void = sendMavlinkMessage

/** Cached RC mapping to avoid JSON.parse on every tick */
let cachedAxes: number[] = [-1, -1, -1, -1, -1, -1, -1, -1]
let cachedReversed: boolean[] = [false, false, false, false, false, false, false, false]
/** Cached Expo factors per channel (0–100, 0 = linear) */
let cachedExpo: number[] = [0, 0, 0, 0, 0, 0, 0, 0]
/** Cached RC PWM calibration from vehicle params, refreshed periodically */
let cachedRcRanges: RcChannelRange[] = Array.from({ length: 8 }, () => getRcChannelRange(undefined, 1))
let cacheVersion = 0

const deriveVehicleHost = (): string | null => {
  const uri = ConnectionManager.mainConnection()?.uri()?.toString()
  if (!uri) return null
  const m = uri.match(/^(?:ws:\/\/|wss:\/\/|udpout:|udpin:|udpbcast:|tcpin:|tcpout:)?([^/:]+)/)
  return m?.[1] ?? null
}

/** Clear override function, assigned inside onMounted */
// eslint-disable-next-line @typescript-eslint/no-empty-function
let sendClearOverride: () => void = () => {}

onMounted(async () => {
  joystickManager.onJoystickConnectionUpdate((event) => (joystickConnected.value = event.size !== 0))
  controllerStore.enableForwarding = false

  // Open dedicated UDP socket for RC_CHANNELS_OVERRIDE (same as MissionPlanner)
  if (isElectron()) {
    const host = deriveVehicleHost()
    if (host) {
      const portStr = localStorage.getItem('cockpit-rc-udp-port') ?? '14550'
      const port = parseInt(portStr, 10) || 14550
      const sender = await createDirectUdpRcSender(host, port)
      if (sender) {
        rcSender = sender
        useRcSender = (msg: any) => {
          sender.send(msg).catch(() => undefined)
        }
      }
    }
  }

  let lastSendTime = 0
  const SEND_MIN_INTERVAL = 32 // ~30Hz max between sends
  const KEEPALIVE_INTERVAL = 250 // Keepalive if no SDL event for this long

  const buildAndSend = (axes: number[], clearAll = false): void => {
    if (axes.length < 4 && !clearAll) return

    // Refresh cached mapping if localStorage changed (checked every 2s)
    const now = Date.now()
    if (now - cacheVersion > 2000) {
      const raw = localStorage.getItem('cockpit-rc-channel-axis-mapping')
      if (raw) {
        try {
          const p = JSON.parse(raw)
          if (p?.axes) cachedAxes = p.axes.slice(0, 8)
          if (p?.reversed) cachedReversed = p.reversed.slice(0, 8)
          if (p?.expo) cachedExpo = p.expo.slice(0, 8)
        } catch {
          /* keep old cache */
        }
      }
      // Refresh RC calibration from vehicle params (if available)
      const vehicle = mainVehicleStore.mainVehicle
      if (vehicle && (vehicle as any).currentVehicleParameters) {
        const vp = (vehicle as any).currentVehicleParameters as Record<string, number>
        for (let i = 0; i < 8; i++) {
          cachedRcRanges[i] = getRcChannelRange(vp, i + 1)
        }
      }
      cacheVersion = now
    }

    if (clearAll) {
      const sysId = mainVehicleStore.mainVehicle?.systemId ?? 1
      useRcSender(buildClearRcOverrideMessage(sysId, 1) as any)
      return
    }

    const values: number[] = []
    const mapped: boolean[] = [] // tracks which channels have a valid axis mapping
    for (let i = 0; i < 8; i++) {
      const hwAxis = cachedAxes[i] ?? -1
      if (hwAxis < 0 || hwAxis >= axes.length) {
        values.push(0)
        mapped.push(false)
        continue
      }
      mapped.push(true)
      let v = axes[hwAxis] ?? 0
      if (cachedReversed[i]) v = -v
      const expoVal = cachedExpo[i] ?? 0
      const adjusted = applyExpo(v, expoVal)
      values.push(scale(adjusted, -1, 1, -1000, 1000))
    }

    const sysId = mainVehicleStore.mainVehicle?.systemId ?? 1

    const raw = (idx: number): number => {
      if (idx >= values.length) return 65535
      if (!mapped[idx]) return 65535
      return pwmFromAxis(values[idx], cachedRcRanges[idx] ?? getRcChannelRange(undefined, idx + 1), 0)
    }

    useRcSender({
      type: MAVLinkType.RC_CHANNELS_OVERRIDE,
      chan1_raw: raw(0),
      chan2_raw: raw(1),
      chan3_raw: raw(2),
      chan4_raw: raw(3),
      chan5_raw: raw(4),
      chan6_raw: raw(5),
      chan7_raw: raw(6),
      chan8_raw: raw(7),
      chan9_raw: 65535,
      chan10_raw: 65535,
      chan11_raw: 65535,
      chan12_raw: 65535,
      chan13_raw: 65535,
      chan14_raw: 65535,
      chan15_raw: 65535,
      chan16_raw: 65535,
      chan17_raw: 65535,
      chan18_raw: 65535,
      target_system: sysId,
      target_component: 1,
    } as any)
  }

  /**
   * Send zero-value RC_CHANNELS_OVERRIDE messages to clear all overrides
   * (like MissionPlanner's clearRCOverride). Sends 4 bursts to ensure delivery.
   */
  const sendClearOverrideInner = (): void => {
    for (let i = 0; i < 4; i++) {
      setTimeout(() => buildAndSend([], true), i * 25)
    }
  }
  sendClearOverride = sendClearOverrideInner

  // Send immediately on every SDL state update (throttled to ~30Hz)
  let latestAxes: number[] = []
  joystickManager.onJoystickStateUpdate((event) => {
    latestAxes = [...event.gamepad.axes]
    const now = Date.now()
    if (now - lastSendTime < SEND_MIN_INTERVAL) return
    if (!directControlEnabled.value) return
    lastSendTime = now
    buildAndSend(latestAxes)
  })

  // Keepalive: resend current position so ArduPilot's RC override timeout doesn't expire
  directControlTimer = setInterval(() => {
    if (!directControlEnabled.value) return
    const now = Date.now()
    if (now - lastSendTime < KEEPALIVE_INTERVAL) return
    lastSendTime = now
    buildAndSend(latestAxes)
  }, 100)
})

/** When disabling, send clear override bursts like MissionPlanner's clearRCOverride */
const watchDisable = watch(directControlEnabled, (enabled) => {
  if (!enabled) sendClearOverride()
})

onUnmounted(() => {
  sendClearOverride()
  setTimeout(() => {
    watchDisable()
    clearInterval(pollTimer)
    if (directControlTimer) clearInterval(directControlTimer)
    rcSender?.close()
  }, 150) // wait for clear bursts to finish
})

const openConfigMenu = (): void => {
  logUserAction('Opened the joystick RC channel setup menu')
  widgetStore.miniWidgetManagerVars(miniWidget.value.hash).configMenuOpen = true
}

const indicatorClass = computed(() => {
  if (!joystickConnected.value) return 'text-gray-700'
  if (!directControlEnabled.value) return 'text-yellow-500'
  return 'text-slate-50'
})

const tooltipText = computed(() => {
  if (!joystickConnected.value) return t('Joystick disconnected')
  if (!directControlEnabled.value) return t('Connected but disabled')
  return t('Connected and enabled')
})
</script>
