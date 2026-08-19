/**
 * Dedicated direct-UDP sender for RC_CHANNELS_OVERRIDE.
 *
 * Opens a standalone udpout link (MAVLink binary over UDP) that bypasses the main
 * connection stack entirely — same transport as MissionPlanner's RC override.
 * Only available in Electron; callers must guard with isElectron() before use.
 */
import type { Message as MavMessage, Package } from '@/libs/connection/m2r/messages/mavlink2rest'
import { MavComponent } from '@/libs/connection/m2r/messages/mavlink2rest-enum'

/** Created by {@link createDirectUdpRcSender}. */
export interface DirectUdpRcSender {
  /** Send one MAVLink message over the dedicated UDP socket. */
  send: (message: MavMessage) => Promise<void>
  /** Close the dedicated UDP socket. Safe to call even if already closed. */
  close: () => Promise<void>
}

let rest2mavlinkFn: ((json: string) => Uint8Array) | null = null
let initPromise: Promise<void> | null = null
let linkOpen = false
let linkPath = ''

/**
 * Lazy-initialize the mavlink2rest-wasm module and cache the `rest2mavlink` converter.
 * @returns {Promise<void>}
 */
const ensureWasm = async (): Promise<void> => {
  if (rest2mavlinkFn) return
  if (!initPromise) {
    initPromise = (async () => {
      const [m2rModule, wasmUrlModule] = await Promise.all([
        import('mavlink2rest-wasm'),
        // @ts-ignore: Vite asset URL
        import('mavlink2rest-wasm/mavlink2rest_wasm_bg.wasm?url'),
      ])
      await m2rModule.default(wasmUrlModule.default)
      const emitter = new m2rModule.ParserEmitter()
      rest2mavlinkFn = (json: string): Uint8Array => emitter.rest2mavlink(json) as Uint8Array
    })()
  }
  await initPromise
}

/**
 * Create a dedicated UDP sender for RC_CHANNELS_OVERRIDE messages, bypassing
 * the main WebSocket/MAVLink2Rest pipeline. Uses the same MAVLink binary → UDP
 * path as MissionPlanner.
 *
 * Only works in Electron. Returns `null` if the environment does not support
 * direct UDP (browser, or Electron without the link API).
 * @param {string} host  Vehicle IP address (e.g. "192.168.2.1").
 * @param {number} port  Vehicle MAVLink UDP port (default 14550).
 * @returns {Promise<DirectUdpRcSender | null>}
 */
export const createDirectUdpRcSender = async (host: string, port = 14550): Promise<DirectUdpRcSender | null> => {
  if (!window.electronAPI?.linkOpen) return null

  const uri = `udpout:${host}:${port}`
  try {
    await window.electronAPI.linkOpen(uri)
    linkOpen = true
    linkPath = uri
  } catch {
    console.warn('[rc-direct-udp] Failed to open dedicated RC UDP link at %s', uri)
    return null
  }

  await ensureWasm()
  if (!rest2mavlinkFn) {
    await window.electronAPI.linkClose(linkPath)
    linkOpen = false
    return null
  }

  const send = async (message: MavMessage): Promise<void> => {
    if (!linkOpen || !rest2mavlinkFn) return
    const pack: Package = {
      header: { system_id: 255, component_id: Number(MavComponent.MAV_COMP_ID_UDP_BRIDGE), sequence: 0 },
      message,
    }
    try {
      const binary = rest2mavlinkFn(JSON.stringify(pack))
      await window.electronAPI!.linkWrite(linkPath, binary)
    } catch {
      // Drop silently on send failure — RC loop runs at 25 Hz
    }
  }

  const close = async (): Promise<void> => {
    if (!linkOpen) return
    linkOpen = false
    try {
      await window.electronAPI!.linkClose(linkPath)
    } catch {
      /* already closed */
    }
  }

  return { send, close }
}
