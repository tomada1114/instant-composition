import { StorageTransitionError } from "./storage-runtime.mjs";
import { sameStorageWriter } from "./storage-configuration.mjs";

/** @typedef {{logicalId:string,arn:string,capacity:number|null,timeout:number,revision:string,codeHash:string,configurationHash:string}} Writer */
/** @typedef {{assertWorkTime:(requiredMilliseconds?:number)=>void,beginCleanup:()=>void,drain:(milliseconds:number)=>Promise<void>,cleanupTimeAvailable:()=>boolean,discover:()=>Promise<Writer[]>,owned?:()=>Promise<Writer[]>,capacityMatches:(writer:Writer)=>Promise<boolean>,extendAccess:(writers:Writer[])=>Promise<void>,pause:(writer:Writer)=>Promise<Writer>,isPaused:(writer:Writer)=>Promise<boolean>,probePaused:(writer:Writer)=>Promise<boolean>,wait:(milliseconds:number)=>Promise<void>,deploy:()=>Promise<void>,verify:(writer:Writer)=>Promise<Writer>,current:()=>Promise<boolean>,restore:(writer:Writer)=>Promise<Writer>,certifyPredecessor:(writer:Writer)=>Promise<Writer|undefined>,stable:()=>Promise<boolean>,prepare:(writers:Writer[])=>Promise<Writer[]>,record:(state:unknown)=>Promise<void>}} TransitionPort */
/** Quiescence is never lost during code/config rollout. A failed partial rollout stays paused.
 * @param {TransitionPort} port @returns {Promise<void>}
 */
export async function transitionStorageWriters(port) {
  port.assertWorkTime();
  let writers = await port.discover();
  if (
    writers.length === 0 ||
    writers.some((writer) => writer.timeout < 1 || writer.timeout > 900)
  )
    throw new StorageTransitionError("owned writers");
  await port.extendAccess(writers);
  writers = await port.discover();
  const predecessors = writers.map((writer) => ({ ...writer }));
  port.assertWorkTime(Math.max(...writers.map((writer) => writer.timeout)) * 1000);
  let preparationStarted = writers.some((writer) =>
    writer.logicalId.startsWith("ReadModelWorker"),
  );
  /** Cleanup attempts every known writer even when another writer's pause fails.
   * @returns {Promise<{remaining:Writer[],verified:boolean,admissionClosed:boolean,deploymentStable:boolean|null}>}
   */
  async function closeAll() {
    const known = new Map(writers.map((writer) => [writer.arn, writer]));
    const receipts = new Map(known);
    let verified = true;
    // Already authorized writers close before discovery or permission refresh can stall.
    for (const [arn, writer] of known) {
      try {
        receipts.set(arn, await port.pause(writer));
      } catch {
        verified = false;
      }
    }
    try {
      if (port.owned !== undefined)
        for (const writer of await port.owned())
          if (!known.has(writer.arn)) known.set(writer.arn, writer);
    } catch {
      verified = false;
    }
    try {
      for (const writer of await port.discover()) known.set(writer.arn, writer);
    } catch {
      verified = false;
    }
    try {
      await port.extendAccess([...known.values()]);
      for (const writer of await port.discover()) known.set(writer.arn, writer);
    } catch {
      verified = false;
    }
    const pending = new Map(known);
    for (const [arn, writer] of known)
      if (!receipts.has(arn)) receipts.set(arn, writer);
    let firstAttempt = true;
    while (pending.size > 0 && (firstAttempt || port.cleanupTimeAvailable())) {
      firstAttempt = false;
      // Attempt all writers before retrying one, including failed observations.
      for (const [arn, writer] of pending) {
        let receipt = writer;
        try {
          receipt = await port.pause(writer);
          receipts.set(arn, receipt);
          pending.set(arn, receipt);
        } catch {
          verified = false;
        }
        try {
          if ((await port.isPaused(receipt)) && (await port.probePaused(receipt)))
            pending.delete(arn);
          else verified = false;
        } catch {
          verified = false;
        }
      }
      if (pending.size === 0)
        for (const [arn, receipt] of receipts) {
          try {
            if (!(await port.isPaused(receipt)) || !(await port.probePaused(receipt))) {
              pending.set(arn, receipt);
              verified = false;
            }
          } catch {
            pending.set(arn, receipt);
            verified = false;
          }
        }
      if (pending.size > 0) {
        try {
          await port.wait(1000);
        } catch {
          break;
        }
      }
    }
    const closed = [...receipts.values()];
    const admissionClosed = pending.size === 0;
    let deploymentStable = null;
    try {
      deploymentStable = await port.stable();
    } catch {
      verified = false;
    }
    if (deploymentStable !== true) verified = false;
    if (!admissionClosed)
      return { remaining: closed, verified: false, admissionClosed, deploymentStable };

    try {
      await port.drain(
        Math.max(...closed.map((writer) => writer.timeout), verified ? 0 : 900) * 1000,
      );
    } catch {
      verified = false;
    }
    return { remaining: closed, verified, admissionClosed, deploymentStable };
  }
  try {
    port.assertWorkTime();
    const initiallyPaused = [];
    for (const writer of writers) {
      port.assertWorkTime();
      const receipt = await port.pause(writer);
      if (!(await port.isPaused(receipt)) || !(await port.probePaused(receipt)))
        throw new StorageTransitionError("admission barrier");
      initiallyPaused.push(receipt);
    }
    writers = initiallyPaused;
    await port.record({ phase: "paused", writers });
    await port.wait(Math.max(...writers.map((writer) => writer.timeout)) * 1000);
    if (!(await port.current())) throw new StorageTransitionError("current main");
    port.assertWorkTime();
    await port.deploy();
    port.assertWorkTime();
    if (!(await port.stable()))
      throw new StorageTransitionError("CloudFormation status");
    writers = await port.discover();
    await port.extendAccess(writers);
    writers = await port.discover();
    const verified = [];
    for (const writer of writers) {
      port.assertWorkTime();
      if (!(await port.isPaused(writer)) || !(await port.probePaused(writer)))
        throw new StorageTransitionError("deployment quiescence");
      const checked = await port.verify(writer);
      if (!sameStorageWriter(writer, checked))
        throw new StorageTransitionError("certification revision race");
      verified.push(checked);
    }
    await port.record({ phase: "certified", writers: verified });
    preparationStarted = verified.some((writer) =>
      writer.logicalId.startsWith("ReadModelWorker"),
    );
    port.assertWorkTime();
    const prepared = await port.prepare(verified);
    port.assertWorkTime();
    if (
      prepared.length !== verified.length ||
      new Set(prepared.map((writer) => writer.arn)).size !== prepared.length
    )
      throw new StorageTransitionError("prepared writer inventory");
    for (const writer of verified) {
      const receipt = prepared.find((entry) => entry.arn === writer.arn);
      if (
        receipt === undefined ||
        !sameStorageWriter(
          writer,
          receipt,
          !writer.logicalId.startsWith("ReadModelWorker"),
        )
      )
        throw new StorageTransitionError("prepared writer identity");
      if (!(await port.isPaused(receipt)) || !(await port.probePaused(receipt)))
        throw new StorageTransitionError("prepared writer quiescence");
    }
    if (!(await port.current())) throw new StorageTransitionError("current main");
    const resumed = [];
    for (const writer of prepared) {
      port.assertWorkTime();
      if (!sameStorageWriter(writer, await port.verify(writer)))
        throw new StorageTransitionError("code revision race");
      const receipt = await port.restore(writer);
      if (
        !sameStorageWriter(writer, receipt, false) ||
        !sameStorageWriter(receipt, await port.verify(receipt))
      )
        throw new StorageTransitionError("code revision race");
      resumed.push(receipt);
    }
    if (!(await port.current())) throw new StorageTransitionError("current main");
    const finalInventory = await port.discover();
    if (
      finalInventory.length !== resumed.length ||
      new Set(finalInventory.map((writer) => writer.arn)).size !== resumed.length
    )
      throw new StorageTransitionError("installed writer inventory");
    for (const writer of resumed) {
      const actual = finalInventory.find((entry) => entry.arn === writer.arn);
      if (
        actual === undefined ||
        !sameStorageWriter(writer, actual) ||
        !sameStorageWriter(writer, await port.verify(writer)) ||
        !(await port.capacityMatches(writer))
      )
        throw new StorageTransitionError("code revision race");
    }
    port.assertWorkTime();
    await port.record({ phase: "resumed", writers: resumed });
  } catch (error) {
    port.beginCleanup();
    let cleanup = await closeAll();
    let recovered = false;
    let stable = false;
    try {
      port.assertWorkTime();
      stable = await port.stable();
      port.assertWorkTime();
    } catch {
      /* Recovery remains disabled. */
    }
    if (
      !preparationStarted &&
      cleanup.verified &&
      stable &&
      cleanup.remaining.length === predecessors.length
    ) {
      const safe = [];
      for (const writer of cleanup.remaining) {
        const previous = predecessors.find((entry) => entry.arn === writer.arn);
        let certificate;
        try {
          port.assertWorkTime();
          certificate = await port.certifyPredecessor(writer);
          port.assertWorkTime();
        } catch {
          /* No certificate means no admission. */
        }
        if (
          previous === undefined ||
          !sameStorageWriter(previous, writer, false) ||
          certificate === undefined ||
          !sameStorageWriter(writer, certificate)
        ) {
          safe.length = 0;
          break;
        }
        safe.push({ ...certificate, capacity: previous.capacity });
      }
      if (safe.length === cleanup.remaining.length && safe.length > 0) {
        try {
          const recoveredWriters = [];
          for (const writer of safe) {
            const receipt = await port.restore(writer);
            const checked = await port.certifyPredecessor(receipt);
            if (
              !sameStorageWriter(writer, receipt, false) ||
              checked === undefined ||
              !sameStorageWriter(receipt, checked) ||
              !(await port.capacityMatches(receipt))
            )
              throw new StorageTransitionError("recovery revision race");
            recoveredWriters.push(receipt);
          }
          cleanup.remaining = recoveredWriters;
          recovered = true;
        } catch {
          cleanup = await closeAll();
        }
      }
    }
    await port.record({
      phase: recovered ? "recovered-certified-predecessor" : "paused-forward-fix",
      writers: cleanup.remaining,
      cleanupVerified: cleanup.verified,
      admissionClosed: recovered ? false : cleanup.admissionClosed,
      cloudFormationStable: cleanup.deploymentStable,
      failure:
        error instanceof StorageTransitionError ? error.part : "unexpected failure",
    });
    throw error;
  }
}
