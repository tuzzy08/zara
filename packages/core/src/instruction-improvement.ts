/** Safe draft metadata only. This does not grant tool or transfer permissions. */
export interface InstructionImprovementRequest {
  workspaceId: string;
  name: string;
  businessName: string;
  agentClass: string;
  instructions: string;
  languagePolicy: {
    defaultLanguage: string;
    supportedLanguages: string[];
    allowMidCallSwitching: boolean;
    languagePrompts?: Record<string, string> | undefined;
  };
  tools: Array<{
    id: string;
    connector?: string | undefined;
    toolId?: string | undefined;
    label: string;
    whenToUse: string;
    requiredInputs: string[];
    requiresHumanApproval: boolean;
    available: boolean;
  }>;
  handoffTargets: Array<{ id: string; label: string }>;
}

export interface InstructionImprovementResult {
  originalInstructions: string;
  instructions: string;
  changes: string[];
  questions: string[];
  conflicts: string[];
  toolIds: string[];
  handoffTargetIds: string[];
}
