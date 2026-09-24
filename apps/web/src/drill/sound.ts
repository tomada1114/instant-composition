/** The part of `AudioContext` the three tones use, so a test can stand in for it. */
interface Param {
  value: number;
  setValueAtTime(value: number, at: number): unknown;
  linearRampToValueAtTime(value: number, at: number): unknown;
  exponentialRampToValueAtTime(value: number, at: number): unknown;
}

interface Node {
  connect(node: unknown): unknown;
}

export interface ToneContext {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: object;
  resume(): Promise<void>;
  createGain(): Node & { readonly gain: Param };
  createOscillator(): Node & {
    type: string;
    readonly frequency: Param;
    start(at: number): void;
    stop(at: number): void;
  };
}

export type SoundName = "ok" | "okFast" | "combo" | "closing";

/** Frequency in Hz and length in seconds of each note, played back to back. */
const NOTES: Readonly<Record<SoundName, readonly (readonly [number, number])[]>> = {
  ok: [[880, 0.08]],
  okFast: [[987.77, 0.08]],
  combo: [[1318.51, 0.1]],
  closing: [
    [659.25, 0.2],
    [783.99, 0.2],
    [1046.5, 0.2],
  ],
};

const PEAK_GAIN = 0.15;
const ATTACK_SECONDS = 0.005;

export interface SoundPlayer {
  /** Creates or resumes the audio context; call it from a user gesture. */
  unlock(): void;
  play(name: SoundName): void;
}

/**
 * Short single electronic tones synthesised with an oscillator: no audio
 * files. Browsers block audio until a gesture, so nothing plays before
 * {@link SoundPlayer.unlock}.
 */
export function createSoundPlayer(create: () => ToneContext | undefined): SoundPlayer {
  let context: ToneContext | undefined;
  let unlocked = false;

  function tone(
    ctx: ToneContext,
    frequency: number,
    start: number,
    length: number,
  ): void {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, start + ATTACK_SECONDS);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + length);
  }

  return {
    unlock() {
      if (!unlocked) {
        unlocked = true;
        context = create();
      }
      if (context?.state === "suspended") void context.resume();
    },
    play(name) {
      if (context === undefined) return;
      let at = context.currentTime;
      for (const [frequency, length] of NOTES[name]) {
        tone(context, frequency, at, length);
        at += length;
      }
    },
  };
}

/** The page's one player: the context is created on the first unlock and kept across rounds. */
export const browserSound: SoundPlayer = createSoundPlayer(() =>
  typeof AudioContext === "undefined" ? undefined : new AudioContext(),
);
