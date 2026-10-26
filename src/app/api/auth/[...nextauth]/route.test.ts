import { beforeEach, describe, expect, it, vi } from "vitest";

const handlerPost = vi.fn(async () => new Response("handled", { status: 200 }));
const handlerGet = vi.fn(async () => new Response("get", { status: 200 }));

vi.mock("@/auth", () => ({
  handlers: { GET: handlerGet, POST: handlerPost },
}));

const { GET, POST } = await import("./route");

function post(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: { user: { anything: true } } }),
  });
}

describe("auth route — session claim integrity", () => {
  beforeEach(() => {
    handlerPost.mockClear();
    handlerGet.mockClear();
  });

  it("answers 405 to a POST on the session endpoint, with no cookie and no body, never reaching the handler", async () => {
    const res = await POST(post("/api/auth/session") as never);
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toBe("");
    expect(handlerPost).not.toHaveBeenCalled();
  });

  it("answers 405 when the session endpoint carries a query string", async () => {
    const res = await POST(post("/api/auth/session?x=1") as never);
    expect(res.status).toBe(405);
    expect(handlerPost).not.toHaveBeenCalled();
  });

  it.each([
    "/api/auth/callback/credentials",
    "/api/auth/signout",
    "/api/auth/signin/google",
    "/api/auth/session/extra",
  ])("passes POST %s to the NextAuth handler", async (path) => {
    const req = post(path);
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(handlerPost).toHaveBeenCalledTimes(1);
  });

  it("leaves GET to the NextAuth handler", () => {
    expect(GET).toBe(handlerGet);
  });
});
