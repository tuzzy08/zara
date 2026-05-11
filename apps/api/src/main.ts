import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { runtimeEnvironment } from "./config/runtime-env";

export async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(runtimeEnvironment.port);
  return app;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  bootstrap();
}
