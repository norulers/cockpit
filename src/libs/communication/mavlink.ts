import { ConnectionManager } from '@/libs/connection/connection-manager'
import type { Message as MavMessage, Package } from '@/libs/connection/m2r/messages/mavlink2rest'

import { MavComponent, MAVLinkType } from '../connection/m2r/messages/mavlink2rest-enum'
import { type Message } from '../connection/m2r/messages/mavlink2rest-message'
import { MavlinkManualControlState } from '../joystick/protocols/mavlink-manual-control'

let lastTimeLoggedConnectionError = new Date(0)
let lastTimeLoggedHttpError = new Date(0)
let cachedRestUrl: string | null = null
let cachedRestUrlExpiry = 0

const buildRestUrl = (): string | null => {
  const now = Date.now()
  if (cachedRestUrl && now < cachedRestUrlExpiry) return cachedRestUrl
  const uri = ConnectionManager.mainConnection()?.uri()
  if (!uri) return null
  const wsUrl = uri.toString()
  const match = wsUrl.match(/^(wss?):\/\/([^/:]+):(\d+)/)
  if (!match) return null
  const restUrl = `http://${match[2]}:${match[3]}/mavlink2rest/v1/mavlink`
  cachedRestUrl = restUrl
  cachedRestUrlExpiry = now + 10_000 // Cache for 10s
  return restUrl
}

/**
 * Send a mavlink message
 * @param {MavMessage} message
 */
export const sendMavlinkMessage = (message: MavMessage): void => {
  const pack: Package = {
    header: {
      system_id: 255, // GCS system ID
      component_id: Number(MavComponent.MAV_COMP_ID_UDP_BRIDGE), // Used by historical reasons (Check QGC)
      sequence: 0,
    },
    message: message,
  }
  const textEncoder = new TextEncoder()
  try {
    ConnectionManager.write(textEncoder.encode(JSON.stringify(pack)))
  } catch (error) {
    // Don't log the error if it's too frequent
    if (Date.now() < lastTimeLoggedConnectionError.getTime() + 10000) return
    console.error('Error sending MAVLink message:', error)
    lastTimeLoggedConnectionError = new Date()
  }
}

/**
 * Send a mavlink message via the MAVLink2Rest HTTP REST API.
 * Bypasses WebSocket buffering for time-sensitive messages (e.g. RC override).
 * @param {MavMessage} message
 * @returns {Promise<void>}
 */
export const sendMavlinkMessageViaHttp = async (message: MavMessage): Promise<void> => {
  const restUrl = buildRestUrl()
  if (!restUrl) {
    sendMavlinkMessage(message) // fallback
    return
  }

  const pack: Package = {
    header: {
      system_id: 255,
      component_id: Number(MavComponent.MAV_COMP_ID_UDP_BRIDGE),
      sequence: 0,
    },
    message: message,
  }

  try {
    await fetch(restUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pack),
    })
  } catch (error) {
    // Don't log if too frequent; fall back to WebSocket
    if (Date.now() < lastTimeLoggedHttpError.getTime() + 10000) {
      sendMavlinkMessage(message)
      return
    }
    console.error('Error sending MAVLink message via HTTP, falling back to WebSocket:', error)
    lastTimeLoggedHttpError = new Date()
    sendMavlinkMessage(message)
  }
}

/**
 * Send manual control
 * @param {'MavlinkManualControlState'} controllerState Current state of the controller
 * @param {number} targetId
 */
export const sendManualControl = (controllerState: MavlinkManualControlState, targetId: number): void => {
  const state = controllerState as MavlinkManualControlState
  const manualControlMessage: Message.ManualControl = {
    type: MAVLinkType.MANUAL_CONTROL,
    x: state.x,
    y: state.y,
    z: state.z,
    r: state.r,
    s: state.s,
    t: state.t,
    buttons: state.buttons,
    buttons2: state.buttons2,
    target: targetId,
  }
  sendMavlinkMessage(manualControlMessage)
}
