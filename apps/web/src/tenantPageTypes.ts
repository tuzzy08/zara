export interface TenantPageProps {
  organizationId: string;
  organizationName?: string | undefined;
  activeWorkspaceId: string;
  showToast: (message: string) => void;
}
