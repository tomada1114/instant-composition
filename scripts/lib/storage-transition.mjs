import { StorageTransitionError } from "./storage-runtime.mjs";

/** @typedef {{logicalId:string,arn:string,capacity:number|null,timeout:number,revision:string,codeHash:string}} Writer */
/** @typedef {{discover:()=>Promise<Writer[]>,extendAccess:(writers:Writer[])=>Promise<void>,pause:(writer:Writer)=>Promise<void>,isPaused:(writer:Writer)=>Promise<boolean>,probePaused:(writer:Writer)=>Promise<boolean>,wait:(milliseconds:number)=>Promise<void>,deploy:()=>Promise<void>,verify:(writer:Writer)=>Promise<Writer>,current:()=>Promise<boolean>,restore:(writer:Writer)=>Promise<void>,certifyPredecessor:(writer:Writer)=>Promise<boolean>,stable:()=>Promise<boolean>,prepare:(writers:Writer[])=>Promise<void>,record:(state:unknown)=>Promise<void>}} TransitionPort */
/** Quiescence is never lost during code/config rollout. A failed partial rollout stays paused.
 * @param {TransitionPort} port @returns {Promise<void>}
 */
export async function transitionStorageWriters(port) {
  let writers = await port.discover();
  if (
    writers.length === 0 ||
    writers.some((writer) => writer.timeout < 1 || writer.timeout > 900)
  )
    throw new StorageTransitionError("owned writers");
  await port.extendAccess(writers);
  writers = await port.discover();
  const predecessors = writers.map((writer) => ({ ...writer }));
  // A paused worker may be left by an earlier failed bootstrap. Guarded bytes
  // alone do not prove readiness, so such predecessors never resume automatically.
  let preparationStarted = writers.some((writer) =>
    writer.logicalId.startsWith("ReadModelWorker"),
  );
  try {
    for (const writer of writers) {
      await port.pause(writer);
      if (!(await port.isPaused(writer)) || !(await port.probePaused(writer)))
        throw new StorageTransitionError("admission barrier");
    }
    await port.record({ phase: "paused", writers });
    // A confirmed throttle closes admission. Previously accepted requests may execute
    // for the full configured timeout; upstream retries after resume use new code.
    await port.wait(Math.max(...writers.map((writer) => writer.timeout)) * 1000);
    if (!(await port.current())) throw new StorageTransitionError("current main");
    await port.deploy();
    if (!(await port.stable()))
      throw new StorageTransitionError("CloudFormation status");
    writers = await port.discover();
    await port.extendAccess(writers);
    writers = await port.discover();
    const verified = [];
    for (const writer of writers) {
      if (!(await port.isPaused(writer)) || !(await port.probePaused(writer)))
        throw new StorageTransitionError("deployment quiescence");
      verified.push(await port.verify(writer));
    }
    await port.record({ phase: "certified", writers: verified });
    preparationStarted = verified.some((writer) =>
      writer.logicalId.startsWith("ReadModelWorker"),
    );
    await port.prepare(verified);
    for (const writer of verified)
      if (!(await port.isPaused(writer)) || !(await port.probePaused(writer)))
        throw new StorageTransitionError("prepared writer quiescence");
    if (!(await port.current())) throw new StorageTransitionError("current main");
    for (const writer of verified) {
      // Verify the code revision again immediately before admitting writes.
      const current = await port.verify(writer);
      if (current.revision !== writer.revision || current.codeHash !== writer.codeHash)
        throw new StorageTransitionError("code revision race");
      await port.restore(writer);
      const after = await port.verify(writer);
      if (after.revision !== writer.revision || after.codeHash !== writer.codeHash)
        throw new StorageTransitionError("code revision race");
    }
    await port.record({ phase: "resumed", writers: verified });
  } catch (error) {
    // Discover again: a failed CloudFormation update can have created a worker.
    let remaining = await port.discover();
    await port.extendAccess(remaining);
    remaining = await port.discover();
    for (const writer of remaining) await port.pause(writer);
    let recovered = false;
    if (
      !preparationStarted &&
      (await port.stable()) &&
      remaining.length === predecessors.length
    ) {
      const safe = [];
      for (const writer of remaining) {
        const previous = predecessors.find((entry) => entry.arn === writer.arn);
        if (
          previous?.codeHash !== writer.codeHash ||
          !(await port.certifyPredecessor(writer))
        ) {
          safe.length = 0;
          break;
        }
        safe.push({ ...writer, capacity: previous.capacity });
      }
      if (safe.length === remaining.length && safe.length > 0) {
        for (const writer of safe) await port.restore(writer);
        recovered = true;
      }
    }
    await port.record({
      phase: recovered ? "recovered-certified-predecessor" : "paused-forward-fix",
      writers: remaining,
    });
    throw error;
  }
}
