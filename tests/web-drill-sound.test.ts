import { describe, expect, it } from "vitest";

import {
  browserSound,
  createSoundPlayer,
  roundSound,
  type ToneContext,
} from "@instant-composition/web";

interface Scheduled {
  readonly frequency: number;
  readonly start: number;
  readonly stop: number;
}

/** A stand-in for `AudioContext` that records the tones scheduled on it. */
function fakeContext(state: ToneContext["state"] = "suspended") {
  const tones: Scheduled[] = [];
  let resumed = 0;
  const param = () => ({
    value: 0,
    setValueAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
    exponentialRampToValueAtTime: () => undefined,
  });
  const context: ToneContext & { state: ToneContext["state"] } = {
    state,
    currentTime: 10,
    destination: {},
    resume: () => {
      resumed += 1;
      context.state = "running";
      return Promise.resolve();
    },
    createGain: () => ({ gain: param(), connect: (node) => node }),
    createOscillator: () => {
      const frequency = param();
      let start = 0;
      return {
        type: "sine",
        frequency,
        connect: (node) => node,
        start: (at: number) => {
          start = at;
        },
        stop: (at: number) => {
          tones.push({ frequency: frequency.value, start, stop: at });
        },
      };
    },
  };
  return { context, tones, resumed: () => resumed };
}

describe("createSoundPlayer", () => {
  it("stays silent until a gesture unlocks audio", () => {
    const fake = fakeContext();
    let created = 0;
    const player = createSoundPlayer(() => {
      created += 1;
      return fake.context;
    });
    player.play("ok");
    expect(created).toBe(0);
    expect(fake.tones).toStrictEqual([]);

    player.unlock();
    player.unlock();
    expect(created).toBe(1);
    expect(fake.resumed()).toBe(1);
  });

  it("resumes a context iOS left interrupted on the next unlock", () => {
    const fake = fakeContext("running");
    const player = createSoundPlayer(() => fake.context);
    player.unlock();
    expect(fake.resumed()).toBe(0);

    fake.context.state = "interrupted";
    player.unlock();
    expect(fake.resumed()).toBe(1);
    expect(fake.context.state).toBe("running");
  });

  it("does not resume a context that is already running", () => {
    const fake = fakeContext("running");
    const player = createSoundPlayer(() => fake.context);
    player.unlock();
    player.unlock();
    expect(fake.resumed()).toBe(0);
  });

  it("plays one short tone for ○, a step higher when fast", () => {
    const fake = fakeContext("running");
    const player = createSoundPlayer(() => fake.context);
    player.unlock();
    player.play("ok");
    player.play("okFast");
    const [ok, fast] = fake.tones;
    expect(fake.tones).toHaveLength(2);
    expect(ok && fast && fast.frequency > ok.frequency).toBe(true);
    expect(ok && ok.stop - ok.start).toBeCloseTo(0.08);
  });

  it("plays a longer tone for the combo, and a three-note close of about 600 ms", () => {
    const fake = fakeContext("running");
    const player = createSoundPlayer(() => fake.context);
    player.unlock();
    player.play("combo");
    expect(fake.tones[0] && fake.tones[0].stop - fake.tones[0].start).toBeCloseTo(0.1);

    player.play("closing");
    const closing = fake.tones.slice(1);
    expect(closing).toHaveLength(3);
    const last = closing.at(-1);
    const first = closing[0];
    expect(first && last && last.stop - first.start).toBeCloseTo(0.6);
  });

  it("plays a fanfare of the close's three notes, then E6 for 0.3 s, about 900 ms", () => {
    const fake = fakeContext("running");
    const player = createSoundPlayer(() => fake.context);
    player.unlock();
    player.play("fanfare");
    expect(fake.tones.map((tone) => tone.frequency)).toEqual([
      659.25, 783.99, 1046.5, 1318.51,
    ]);
    const first = fake.tones[0];
    const last = fake.tones.at(-1);
    expect(last && last.stop - last.start).toBeCloseTo(0.3);
    expect(first && last && last.stop - first.start).toBeCloseTo(0.9);
  });

  it.each([
    [{ changed: true, titles: [] }, "fanfare"],
    [{ changed: false, titles: ["streak:7"] }, "fanfare"],
    [{ changed: true, titles: ["streak:7"] }, "fanfare"],
    [{ changed: false, titles: [] }, "closing"],
  ] as const)("chooses one sound for a finished round: %o -> %s", (round, sound) => {
    expect(
      roundSound({ streak: { changed: round.changed }, titles: round.titles }),
    ).toBe(sound);
  });

  it("does nothing where the browser has no Web Audio", () => {
    const player = createSoundPlayer(() => undefined);
    player.unlock();
    expect(() => {
      player.play("ok");
    }).not.toThrow();
  });

  it("gives the page a player that is silent where Web Audio is missing", () => {
    browserSound.unlock();
    expect(() => {
      browserSound.play("closing");
    }).not.toThrow();
  });
});
