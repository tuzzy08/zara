import type { INestApplication } from "@nestjs/common";

import { resolveTrustedOrigins } from "./trusted-origins";

const trustedOrigins = new Set(resolveTrustedOrigins());

export function configureCors(app: INestApplication) {
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (origin === undefined || trustedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin '${origin}' is not allowed by Zara API CORS policy.`), false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
}
