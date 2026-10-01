#!/usr/bin/env node

// src/index.ts
import * as p from "@clack/prompts";
import { downloadTemplate } from "giget";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { join, resolve, basename } from "path";
var REPO = "github:NuxFlow/NuxFlow";
var DOCS_URL = "https://nuxflow.dev/docs";
var GITHUB_URL = "https://github.com/NuxFlow/NuxFlow";
function generateSecret() {
  const bytes = new Uint8Array(48);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}
function buildEnv(template, secret, siteUrl) {
  return template.replace(
    /NUXT_BETTER_AUTH_SECRET=.*/,
    `NUXT_BETTER_AUTH_SECRET=${secret}`
  ).replace(
    /NUXT_PUBLIC_SITE_URL=.*/,
    `NUXT_PUBLIC_SITE_URL=${siteUrl}`
  );
}
function hasPnpm() {
  try {
    execSync("pnpm --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
async function main() {
  console.log();
  p.intro("create-nuxflow-app  \u2014  Edge-native CMS on Nuxt 4 + Cloudflare Workers");
  const dir = await p.text({
    message: "Where should we create your project?",
    placeholder: "./my-nuxflow-site",
    validate(value) {
      if (!value.trim()) return "Please enter a directory name";
      if (existsSync(resolve(value))) return `"${value}" already exists \u2014 choose a different name`;
    }
  });
  if (p.isCancel(dir)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  const targetDir = resolve(dir);
  const projectName = basename(targetDir);
  const siteUrl = await p.text({
    message: "What will your production site URL be?",
    placeholder: "https://yourdomain.com",
    defaultValue: "https://yourdomain.com",
    validate(value) {
      if (!value.trim()) return "Please enter a URL";
      try {
        new URL(value);
      } catch {
        return "Must be a valid URL (e.g. https://yourdomain.com)";
      }
    }
  });
  if (p.isCancel(siteUrl)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  const pnpmAvailable = hasPnpm();
  const installDeps = pnpmAvailable ? await p.confirm({
    message: "Install dependencies now?",
    initialValue: true
  }) : false;
  if (p.isCancel(installDeps)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
  const s = p.spinner();
  s.start("Downloading NuxFlow...");
  try {
    await downloadTemplate(REPO, { dir: targetDir, preferOffline: false });
  } catch (err) {
    s.stop("Download failed");
    p.cancel(`Could not download template: ${err.message}

Check your internet connection and try again.`);
    process.exit(1);
  }
  s.stop("Downloaded NuxFlow");
  const appDir = join(targetDir, "apps", "nuxflow");
  const wranglerExample = join(appDir, "wrangler.toml.example");
  const wranglerDest = join(appDir, "wrangler.toml");
  if (existsSync(wranglerExample) && !existsSync(wranglerDest)) {
    writeFileSync(wranglerDest, readFileSync(wranglerExample, "utf8"));
  }
  const envExample = join(appDir, ".env.example");
  const envDest = join(appDir, ".env");
  if (existsSync(envExample) && !existsSync(envDest)) {
    const secret = generateSecret();
    const envContent = buildEnv(readFileSync(envExample, "utf8"), secret, siteUrl);
    writeFileSync(envDest, envContent);
  }
  if (installDeps) {
    p.log.step("Installing dependencies \u2014 this takes a minute on first install...");
    try {
      execSync("pnpm install", { cwd: targetDir, stdio: "inherit" });
      p.log.success("Dependencies installed");
    } catch {
      p.log.warn("pnpm install failed \u2014 run it manually after setup");
    }
  } else if (!pnpmAvailable) {
    p.note("pnpm was not found. Install it with:\n  npm install -g pnpm\nThen run pnpm install inside your project.", "pnpm required");
  }
  const relDir = dir;
  const installNote = installDeps ? "" : `
  pnpm install
`;
  p.note(
    [
      `  cd ${relDir}`,
      installNote,
      "  # Try it locally (a local database is created for you):",
      "  cd apps/nuxflow",
      "  pnpm exec wrangler dev",
      "  # \u2192 Visit http://localhost:8787/setup to finish setup",
      "",
      "  # Go live on Cloudflare \u2014 create the D1 database, KV namespace and",
      "  # R2 bucket, deploy, then add the auth secret. Step by step:",
      `  #   ${DOCS_URL}`,
      "  # (The .env created here is for local development only.)"
    ].filter((line) => line !== void 0).join("\n"),
    "Next steps"
  );
  p.outro(
    `${projectName} is ready!

  Docs   ${DOCS_URL}
  GitHub ${GITHUB_URL}`
  );
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
