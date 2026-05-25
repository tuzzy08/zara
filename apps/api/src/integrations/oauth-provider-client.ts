import type { IntegrationProvider } from "./integrations.models";

export interface IntegrationOAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  externalAccountId: string;
}

export interface IntegrationOAuthProviderClient {
  exchangeAuthorizationCode(input: {
    provider: IntegrationProvider;
    code: string;
    redirectUri: string;
  }): Promise<IntegrationOAuthTokenResponse>;
}

export const INTEGRATION_OAUTH_PROVIDER_CLIENT = Symbol("INTEGRATION_OAUTH_PROVIDER_CLIENT");

export class LocalIntegrationOAuthProviderClient implements IntegrationOAuthProviderClient {
  async exchangeAuthorizationCode(input: {
    provider: IntegrationProvider;
    code: string;
    redirectUri: string;
  }) {
    return {
      accessToken: `${input.provider}:access:${input.code}`,
      refreshToken: `${input.provider}:refresh:${input.code}`,
      externalAccountId: `${input.provider}:local-account`,
    };
  }
}
