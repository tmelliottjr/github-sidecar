/**
 * Making the notification sound, which is a different job in each browser
 * because each gives its background a different amount of the DOM.
 *
 * Chrome's background is a service worker, which cannot play audio at all, so
 * the sound is made in an offscreen document borrowed for the purpose. Firefox
 * runs a background *page*, which has an `AudioContext` of its own and needs
 * nothing borrowed. Safari has a service worker and no offscreen documents, and
 * no notifications API to raise a sound alongside — so on Safari there is
 * nothing here to do, and settings says as much rather than offering a choice
 * of sounds that would never be heard.
 */
import { browser, can } from '@/lib/browser'
import { playSound, type SoundName } from '@/lib/sound'

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

/** Kept between sounds: a context per note is slow, and there is a limit. */
let context: AudioContext | null = null

/**
 * Firefox, where the background page can simply make the sound itself.
 *
 * `resume()` is asked for but never awaited. A context the browser will not
 * let start does not reject — it holds the promise open until a gesture that
 * will never come in a background page, so awaiting it would wait for ever and
 * take the notification down with it. The notes are scheduled either way: if
 * the context is running they play, and if the reader has told Firefox to
 * block audio they do not, which is what they asked for. The notification
 * still arrives.
 */
function playHere(name: SoundName, volume: number): void {
  try {
    context ??= new AudioContext()
    void context.resume().catch(() => undefined)
    playSound(context, name, volume)
  } catch {
    // A refused audio context is not worth taking the notification down for.
  }
}

/** Plays one of the panel's sounds, however this browser allows it. */
export async function playNotificationSound(
  name: SoundName,
  volume: number,
): Promise<void> {
  if (can.offscreenAudio) return playOffscreen(name, volume)
  if (can.backgroundAudio) playHere(name, volume)
}
