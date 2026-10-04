import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { parseJson, readKey, readString } from "./json.mjs";
import { StorageTransitionError, guardMetadata } from "./storage-runtime.mjs";
import { assertStorageArtifact } from "./storage-compatibility.mjs";
import { prepareStorageReadModels } from "./storage-bootstrap.mjs";
import { storageZipFiles, verifyStorageZip } from "./storage-zip.mjs";
import {
  storageConfigurationHash,
  sameStorageWriter,
} from "./storage-configuration.mjs";
import {
  awsJson,
  runStorageCdk,
  deployedStorageZip,
  probeStorageThrottle,
  invokeStorageBootstrap,
} from "./storage-aws-transport.mjs";

/** @typedef {{aws: typeof awsJson, cdk: typeof runStorageCdk, zip: typeof deployedStorageZip, probe: typeof probeStorageThrottle, invoke: typeof invokeStorageBootstrap}} StorageCommands */
const SYSTEM = {
  aws: awsJson,
  cdk: runStorageCdk,
  zip: deployedStorageZip,
  probe: probeStorageThrottle,
  invoke: invokeStorageBootstrap,
};

/** @param {unknown} value @param {string} key @returns {number} */
function number(value, key) {
  const result = readKey(value, key);
  if (typeof result !== "number" || !Number.isSafeInteger(result))
    throw new StorageTransitionError("AWS numeric response");
  return result;
}
/** @param {unknown} value @param {string} key @returns {string} */
function string(value, key) {
  const result = readString(value, key);
  if (result === undefined || result === "")
    throw new StorageTransitionError("AWS response");
  return result;
}
/** @param {string} arn @returns {{account:string}} */
export function storageDeployIdentity(arn) {
  const match = /^arn:aws:iam::([0-9]{12}):role\/instant-composition-dev-deploy$/.exec(
    arn,
  );
  if (match?.[1] === undefined) throw new StorageTransitionError("deploy identity");
  return { account: match[1] };
}
/** Only CloudFormation's owned resources may become direct Lambda permission subjects.
 * @param {unknown} value @param {string} account @param {readonly import('./storage-assembly.mjs').PlannedWriter[]} planned @returns {import('./storage-transition.mjs').Writer[]}
 */
export function ownedStorageWriters(value, account, planned) {
  const resources = readKey(value, "StackResourceSummaries");
  if (!Array.isArray(resources))
    throw new StorageTransitionError("owned stack resources");
  return resources.flatMap((resource) => {
    if (readString(resource, "ResourceType") !== "AWS::Lambda::Function") return [];
    const logicalId = string(resource, "LogicalResourceId"),
      plan = planned.find((writer) => writer.logicalId === logicalId);
    if (plan === undefined) {
      if (/^(ApiFunction|ReadModelWorker)/.test(logicalId))
        throw new StorageTransitionError("writer replacement");
      return [];
    }
    const physical = string(resource, "PhysicalResourceId");
    if (
      !new RegExp(`^instant-composition-dev-app-${logicalId}[A-Za-z0-9-]+$`).test(
        physical,
      )
    )
      throw new StorageTransitionError("writer resource provenance");
    return [
      {
        logicalId,
        arn: `arn:aws:lambda:ap-northeast-1:${account}:function:${physical}`,
        capacity: plan.capacity,
        timeout: plan.timeout,
        revision: "",
        codeHash: "",
        configurationHash: "",
      },
    ];
  });
}
/** @param {{root:string,assembly:string,sha:string,roleArn:string,policy:import('./storage-compatibility.mjs').StoragePolicy,planned:import('./storage-assembly.mjs').PlannedWriter[],current:()=>Promise<boolean>,deadline?:number}} options @param {StorageCommands} [commands] @returns {import('./storage-transition.mjs').TransitionPort} */
export function awsStorageTransition(options, commands = SYSTEM) {
  const aws = commands.aws,
    cdk = commands.cdk,
    deployedZip = commands.zip;
  const { root, assembly, roleArn, policy, planned, current } = options,
    { account } = storageDeployIdentity(roleArn);
  if (string(aws(["sts", "get-caller-identity"], process.env), "Account") !== account)
    throw new StorageTransitionError("deploy account");
  const assumed = readKey(
    aws(
      [
        "sts",
        "assume-role",
        "--role-arn",
        `arn:aws:iam::${account}:role/cdk-hnb659fds-deploy-role-${account}-ap-northeast-1`,
        "--role-session-name",
        "storage-owned-stack",
      ],
      process.env,
    ),
    "Credentials",
  );
  const bootstrap = {
    ...process.env,
    AWS_ACCESS_KEY_ID: string(assumed, "AccessKeyId"),
    AWS_SECRET_ACCESS_KEY: string(assumed, "SecretAccessKey"),
    AWS_SESSION_TOKEN: string(assumed, "SessionToken"),
  };
  const authorized = new Set();
  let deployed = false;
  const checkpoint = path.join(root, "dist/storage-transition.json");
  // Work stops with twenty minutes left: five for barriers, fifteen for drain.
  const closingDeadline = (options.deadline ?? Date.now()) + 5 * 60000;
  mkdirSync(path.dirname(checkpoint), { recursive: true });
  /** @param {import('./storage-transition.mjs').Writer} writer @returns {import('./storage-transition.mjs').Writer} */
  function configuration(writer) {
    const response = aws(
      ["lambda", "get-function-configuration", "--function-name", writer.arn],
      process.env,
    );
    if (
      string(response, "FunctionArn") !== writer.arn ||
      string(response, "State") !== "Active" ||
      string(response, "LastUpdateStatus") !== "Successful" ||
      readKey(readKey(response, "Environment"), "Error") !== undefined
    )
      throw new StorageTransitionError("writer update status");
    return {
      ...writer,
      timeout: number(response, "Timeout"),
      revision: string(response, "RevisionId"),
      codeHash: string(response, "CodeSha256"),
      configurationHash: storageConfigurationHash(response),
    };
  }
  /** GetFunction, separate configuration and ZIP download share one exact identity.
   * @param {import('./storage-transition.mjs').Writer} writer
   */
  async function fetchedWriter(writer) {
    const response = aws(
      ["lambda", "get-function", "--function-name", writer.arn],
      process.env,
    );
    const actual = configuration(writer);
    const config = readKey(response, "Configuration");
    if (
      string(config, "RevisionId") !== actual.revision ||
      string(config, "CodeSha256") !== actual.codeHash ||
      storageConfigurationHash(config) !== actual.configurationHash
    )
      throw new StorageTransitionError("download revision race");
    const zip = await deployedZip(response);
    if (!sameStorageWriter(actual, configuration(actual)))
      throw new StorageTransitionError("download revision race");
    return { actual, config, zip };
  }
  /** Closing admission still runs when an identity precheck detects drift.
   * @param {import('./storage-transition.mjs').Writer} writer
   * @param {number|null} capacity @returns {import('./storage-transition.mjs').Writer}
   */
  function concurrencyReceipt(writer, capacity) {
    let before;
    try {
      before = configuration(writer);
    } catch {
      /* Pause must still be attempted. */
    }
    const exact = before !== undefined && sameStorageWriter(writer, before);
    if (capacity !== 0 && !exact)
      throw new StorageTransitionError("capacity admission identity");
    aws(
      capacity === null
        ? ["lambda", "delete-function-concurrency", "--function-name", writer.arn]
        : [
            "lambda",
            "put-function-concurrency",
            "--function-name",
            writer.arn,
            "--reserved-concurrent-executions",
            String(capacity),
          ],
      process.env,
    );
    const actual = readKey(
      aws(
        ["lambda", "get-function-concurrency", "--function-name", writer.arn],
        process.env,
      ),
      "ReservedConcurrentExecutions",
    );
    if (
      (capacity === null && actual !== undefined) ||
      (capacity !== null && actual !== capacity)
    )
      throw new StorageTransitionError("restored capacity");
    const after = configuration(writer);
    if (!exact || before === undefined || !sameStorageWriter(before, after, false))
      throw new StorageTransitionError("capacity configuration race");
    return after;
  }
  /** @type {import("./storage-transition.mjs").TransitionPort} */
  const port = {
    cleanupTimeAvailable: () => Date.now() < closingDeadline,
    async owned() {
      return Promise.resolve(
        ownedStorageWriters(
          aws(
            [
              "cloudformation",
              "list-stack-resources",
              "--stack-name",
              "instant-composition-dev-app",
            ],
            bootstrap,
          ),
          account,
          planned,
        ),
      );
    },
    async capacityMatches(writer) {
      const actual = readKey(
        aws(
          ["lambda", "get-function-concurrency", "--function-name", writer.arn],
          process.env,
        ),
        "ReservedConcurrentExecutions",
      );
      return Promise.resolve(
        writer.capacity === null ? actual === undefined : actual === writer.capacity,
      );
    },
    async discover() {
      const rows = ownedStorageWriters(
        aws(
          [
            "cloudformation",
            "list-stack-resources",
            "--stack-name",
            "instant-composition-dev-app",
          ],
          bootstrap,
        ),
        account,
        planned,
      );
      if (
        deployed &&
        (rows.length !== planned.length ||
          planned.some((plan) => !rows.some((row) => row.logicalId === plan.logicalId)))
      )
        throw new StorageTransitionError("installed writer inventory");
      return Promise.resolve(
        rows.map((writer) =>
          authorized.has(writer.arn) ? configuration(writer) : writer,
        ),
      );
    },
    async extendAccess(writers) {
      const arns = writers.map((writer) => writer.arn).sort();
      const output = path.join(root, "dist/storage-access-assembly");
      await cdk(
        [
          "synth",
          "deploy-access",
          "--exclusively",
          "-c",
          "stage=dev",
          "-c",
          `storage-writer-arns=${JSON.stringify(arns)}`,
          "--output",
          output,
        ],
        root,
      );
      await cdk(
        [
          "deploy",
          "--app",
          output,
          "deploy-access",
          "--exclusively",
          "--require-approval",
          "never",
        ],
        root,
      );
      for (const arn of arns) authorized.add(arn);
    },
    async pause(writer) {
      return Promise.resolve(concurrencyReceipt(writer, 0));
    },
    async isPaused(writer) {
      return Promise.resolve(
        readKey(
          aws(
            ["lambda", "get-function-concurrency", "--function-name", writer.arn],
            process.env,
          ),
          "ReservedConcurrentExecutions",
        ) === 0,
      );
    },
    async probePaused(writer) {
      return commands.probe(writer.arn, root);
    },
    async wait(milliseconds) {
      await setTimeout(milliseconds);
    },
    async deploy() {
      await cdk(
        [
          "deploy",
          "--app",
          assembly,
          "app",
          "--exclusively",
          "--require-approval",
          "never",
          "--outputs-file",
          path.join(root, "dist/deploy-outputs.json"),
        ],
        root,
      );
      deployed = true;
    },
    async stable() {
      const status = string(
        readKey(
          readKey(
            aws(
              [
                "cloudformation",
                "describe-stacks",
                "--stack-name",
                "instant-composition-dev-app",
              ],
              bootstrap,
            ),
            "Stacks",
          ),
          "0",
        ),
        "StackStatus",
      );
      return Promise.resolve(
        ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"].includes(
          status,
        ),
      );
    },
    async verify(writer) {
      const plan = planned.find((entry) => entry.logicalId === writer.logicalId);
      if (plan === undefined) throw new StorageTransitionError("writer plan");
      const { actual, config, zip } = await fetchedWriter(writer);
      if (
        readString(config, "Handler") !== "storage.handler" ||
        actual.timeout !== plan.timeout
      )
        throw new StorageTransitionError("installed guard configuration");
      verifyStorageZip(zip, actual.codeHash, plan.release);
      return actual;
    },
    current,
    async restore(writer) {
      return Promise.resolve(concurrencyReceipt(writer, writer.capacity));
    },
    async certifyPredecessor(writer) {
      try {
        const { actual, config, zip } = await fetchedWriter(writer);
        const bytes = storageZipFiles(zip).get("storage-release.json");
        if (
          bytes === undefined ||
          readString(config, "Handler") !== "storage.handler" ||
          !sameStorageWriter(writer, actual)
        )
          return undefined;
        const release = guardMetadata(parseJson(bytes.toString("utf8")));
        assertStorageArtifact(policy, release);
        verifyStorageZip(zip, actual.codeHash, release);
        return actual;
      } catch {
        return undefined;
      }
    },
    async prepare(writers) {
      const worker = writers.find((writer) =>
        writer.logicalId.startsWith("ReadModelWorker"),
      );
      if (worker === undefined) return writers;
      const prepared = await prepareStorageReadModels({
        root,
        sha: options.sha,
        writer: worker,
        port,
        ...(options.deadline === undefined ? {} : { deadline: options.deadline }),
        invoke: async (checkpoint) => commands.invoke(worker.arn, root, checkpoint),
      });
      return writers.map((writer) => (writer.arn === worker.arn ? prepared : writer));
    },
    async record(state) {
      writeFileSync(`${checkpoint}.next`, JSON.stringify(state), { mode: 0o600 });
      renameSync(`${checkpoint}.next`, checkpoint);
      return Promise.resolve();
    },
  };
  return port;
}
