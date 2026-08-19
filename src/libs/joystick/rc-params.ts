/**
 * RC channel calibration and Expo curve utilities (MissionPlanner-compatible).
 */

import { scale } from '@/libs/utils'

/**
 * RC channel PWM calibration range for a single channel.
 */
export interface RcChannelRange {
  /**
   *
   */
  min: number
  /**
   *
   */
  max: number
  /**
   *
   */
  trim: number
}

/** Default PWM range when vehicle params are unavailable */
const DEFAULT_RC_RANGE: RcChannelRange = { min: 1000, max: 2000, trim: 1500 }

/**
 * Read RCn_MIN / RCn_MAX / RCn_TRIM from a vehicle parameters object.
 * Falls back to the standard 1000–2000 range when the key is missing.
 * @param {Record<string, number> | undefined} params  Vehicle parameter key→value map.
 * @param {number} channel  RC channel number (1-indexed, 1–18).
 * @returns {RcChannelRange}
 */
export const getRcChannelRange = (params: Record<string, number> | undefined, channel: number): RcChannelRange => {
  if (!params) return DEFAULT_RC_RANGE
  const minKey = `RC${channel}_MIN`
  const maxKey = `RC${channel}_MAX`
  const trimKey = `RC${channel}_TRIM`
  const min = params[minKey] !== undefined ? params[minKey] : DEFAULT_RC_RANGE.min
  const max = params[maxKey] !== undefined ? params[maxKey] : DEFAULT_RC_RANGE.max
  const trim = params[trimKey] !== undefined ? params[trimKey] : (min + max) / 2
  return { min, max, trim }
}

/**
 * Apply exponential curve to a normalized axis value (like MissionPlanner).
 * Expo factor range: 0 (linear) to 100 (full curve).
 *
 * Uses a cubic Expo formula that preserves endpoints:
 *   f(x) = x³·k + x·(1−k)   where k = expo / 100
 *
 * This gives a smooth transition from linear (k=0) to heavy expo (k=1).
 * @param {number} value  Normalized axis value (-1 to 1).
 * @param {number} expo   Expo factor (0 = linear, 100 = maximum curve).
 * @returns {number}  Expo-adjusted value, still in [-1, 1].
 */
export const applyExpo = (value: number, expo: number): number => {
  if (expo <= 0) return value
  const k = Math.min(expo, 100) / 100
  const abs = Math.abs(value)
  const sign = value < 0 ? -1 : 1
  return sign * (abs * abs * abs * k + abs * (1 - k))
}

/**
 * Convert a normalized axis value (-1 to 1) to PWM using the channel's
 * calibrated range and optional Expo curve.
 * @param {number} value       Normalized axis value (-1 to 1).
 * @param {RcChannelRange} range  PWM calibration range for the channel.
 * @param {number} expo        Expo factor (0–100, 0 = linear).
 * @returns {number}  PWM value clamped to [min, max].
 */
export const axisToPwm = (value: number, range: RcChannelRange, expo: number): number => {
  const adjusted = applyExpo(value, expo)
  const pwm = Math.round(scale(adjusted, -1, 1, range.min, range.max))
  return Math.max(range.min, Math.min(range.max, pwm))
}

/**
 * Convert a MANUAL_CONTROL-style axis value (-1000 to 1000) to PWM.
 * @param {number} axisValue   MANUAL_CONTROL axis value (-1000 to 1000).
 * @param {RcChannelRange} range  PWM calibration range.
 * @param {number} expo        Expo factor (0–100).
 * @param {boolean} reversed   Whether the axis direction is reversed.
 * @returns {number}  PWM value.
 */
export const manualAxisToPwm = (axisValue: number, range: RcChannelRange, expo: number, reversed: boolean): number => {
  const normalized = scale(reversed ? -axisValue : axisValue, -1000, 1000, -1, 1)
  return axisToPwm(normalized, range, expo)
}

/**
 * Build a zero-value RC_CHANNELS_OVERRIDE message to clear all overrides.
 * @param {number} targetSystem  Vehicle system ID.
 * @param {number} targetComponent  Vehicle component ID.
 * @returns {Record<string, unknown>}  MAVLink2Rest JSON message object.
 */
export const buildClearRcOverrideMessage = (targetSystem: number, targetComponent: number): Record<string, unknown> => {
  const msg: Record<string, number | string> = {
    type: 'RC_CHANNELS_OVERRIDE',
    target_system: targetSystem,
    target_component: targetComponent,
  }
  for (let i = 1; i <= 18; i++) {
    msg[`chan${i}_raw`] = 0
  }
  return msg
}
