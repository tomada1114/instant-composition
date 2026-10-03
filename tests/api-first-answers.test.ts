import { makeApi } from "./api-harness";
import { describeFirstAnswerHttpContract } from "./first-answer-http-contract";

describeFirstAnswerHttpContract("HTTP first answers with memory", () => makeApi());
