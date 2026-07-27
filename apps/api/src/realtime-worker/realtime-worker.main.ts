import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { Type } from "@nestjs/common";

import { isRuntimeEntry } from "../entrypoint";
import { initializeApiObservability } from "../observability/otel";
import { resolvePstnRealtimeWorkerConfig } from "./pstn-realtime-worker-config";
import {
  PstnRealtimeWorkerModule,
  resolvePstnRealtimeWorkerIdentity,
} from "./pstn-realtime-worker.module";

interface WorkerNestApplication {
  enableShutdownHooks(signals: string[]): void;
  listen(port: number): Promise<unknown>;
}

export interface PstnRealtimeWorkerBootstrapDependencies {
  env: Record<string, string | undefined>;
  initializeObservability(
    env: Record<string, string | undefined>,
  ): void;
  createApplication(module: Type<unknown>): Promise<WorkerNestApplication>;
}

const defaultDependencies: PstnRealtimeWorkerBootstrapDependencies = {
  env: process.env,
  initializeObservability: initializeApiObservability,
  createApplication: (module) => NestFactory.create(module),
};

export async function bootstrapPstnRealtimeWorker(
  dependencies: PstnRealtimeWorkerBootstrapDependencies = defaultDependencies,
) {
  resolvePstnRealtimeWorkerIdentity(dependencies.env);
  const config = resolvePstnRealtimeWorkerConfig(dependencies.env);
  dependencies.initializeObservability(dependencies.env);
  const app = await dependencies.createApplication(PstnRealtimeWorkerModule);
  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
  await app.listen(config.port);
  return app;
}

if (isRuntimeEntry(import.meta.url, process.argv[1])) {
  void bootstrapPstnRealtimeWorker();
}
