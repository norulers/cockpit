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
import { computed, onMounted, onUnmounted, ref, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'

import InteractionDialog from '@/components/InteractionDialog.vue'
import JoystickChannelSetup from '@/components/JoystickChannelSetup.vue'
import { sendMavlinkMessage, sendMavlinkMessageViaHttp } from '@/libs/communication/mavlink'
import * as Connection from '@/libs/connection/connection'
import { ConnectionManager } from '@/libs/connection/connection-manager'
import { MAVLinkType } from '@/libs/connection/m2r/messages/mavlink2rest-enum'
import { joystickManager } from '@/libs/joystick/manager'
import { type DirectUdpRcSender, createDirectUdpRcSender } from '@/libs/joystick/rc-direct-udp'
import { isElectron, round, scale } from '@/libs/utils'
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

/** Reactive mirror of cockpit-rc-direct-control-enabled localStorage flag */
const directControlEnabled = ref(localStorage.getItem('cockpit-rc-direct-control-enabled') === 'true')
const pollTimer = setInterval(() => {
  directControlEnabled.value = localStorage.getItem('cockpit-rc-direct-control-enabled') === 'true'
}, 500)

const pwmFromAxis = (val: number): number => round(scale(val, -1000, 1000, 1000, 2000))
let directControlTimer: ReturnType<typeof setInterval> | undefined
let rcSender: DirectUdpRcSender | null = null
let useRcSender: (msg: any) => void = sendMavlinkMessageViaHttp

/** Cached RC mapping to avoid JSON.parse on every tick */
let cachedAxes: number[] = [0, 1, 2, 3]
let cachedReversed: boolean[] = [false, false, false, false]
let cacheVersion = 0

const deriveVehicleHost = (): string | null => {
  const uri = ConnectionManager.mainConnection()?.uri()?.toString()
  if (!uri) return null
  // ws://192.168.2.1:6040/... → 192.168.2.1
  // udpout:192.168.2.1:14550 → 192.168.2.1
  const m = uri.match(/^(?:ws:\/\/|wss:\/\/|udpout:|udpin:|udpbcast:|tcpin:|tcpout:)?([^/:]+)/)
  return m?.[1] ?? null
}

const setupRcSender = async (): Promise<void> => {
  if (!isElectron()) return

  // If the main connection is already a direct link (UDP/TCP/Serial),
  // sendMavlinkMessage goes through rest2mavlink → UDP — no need for a second socket.
  const conn = ConnectionManager.mainConnection()
  if (conn) {
    const connType = conn.uri().type()
    if (
      connType === Connection.Type.UdpIn ||
      connType === Connection.Type.UdpOut ||
      connType === Connection.Type.UdpBroadcast ||
      connType === Connection.Type.TcpIn ||
      connType === Connection.Type.TcpOut ||
      connType === Connection.Type.Serial
    ) {
      useRcSender = sendMavlinkMessage
      return
    }
  }

  const host = deriveVehicleHost()
  if (!host) return

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

onMounted(async () => {
  joystickManager.onJoystickConnectionUpdate((event) => (joystickConnected.value = event.size !== 0))
  controllerStore.enableForwarding = false

  await setupRcSender()

  let lastSendTime = 0
  const SEND_MIN_INTERVAL = 32 // ~30Hz max between sends
  const KEEPALIVE_INTERVAL = 250 // Keepalive if no SDL event for this long

  const buildAndSend = (axes: number[]): void => {
    if (axes.length < 4) return

    // Refresh cached mapping if localStorage changed (checked every 2s)
    const now = Date.now()
    if (now - cacheVersion > 2000) {
      const raw = localStorage.getItem('cockpit-rc-channel-axis-mapping')
      if (raw) {
        try {
          const p = JSON.parse(raw)
          if (p?.axes) cachedAxes = p.axes
          if (p?.reversed) cachedReversed = p.reversed
        } catch {
          /* keep old cache */
        }
      }
      cacheVersion = now
    }

    const values: number[] = [0, 0, 0, 0]
    for (let i = 0; i < 4; i++) {
      const hwAxis = cachedAxes[i] ?? i
      if (hwAxis < 0 || hwAxis >= axes.length) continue
      let v = axes[hwAxis] ?? 0
      if (cachedReversed[i]) v = -v
      values[i] = scale(v, -1, 1, -1000, 1000)
    }
    const [x, y, z, r] = values

    useRcSender({
      type: MAVLinkType.RC_CHANNELS_OVERRIDE,
      chan1_raw: pwmFromAxis(x),
      chan2_raw: pwmFromAxis(-y),
      chan3_raw: pwmFromAxis(z),
      chan4_raw: pwmFromAxis(r),
      chan5_raw: 65535,
      chan6_raw: 65535,
      chan7_raw: 65535,
      chan8_raw: 65535,
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
      target_system: 1,
      target_component: 1,
    } as any)
  }

  // Send immediately on every SDL state update (throttled to ~30Hz)
  let latestAxes: number[] = [0, 0, 0, 0]
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

onUnmounted(() => {
  clearInterval(pollTimer)
  if (directControlTimer) clearInterval(directControlTimer)
  rcSender?.close()
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
