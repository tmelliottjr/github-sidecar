/**
 * Plays the panel's notification sound, in an offscreen document because a
 * service worker cannot play audio at all.
 *
 * This document knows nothing about reminders, changes or settings: the worker
 * has read those already and asks for a named sound at a volume. That keeps
 * the one piece of the extension that has to be a whole HTML page as small as
 * a page can be.
 */
import { browser } from '@/lib/browser'
import { isSoundName, playSound, type SoundName } from '@/lib/sound'

interface PlayMessage {
  type: 'play-sound'
  name: SoundName
  volume: number
}

/** Kept between sounds: a context per note is slow, and there is a limit. */
let context: AudioContext | null = null

browser.runtime.onMessage.addListener((message: PlayMessage, _sender, sendResponse) => {
  if (message?.type !== 'play-sound') return false

  try {
    if (isSoundName(message.name)) {
      context ??= new AudioContext()
      void context.resume().catch(() => undefined)
      playSound(context, message.name, message.volume)
    }
  } catch {
    // A refused audio context is not worth taking the notification down for.
  }

  sendResponse({ ok: true, data: undefined })
  return false
})
