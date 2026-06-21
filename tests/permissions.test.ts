import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPath, isInsideRoot, parsePermissions, readAllowedFile, redactSecrets } from "../src/core/permissions.js";
import { defaultPermissionsMarkdown } from "../src/core/project-card.js";

describe("permissions", () => {
  it("classifies visible, ask-first and hidden paths", () => {
    const policy = parsePermissions(defaultPermissionsMarkdown());

    expect(classifyPath("README.md", policy)).toBe("visible");
    expect(classifyPath("src/auth/session.ts", policy)).toBe("ask-first");
    expect(classifyPath(".env.local", policy)).toBe("hidden");
    expect(classifyPath("src/billing/invoice.ts", policy)).toBe("hidden");
  });

  it("redacts secret-like environment values", () => {
    expect(redactSecrets("API_TOKEN=abc123\nPUBLIC_URL=https://example.com", [])).toContain("API_TOKEN=[REDACTED]");
  });

  it("only reads visible files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentroom-permissions-"));
    try {
      await writeFile(path.join(root, "README.md"), "TOKEN=value\nSafe text", "utf8");
      const policy = parsePermissions(defaultPermissionsMarkdown());
      await expect(readAllowedFile(root, "README.md", policy)).resolves.toContain("TOKEN=[REDACTED]");
      await expect(readAllowedFile(root, ".env", policy)).rejects.toThrow(/not visible/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses path-relative root containment instead of prefix matching", () => {
    expect(isInsideRoot("/tmp/project", "/tmp/project/docs/readme.md")).toBe(true);
    expect(isInsideRoot("/tmp/project", "/tmp/project-neighbor/README.md")).toBe(false);
  });

  it("rejects visible symlinks that escape the root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentroom-symlink-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "agentroom-symlink-outside-"));
    try {
      await mkdir(path.join(root, "docs"));
      await writeFile(path.join(outside, "secret.md"), "TOKEN=outside", "utf8");
      await symlink(path.join(outside, "secret.md"), path.join(root, "docs", "linked.md"));
      const policy = parsePermissions(defaultPermissionsMarkdown());
      await expect(readAllowedFile(root, "docs/linked.md", policy)).rejects.toThrow(/escapes/);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
