import { loadEnvironmentConfig } from "@zara/core";

import { assertProductionAuthCookieOriginCompatibility } from "./auth-cookie-origin";

assertProductionAuthCookieOriginCompatibility(process.env);

export const runtimeEnvironment = loadEnvironmentConfig(process.env);
