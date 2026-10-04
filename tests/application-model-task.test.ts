import { createMemoryStores } from "@instant-composition/adapters";
import { describeModelTaskContract } from "./model-task-contract";

describeModelTaskContract("persisted model tasks in memory", createMemoryStores);
