import { afterEach, describe, expect, it, vi } from "vitest";
import { hasAdminRole, isBanned } from "@/lib/account";
import { safeNext, signInErrorMessage } from "@/lib/auth-utils";
import { CHAT_PATH, upstreamPath } from "@/lib/backend-path";
import { authSchema, officeSchema, parseDatabaseUrl } from "@/lib/db-url";
import { isEvalOrgMetadata } from "@/lib/org-meta";

describe("parseDatabaseUrl", () => {
  it("reads the schema and strips Prisma-only params", () => {
    const { connectionString, schema } = parseDatabaseUrl(
      "postgresql://u:p@db:5432/app?schema=documind_dev&connection_limit=5&pool_timeout=10&sslmode=require",
    );
    expect(schema).toBe("documind_dev");
    expect(connectionString).toBe("postgresql://u:p@db:5432/app?sslmode=require");
  });

  it("rejects an unsafe schema name", () => {
    expect(() => parseDatabaseUrl("postgresql://db/app?schema=x;drop")).toThrow(/Invalid schema/);
  });
});

describe("schemas", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers OFFICE_AUTH_SCHEMA over the URL's schema", () => {
    vi.stubEnv("OFFICE_AUTH_SCHEMA", "documind");
    expect(authSchema("documind_dev")).toBe("documind");
    vi.stubEnv("OFFICE_AUTH_SCHEMA", "");
    expect(authSchema("documind_dev")).toBe("documind_dev");
  });

  it("requires a valid OFFICE_DB_SCHEMA", () => {
    expect(officeSchema("documind_office_dev")).toBe("documind_office_dev");
    expect(() => officeSchema("")).toThrow(/not set/);
    expect(() => officeSchema('office"; drop')).toThrow(/Invalid/);
    expect(() => officeSchema("Office")).toThrow(/Invalid/);
  });
});

describe("account rules", () => {
  it("reads comma-separated admin roles", () => {
    expect(hasAdminRole("admin")).toBe(true);
    expect(hasAdminRole("user, admin")).toBe(true);
    expect(hasAdminRole("user")).toBe(false);
    expect(hasAdminRole(null)).toBe(false);
  });

  it("honours ban expiry", () => {
    expect(isBanned(false, null)).toBe(false);
    expect(isBanned(true, null)).toBe(true);
    expect(isBanned(true, new Date(Date.now() + 60_000))).toBe(true);
    expect(isBanned(true, new Date(Date.now() - 60_000).toISOString())).toBe(false);
  });
});

describe("upstreamPath", () => {
  it("re-encodes each segment", () => {
    expect(upstreamPath(["orgs", "abc", "documents", "d 1", "file"])).toBe("orgs/abc/documents/d%201/file");
    expect(upstreamPath(["me", "quota?x=1"])).toBe("me/quota%3Fx%3D1");
    expect(upstreamPath(["a/b"])).toBe("a%2Fb");
  });

  it("refuses dot and empty segments", () => {
    expect(upstreamPath(["orgs", "..", "admin"])).toBeNull();
    expect(upstreamPath(["."])).toBeNull();
    expect(upstreamPath(["orgs", ""])).toBeNull();
    expect(upstreamPath([])).toBeNull();
  });

  it("matches only the chat endpoint", () => {
    expect(CHAT_PATH.test("orgs/abc/chat")).toBe(true);
    expect(CHAT_PATH.test("orgs/abc/chat/x")).toBe(false);
    expect(CHAT_PATH.test("orgs/abc/conversations")).toBe(false);
  });
});

describe("isEvalOrgMetadata", () => {
  it("flags only an explicit eval: true", () => {
    expect(isEvalOrgMetadata('{"eval": true}')).toBe(true);
    expect(isEvalOrgMetadata('{"eval": "true"}')).toBe(false);
    expect(isEvalOrgMetadata("{}")).toBe(false);
    expect(isEvalOrgMetadata(null)).toBe(false);
    expect(isEvalOrgMetadata("not json")).toBe(false);
    expect(isEvalOrgMetadata("null")).toBe(false);
  });
});

describe("sign-in helpers", () => {
  it("keeps only same-origin relative paths", () => {
    expect(safeNext("/acme")).toBe("/acme");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });

  it("explains a banned account and an unverified email", () => {
    expect(signInErrorMessage("ACCOUNT_BANNED")).toMatch(/suspended/);
    expect(signInErrorMessage("EMAIL_NOT_VERIFIED")).toMatch(/Verify it in DocuMind/);
    expect(signInErrorMessage(null)).toBeNull();
  });
});
