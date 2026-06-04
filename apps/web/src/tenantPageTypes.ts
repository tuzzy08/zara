export interface TenantPageProps {
  organizationId: string;
  activeWorkspaceId: string;
  showToast: (message: string) => void;
}
