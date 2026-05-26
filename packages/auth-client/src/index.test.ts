import { beforeEach, describe, expect, it, vi } from "vitest";

const setActive = vi.fn();
const list = vi.fn();
const signInEmail = vi.fn();
const signUpEmail = vi.fn();

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    useSession: () => ({ data: null, isPending: false, error: null }),
    useActiveOrganization: () => ({ data: null, isPending: false, error: null }),
    useActiveMember: () => ({ data: null, isPending: false, error: null }),
    signIn: {
      email: signInEmail,
    },
    signUp: {
      email: signUpEmail,
    },
    signOut: vi.fn(),
    organization: {
      create: vi.fn(),
      list,
      setActive,
    },
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  organizationClient: () => ({}),
}));

describe("tenant auth client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInEmail.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    signUpEmail.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    list.mockResolvedValue({
      data: [
        {
          id: "org-acme",
          name: "Acme Voice Ops",
        },
      ],
      error: null,
    });
    setActive.mockResolvedValue({ data: { id: "org-acme" }, error: null });
  });

  it("restores the user's tenant organization after email sign-in", async () => {
    const { tenantAuthClient } = await import("./index");

    const result = await tenantAuthClient.signInEmail({
      email: "owner@acme.example",
      password: "correct-horse-battery",
    });

    expect(result).toEqual({ ok: true });
    expect(list).toHaveBeenCalledTimes(1);
    expect(setActive).toHaveBeenCalledWith({
      organizationId: "org-acme",
    });
  });

  it("rejects signup without a real tenant organization name before creating a user", async () => {
    const { tenantAuthClient } = await import("./index");

    const result = await tenantAuthClient.signUpEmail({
      email: "owner@acme.example",
      password: "correct-horse-battery",
      name: "Acme Owner",
      organizationName: "   ",
    });

    expect(result).toEqual({
      ok: false,
      message: "Enter a tenant organization name to create your Zara account.",
    });
    expect(signUpEmail).not.toHaveBeenCalled();
  });
});
