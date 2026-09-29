import { CartesiaAdminUsageClient, CartesiaBillingEvidenceSource } from "./cartesia-billing-evidence.source";
import { Pool } from "pg";
import { ProviderUsageRecordingRepository } from "./provider-usage-recording.repository";
import { OpenAiDirectBillingEvidenceSource } from "./openai-billing-evidence.source";
import { OpenAiOrganizationBillingClient } from "./openai-organization-billing.client";
import { collectSharedProviderBillingEvidence, saveSharedProviderBillingEvidence } from "./shared-provider-billing-evidence";

const args = process.argv.slice(2);
const [cycleStartsAt, cycleEndsAt, cartesiaApiKeyId, openAiProjectId, outputPath] = args;

if (args.length !== 5 || !cycleStartsAt || !cycleEndsAt || !cartesiaApiKeyId || !openAiProjectId || !outputPath) {
  process.stderr.write("Usage: billing:collect-shared -- <UTC-start> <UTC-end> <Cartesia-key-ID> <OpenAI-project-ID> <new-output-file>\n");
  process.exitCode = 1;
} else if (!process.env.CARTESIA_ADMIN_API_KEY?.trim() || !process.env.OPENAI_ADMIN_KEY?.trim()) {
  process.stderr.write("Set CARTESIA_ADMIN_API_KEY and OPENAI_ADMIN_KEY in the command environment. Do not put tokens in command arguments.\n");
  process.exitCode = 1;
} else {
  const database = process.env.DATABASE_URL?.trim() ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
  try {
    const openaiClient = new OpenAiOrganizationBillingClient({ adminKey: process.env.OPENAI_ADMIN_KEY });
    const report = await collectSharedProviderBillingEvidence({
      cycleStartsAt, cycleEndsAt, cartesiaApiKeyId, openAiProjectId,
    }, {
      observations: database === null ? undefined : new ProviderUsageRecordingRepository(database),
      openaiTranscription: openaiClient,
      cartesia: new CartesiaBillingEvidenceSource(
        new CartesiaAdminUsageClient({ adminApiKey: process.env.CARTESIA_ADMIN_API_KEY }),
        { readDurableTenantApiKeyScope: async () => null },
      ),
      openai: new OpenAiDirectBillingEvidenceSource(
        { getProjectId: async () => null },
        openaiClient,
      ),
      now: () => new Date().toISOString(),
    });
    await saveSharedProviderBillingEvidence(outputPath, report);
    process.stdout.write("Shared provider reports saved. Usage comparison is pending. No tenant billing state changed.\n");
  } catch {
    process.stderr.write("Shared report collection failed. Check the completed UTC period, provider access, scope IDs, and a new output path. No tenant billing state changed.\n");
    process.exitCode = 1;
  } finally {
    await database?.end();
  }
}
