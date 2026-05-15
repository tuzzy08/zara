import type { INestApplication } from "@nestjs/common";

const localDevOrigins = [
  "http://127.0.0.1:4173",
  "http://127.0.0.1:4174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://localhost:4173",
  "http://localhost:4174",
  "http://localhost:5173",
  "http://localhost:5174",
] as const;

const trustedOrigins = new Set([
  ...localDevOrigins,
  "https://app.zara.ai",
  "https://admin.zara.ai",
  "https://staging-app.zara.ai",
  "https://staging-admin.zara.ai",
]);

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
