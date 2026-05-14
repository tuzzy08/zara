import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { configureCors } from "./config/cors";
import { isRuntimeEntry } from "./entrypoint";
import { runtimeEnvironment } from "./config/runtime-env";

export async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureCors(app);
  await app.listen(runtimeEnvironment.port);
  return app;
}

if (isRuntimeEntry(import.meta.url, process.argv[1])) {
  bootstrap();
}
