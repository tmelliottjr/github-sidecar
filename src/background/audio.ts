/**
 * Plays the panel's notification sound. Only Chrome uses it, because Chrome
 * notifications make no sound on macOS. Chrome's background is a service
 * worker, which cannot play audio, so the sound plays in an offscreen
 * document. Firefox notifications play the system sound, and Safari has no
 * notifications.
 */
import { browser, can } from '@/lib/browser'
import type { SoundName } from '@/lib/sound'

const OFFSCREEN_PAGE = 'offscreen.html'

/**
 * Chrome. `hasDocument` arrived after the API itself, so it is asked for
 * rather than relied on; creating a second document simply fails, which is the
 * same answer by another route. Two notifications at once race here, and the
 * loser's failure means the winner already did the work.
 */
async function playOffscreen(name: SoundName, volume: number): Promise<void> {
  const exists = browser.offscreen.hasDocument ? await browser.offscreen.hasDocument() : false
  if (!exists) {
    await browser.offscreen
      .createDocument({
        url: OFFSCREEN_PAGE,
        reasons: [browser.offscreen.Reason.AUDIO_PLAYBACK],
        justification: 'Plays a short sound with the notifications the reader asked for.',
      })
      .catch(() => undefined)
  }

  await browser.runtime
    .sendMessage({ type: 'play-sound', name, volume })
    .catch(() => undefined)
}

/** Plays one of the panel's sounds, on browsers where the panel makes the sound. */
export async function playNotificationSound(
  name: SoundName,
  volume: number,
): Promise<void> {
  if (can.offscreenAudio) await playOffscreen(name, volume)
}
