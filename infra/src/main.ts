// The entry `cdk.json` runs: `pnpm cdk synth -c stage=dev` from the repository
// root.
import { buildApp } from "./app";

buildApp().app.synth();
