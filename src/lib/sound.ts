/**
 * The sounds the panel can make, and the machinery for making them.
 *
 * Every one is synthesised from a handful of numbers rather than shipped as a
 * file: they weigh nothing, they can be read and changed in a diff, and a
 * notification sound is a few hundred milliseconds of sine wave whichever way
 * it is produced. The same definitions are played by the offscreen document
 * when a notification arrives and by the settings page when the reader is
 * choosing between them, so what is heard while choosing is what will arrive.
 */
export type SoundName = 'chime' | 'ping' | 'bell' | 'knock' | 'marimba' | 'none'

interface Note {
  /** Pitch in hertz. */
  hz: number
  /** When it starts, in seconds from the beginning of the sound. */
  at: number
  /** How long it rings for, in seconds. */
  length: number
  type?: OscillatorType
  /** Relative loudness within the sound, before the reader's own volume. */
  level?: number
}

export interface Sound {
  label: string
  /** What it is for, said in the way the reader would describe it. */
  description: string
  notes: Note[]
}

export const SOUNDS: Record<SoundName, Sound> = {
  chime: {
    label: 'Chime',
    description: 'Two rising notes',
    notes: [
      { hz: 880, at: 0, length: 0.12 },
      { hz: 1318.5, at: 0.12, length: 0.16 },
    ],
  },
  ping: {
    label: 'Ping',
    description: 'One soft note',
    notes: [{ hz: 740, at: 0, length: 0.12, level: 0.6 }],
  },
  bell: {
    label: 'Bell',
    description: 'One note, ringing on',
    notes: [
      { hz: 1046.5, at: 0, length: 0.7 },
      { hz: 1568, at: 0, length: 0.5, level: 0.35 },
    ],
  },
  knock: {
    label: 'Knock',
    description: 'Two low taps',
    notes: [
      { hz: 196, at: 0, length: 0.07, type: 'triangle' },
      { hz: 196, at: 0.11, length: 0.07, type: 'triangle' },
    ],
  },
  marimba: {
    label: 'Marimba',
    description: 'Three notes, climbing',
    notes: [
      { hz: 587.3, at: 0, length: 0.09, type: 'triangle' },
      { hz: 880, at: 0.08, length: 0.09, type: 'triangle' },
      { hz: 1174.7, at: 0.16, length: 0.18, type: 'triangle' },
    ],
  },
  none: {
    label: 'Silent',
    description: 'Nothing at all',
    notes: [],
  },
}

export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[]

/** Loud enough to hear across a desk, quiet enough not to be resented. */
const FULL_GAIN = 0.12

export function isSoundName(value: unknown): value is SoundName {
  return typeof value === 'string' && value in SOUNDS
}

/**
 * Plays one of them. The caller owns the audio context, because a context per
 * sound is both slow and limited — the offscreen document keeps one for the
 * life of the browser, and the settings page for the life of the page.
 *
 * Every note is faded in and out. A square-edged note clicks at both ends,
 * which is the difference between a chime and a fault.
 */
export function playSound(
  context: AudioContext,
  name: SoundName,
  volume = 1,
): void {
  const sound = SOUNDS[name]
  const level = Math.max(0, Math.min(1, volume)) * FULL_GAIN
  if (!sound || sound.notes.length === 0 || level === 0) return

  const begin = context.currentTime + 0.01

  for (const note of sound.notes) {
    const start = begin + note.at
    const end = start + note.length
    const peak = level * (note.level ?? 1)

    const oscillator = context.createOscillator()
    oscillator.type = note.type ?? 'sine'
    oscillator.frequency.value = note.hz

    const envelope = context.createGain()
    envelope.gain.setValueAtTime(0, start)
    envelope.gain.linearRampToValueAtTime(peak, start + 0.015)
    envelope.gain.exponentialRampToValueAtTime(0.0001, end)

    oscillator.connect(envelope).connect(context.destination)
    oscillator.start(start)
    oscillator.stop(end + 0.02)
  }
}
