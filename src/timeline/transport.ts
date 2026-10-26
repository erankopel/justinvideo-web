import type { Span } from '../engine'

export const frameIndexOf = (timeMs: number, fps: number): number => Math.round((timeMs * fps) / 1000)

export const frameStartMs = (index: number, fps: number): number => Math.round((index * 1000) / fps)

/** The times of the cuts: where each clip starts, and where the edit ends. */
export function cutEdges(spans: readonly Span[], durationMs: number): number[] {
  return [...new Set([...spans.map((span) => span.startMs), durationMs])]
}

export const previousCut = (edges: readonly number[], playheadMs: number): number => {
  let found = 0
  for (const edge of edges) if (edge < playheadMs) found = edge
  return found
}

export const nextCut = (edges: readonly number[], playheadMs: number, durationMs: number): number =>
  edges.find((edge) => edge > playheadMs) ?? durationMs

/** The time of the frame delta frames from the one nearest playheadMs, kept inside the edit. */
export const steppedFrame = (playheadMs: number, fps: number, delta: number, durationMs: number): number =>
  Math.min(Math.max(frameStartMs(frameIndexOf(playheadMs, fps) + delta, fps), 0), durationMs)
