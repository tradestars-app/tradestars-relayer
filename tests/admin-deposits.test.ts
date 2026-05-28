import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/deposits/route";
import { listRecentP2PDepositOperations } from "@/lib/store/p2p-deposit-ops-store";
import { listRecentP2PDepositSubmissions } from "@/lib/store/p2p-deposit-submissions-store";

vi.mock("@/lib/store/p2p-deposit-ops-store", () => ({
  listRecentP2PDepositOperations: vi.fn(),
}));
vi.mock("@/lib/store/p2p-deposit-submissions-store", () => ({
  listRecentP2PDepositSubmissions: vi.fn(),
  upsertP2PDepositSubmission: vi.fn(),
}));

describe("GET /api/admin/deposits", () => {
  const mockedList = vi.mocked(listRecentP2PDepositOperations);
  const mockedListSubmissions = vi.mocked(listRecentP2PDepositSubmissions);

  beforeEach(() => {
    process.env.RELAYER_ADMIN_API_KEY = "relayer-secret";
    vi.clearAllMocks();
  });

  it("rejects missing admin api key", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/deposits"),
    );

    expect(response.status).toBe(401);
    expect(mockedList).not.toHaveBeenCalled();
  });

  it("returns recent operations for a valid admin api key", async () => {
    mockedList.mockResolvedValueOnce([]);
    mockedListSubmissions.mockResolvedValueOnce([]);

    const response = await GET(
      new Request("http://localhost/api/admin/deposits?limit=5", {
        headers: {
          Authorization: "Bearer relayer-secret",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mockedList).toHaveBeenCalledWith(5);
    expect(mockedListSubmissions).toHaveBeenCalledWith(5);
    expect(await response.json()).toEqual({ operations: [], submissions: [] });
  });
});
