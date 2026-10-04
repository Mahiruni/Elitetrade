// Isolated two-session browser verification against the real SQLite adapter. All identities are fixtures.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "../src/app.mjs";
import { openDatabase } from "../src/database.mjs";
import { digest, hashPassword } from "../src/security.mjs";
const require = createRequire(import.meta.url),
  { chromium } = require(
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright",
  );
const db = openDatabase(":memory:"),
  folder = mkdtempSync(join(tmpdir(), "elite-support-browser-")),
  base = "http://127.0.0.1:4395";
const app = createApplication({
  db,
  key: randomBytes(32),
  gateway: null,
  mailer: null,
  env: { APP_ORIGIN: base, SUPPORT_FILES_PATH: folder },
});
await new Promise((r) => app.server.listen(4395, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),
  args: ["--no-sandbox"],
});
mkdirSync("test-results", { recursive: true });
const contexts = [],
  errors = [];
async function session(name, role) {
  const uid = randomUUID(),
    token = randomUUID(),
    csrf = randomUUID();
  db.prepare(
    "INSERT INTO users(id,email,name,password_hash,role,referral_code,created_at) VALUES(?,?,?,?,?,?,?)",
  ).run(
    uid,
    `${name}@example.test`,
    name,
    await hashPassword("Support fixture password!"),
    role,
    randomUUID(),
    Date.now(),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)").run(
    digest(token),
    uid,
    csrf,
    1,
    Date.now() + 86400000,
    Date.now(),
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  contexts.push(context);
  await context.addCookies([
    { name: "elite_session", value: token, url: base },
  ]);
  await context.addInitScript(() =>
    localStorage.setItem(
      "elite-supabase-session",
      JSON.stringify({
        access_token: "isolated-browser-fixture",
        expires_at: Date.now() / 1000 + 3600,
      }),
    ),
  );
  await context.route("**/api/**", async (route) => {
    if (route.request().method() === "GET") return route.continue();
    const r = await route.fetch({
      headers: { ...route.request().headers(), "x-csrf-token": csrf },
    });
    return route.fulfill({ response: r });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return { page, context, uid };
}
async function waitWorkspace(page, path) {
  await page.goto(base + path);
  await page.locator(".support-workspace").waitFor();
  await page.locator("#app-opening").waitFor({ state: "hidden" });
}
const customer = await session("QA customer", "user"),
  admin = await session("QA agent", "admin");
try {
  await waitWorkspace(customer.page, "/support");
  await customer.page.locator(".support-list-empty").waitFor();
  await customer.page.screenshot({
    path: "test-results/support-redesign-empty.png",
    animations: "disabled",
  });
  await customer.page.locator('[data-chat="new"]').first().click();
  await customer.page.locator("#modal select").selectOption("MT5 connection");
  await customer.page.locator('#modal button[type="submit"]').click();
  await customer.page.locator("[data-composer]").waitFor();
  await customer.page
    .locator("[data-composer]")
    .fill("Isolated fixture: my MT5 connection needs attention.");
  await customer.page.locator('[data-compose] [type="submit"]').click();
  await customer.page
    .locator("[data-timeline]")
    .getByText("Isolated fixture: my MT5 connection needs attention.", {
      exact: true,
    })
    .waitFor();
  await waitWorkspace(admin.page, "/admin/support");
  await admin.page.locator("[data-composer]").waitFor();
  assert.equal(await admin.page.locator(".support-unread-divider").count(), 1);
  await admin.page.locator('[data-chat="details"]').first().click();
  await admin.page
    .locator('[data-support-setting="assigned_to"]')
    .selectOption(admin.uid);
  await customer.page
    .locator(".support-participant h2")
    .filter({ hasText: "QA agent" })
    .waitFor({ timeout: 12000 });
  await admin.page.locator('[data-chat="details"]').last().click();
  await admin.page
    .locator("[data-composer]")
    .fill(
      "I am checking the error with you. Please keep your passwords private.",
    );
  await customer.page
    .locator("[data-typing]:not([hidden])")
    .waitFor({ timeout: 10000 });
  await admin.page.locator('[data-compose] [type="submit"]').click();
  await customer.page
    .locator("[data-timeline]")
    .getByText(
      "I am checking the error with you. Please keep your passwords private.",
      { exact: true },
    )
    .waitFor({ timeout: 10000 });
  await admin.page
    .locator("[data-receipt]")
    .filter({ hasText: "Read" })
    .waitFor({ timeout: 10000 });
  await admin.page.locator('[data-chat="note"]').first().click();
  await admin.page.locator("[data-composer]").fill("PRIVATE fixture note");
  await admin.page.locator('[data-compose] [type="submit"]').click();
  await admin.page.locator('[data-chat="details"]').first().click();
  await admin.page
    .locator(".support-notes")
    .getByText("PRIVATE fixture note", { exact: true })
    .waitFor();
  assert.equal(
    await customer.page
      .getByText("PRIVATE fixture note", { exact: true })
      .count(),
    0,
  );
  await admin.page.locator('[data-chat="details"]').last().click();
  await admin.page.locator('[data-chat="note"]').first().click();
  await customer.page
    .locator("[data-files]")
    .setInputFiles({
      name: "fixture.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Private fixture attachment"),
    });
  await customer.page.locator(".support-upload.ready").waitFor();
  await customer.page.locator("[data-composer]").fill("Document attached.");
  await customer.page.locator('[data-compose] [type="submit"]').click();
  await admin.page
    .getByText("fixture.txt", { exact: true })
    .waitFor({ timeout: 10000 });
  await customer.page
    .locator("[data-files]")
    .setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRuoAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await customer.page.locator(".support-upload.ready").waitFor();
  await customer.page.locator('[data-compose] [type="submit"]').click();
  await customer.page
    .locator('[data-chat="file"][data-name="fixture.png"]')
    .click();
  await customer.page.locator("#modal .support-image-viewer").waitFor();
  await customer.page.keyboard.press("Escape");
  await customer.page.locator("#modal").waitFor({ state: "hidden" });
  await customer.page.locator("[data-composer]").fill("fuck");
  await customer.page.locator('[data-compose] [type="submit"]').click();
  await customer.page
    .locator("[data-chat-error]")
    .filter({ hasText: "blocked word" })
    .waitFor();
  assert.equal(
    await customer.page.locator("[data-composer]").inputValue(),
    "fuck",
  );
  await customer.page
    .locator("[data-composer]")
    .fill("Draft survives navigation.");
  await customer.page.goto(base + "/account");
  await waitWorkspace(customer.page, "/support");
  await customer.page.locator("[data-composer]").waitFor();
  assert.equal(
    await customer.page.locator("[data-composer]").inputValue(),
    "Draft survives navigation.",
  );
  await customer.context.setOffline(true);
  await customer.page.locator("[data-sync]:not([hidden])").waitFor();
  assert.equal(
    await customer.page.locator("[data-composer]").inputValue(),
    "Draft survives navigation.",
  );
  await customer.context.setOffline(false);
  await customer.page
    .locator("[data-sync]")
    .waitFor({ state: "hidden", timeout: 15000 });
  for (const theme of ["dark", "light"])
    for (const width of [360, 390, 768, 1440]) {
      await customer.page.setViewportSize({ width, height: 900 });
      await customer.page.evaluate(
        (t) => document.body.classList.toggle("light", t === "light"),
        theme,
      );
      await customer.page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        );
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        document.querySelector("#toast")?.classList.remove("visible");
      });
      const result = await customer.page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        composer: document
          .querySelector("[data-compose]")
          .getBoundingClientRect().bottom,
        nav: document.querySelector(".bottom-nav").getBoundingClientRect().top,
        navVisible:
          getComputedStyle(document.querySelector(".bottom-nav")).display !==
          "none",
      }));
      assert.equal(
        result.overflow,
        false,
        `horizontal overflow ${width} ${theme}`,
      );
      if (result.navVisible)
        assert.ok(
          result.composer <= result.nav + 1,
          `composer overlap ${width} ${theme}: ${JSON.stringify(result)}`,
        );
      await customer.page.screenshot({
        path: `test-results/support-${theme}-${width}.png`,
        animations: "disabled",
      });
    }
  await customer.page.setViewportSize({ width: 390, height: 900 });
  await customer.page.locator('[data-chat="back"]').click();
  await customer.page.locator(".support-thread").first().click();
  await customer.page.locator("[data-composer]").waitFor();
  await customer.page.locator("[data-composer]").fill("x".repeat(20000));
  assert.equal(
    await customer.page.locator("[data-counter]").textContent(),
    "20,000 / 20,000",
  );
  await customer.page.locator('[data-chat="expand"]').click();
  await customer.page.screenshot({
    path: "test-results/support-long-mobile.png",
  });

  // Failure recovery sends the same client ID and never inserts a false successful bubble.
  await customer.page
    .locator("[data-composer]")
    .fill("QA fixture: retry after a temporary failure.");
  let failOnce = true;
  const clientIds = [];
  await customer.context.route(
    "**/api/support/workspace/*/send",
    async (route) => {
      clientIds.push(route.request().postDataJSON().clientId);
      if (failOnce) {
        failOnce = false;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "QA fixture: temporary interruption.",
          }),
        });
      }
      return route.fallback();
    },
  );
  await customer.page.locator('[data-compose] [type="submit"]').click();
  await customer.page.locator("[data-retry]:not([hidden])").waitFor();
  assert.equal(
    await customer.page.locator("[data-composer]").inputValue(),
    "QA fixture: retry after a temporary failure.",
  );
  assert.equal(
    await customer.page
      .locator("[data-timeline]")
      .getByText("QA fixture: retry after a temporary failure.", {
        exact: true,
      })
      .count(),
    0,
  );
  await customer.page.locator('[data-chat="retry-send"]').click();
  await customer.page
    .locator("[data-timeline]")
    .getByText("QA fixture: retry after a temporary failure.", { exact: true })
    .waitFor();
  assert.equal(clientIds.length, 2);
  assert.equal(clientIds[0], clientIds[1]);
  await customer.page.waitForFunction(
    () =>
      !document
        .querySelector('[data-compose] [type="submit"]')
        .getAttribute("aria-busy") ||
      document
        .querySelector('[data-compose] [type="submit"]')
        .getAttribute("aria-busy") === "false",
  );
  await customer.context.unroute("**/api/support/workspace/*/send");
  // Mobile sheets are native dialogs with working actions, keyboard dismissal, and focus return.
  await customer.page.locator('[data-chat="attach"]').click();
  await customer.page.locator("#modal[data-support-modal]").waitFor();
  await customer.page.screenshot({
    path: "test-results/support-redesign-attachment-sheet.png",
    animations: "disabled",
  });
  const sheet = await customer.page.locator("#modal").boundingBox();
  assert.ok(
    sheet.x <= 1 && sheet.width >= 389,
    "attachment sheet is edge to edge",
  );
  const chooser = customer.page.waitForEvent("filechooser");
  await customer.page.locator('#modal [data-chat="choose-files"]').click();
  await (
    await chooser
  ).setFiles([
    {
      name: "QA-fixture-account-connection-diagnostics-with-a-long-name.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("QA fixture only"),
    },
    {
      name: "QA-fixture-settings.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,value\nrisk,1"),
    },
  ]);
  await customer.page.locator(".support-upload.ready").nth(1).waitFor();
  assert.equal(await customer.page.locator(".support-upload.ready").count(), 2);
  await customer.page.locator('[data-chat="remove-file"]').first().click();
  await customer.page.waitForFunction(
    () => document.querySelectorAll(".support-upload").length === 1,
  );
  await customer.page.locator('[data-chat="remove-file"]').first().click();
  await customer.page.waitForFunction(
    () => document.querySelectorAll(".support-upload").length === 0,
  );
  await customer.page
    .locator("[data-files]")
    .setInputFiles({
      name: "QA-fixture-disallowed-html.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("<html><script>alert(1)</script></html>"),
    });
  await customer.page.locator(".support-upload.failed").waitFor();
  assert.equal(
    await customer.page.locator('[data-compose] [type="submit"]').isDisabled(),
    true,
  );
  await customer.page.locator('[data-chat="remove-file"]').click();
  await customer.page.locator('[data-chat="actions"]').click();
  await customer.page.locator('#modal [data-chat="toggle-search"]').click();
  await customer.page
    .locator("[data-message-search]")
    .fill("QA fixture: retry");
  await customer.page
    .locator("[data-search-results]")
    .filter({ hasText: "1 matches" })
    .waitFor();
  assert.equal(await customer.page.locator(".support-match").count(), 1);
  await customer.page.locator('[data-chat="close-search"]').click();
  await customer.page.locator('[data-chat="actions"]').click();
  await customer.page.locator('#modal [data-chat="details"]').click();
  await customer.page.locator("#modal .support-details-sheet").waitFor();
  await customer.page.keyboard.press("Escape");
  await customer.page.locator("#modal").waitFor({ state: "hidden" });
  await customer.page.waitForFunction(
    () =>
      !document
        .querySelector(".support-workspace")
        .classList.contains("show-details"),
  );
  await admin.page.locator('[data-chat="replies"]').click();
  await admin.page.locator('#modal [data-chat="insert-reply"]').first().click();
  assert.ok(
    (await admin.page.locator("[data-composer]").inputValue()).length > 10,
  );
  await admin.page.locator("[data-composer]").fill("");
  // Clearly identified fixtures exercise pagination, real-length names, date grouping, and scroll anchoring.
  const cid = db
    .prepare("SELECT id FROM conversations WHERE user_id=?")
    .get(customer.uid).id;
  db.prepare("UPDATE users SET name=? WHERE id=?").run(
    "QA agent Alexandra Montgomery — Technical Support",
    admin.uid,
  );
  db.prepare("UPDATE conversations SET name=? WHERE id=?").run(
    "QA customer Christopher Alexander Montgomery Wellington",
    cid,
  );
  const seedTime = Date.now() - 86400000 * 3;
  for (let i = 0; i < 85; i++)
    db.prepare("INSERT INTO messages VALUES(?,?,?,?,?)").run(
      randomUUID(),
      cid,
      i % 3 === 0 ? "admin" : "customer",
      `QA history fixture ${i}: ${i % 3 === 0 ? "We can review the connection details together." : "The connection paused after I updated my account settings. Please help me check the error."}\n${i % 13 === 0 ? "https://example.invalid/diagnostics/" + "long-path-".repeat(12) : ""}`,
      seedTime + i * 60000,
    );
  db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(
    Date.now(),
    cid,
  );
  await customer.page.setViewportSize({ width: 1440, height: 900 });
  await waitWorkspace(customer.page, "/support");
  await customer.page.locator("[data-composer]").waitFor();
  await customer.page
    .locator("[data-timeline]")
    .getByText(/QA history fixture 84:/)
    .waitFor();
  assert.ok(
    (await customer.page.locator(".support-date-separator").count()) > 0,
  );
  assert.ok(
    (await customer.page.locator(".support-message.grouped").count()) > 0,
  );
  await customer.page
    .locator("[data-timeline]")
    .evaluate((el) => (el.scrollTop = 180));
  const anchor = await customer.page
    .locator("[data-timeline]")
    .evaluate((el) => {
      const m = [...el.querySelectorAll("[data-message-id]")].find(
        (m) =>
          m.getBoundingClientRect().bottom > el.getBoundingClientRect().top,
      );
      return { id: m.dataset.messageId, top: m.getBoundingClientRect().top };
    });
  await customer.page.locator('[data-chat="earlier"]').click();
  await customer.page.waitForFunction(
    () => document.querySelectorAll("[data-message-id]").length > 60,
  );
  const after = await customer.page
    .locator(`[data-message-id="${anchor.id}"]`)
    .boundingBox();
  assert.ok(
    Math.abs(after.y - anchor.top) < 2,
    "loading older messages keeps visible message in place",
  );
  db.prepare("INSERT INTO messages VALUES(?,?,?,?,?)").run(
    randomUUID(),
    cid,
    "admin",
    "QA fixture: new message while reading earlier history.",
    Date.now(),
  );
  await customer.page
    .locator("[data-timeline]")
    .getByText("QA fixture: new message while reading earlier history.", {
      exact: true,
    })
    .waitFor({ timeout: 10000 });
  const still = await customer.page
    .locator(`[data-message-id="${anchor.id}"]`)
    .boundingBox();
  assert.ok(
    Math.abs(still.y - anchor.top) < 2,
    "new message does not move earlier readers",
  );
  await customer.page
    .locator("[data-jump]")
    .filter({ hasText: "1 new" })
    .waitFor();
  await customer.page.locator("[data-jump]").click();
  await customer.page.waitForFunction(() => {
    const t = document.querySelector("[data-timeline]");
    return t.scrollHeight - t.scrollTop - t.clientHeight < 2;
  });
  // Role/theme/width matrix includes the actual administrator panel and phone inbox navigation.
  for (const person of [customer, admin])
    for (const theme of ["dark", "light"])
      for (const width of [360, 390, 768, 1440]) {
        const page = person.page;
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(
          (t) => document.body.classList.toggle("light", t === "light"),
          theme,
        );
        if (
          width <= 390 &&
          !(await page.locator(".support-workspace.has-chat").count())
        ) {
          await page.locator(".support-thread").first().click();
          await page.locator("[data-composer]").waitFor();
        }
        await page.locator("[data-composer]").fill("");
        await page
          .locator("[data-timeline]")
          .evaluate((el) => (el.scrollTop = el.scrollHeight));
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            document
              .getAnimations()
              .filter((a) => a.effect?.getTiming().iterations !== Infinity)
              .map((a) => a.finished.catch(() => {})),
          );
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
          document.querySelector("#toast")?.classList.remove("visible");
        });
        const bounds = await page.evaluate(() => {
          const t = document.querySelector("[data-timeline]"),
            f = document.querySelector("[data-compose]"),
            nav = document.querySelector(".bottom-nav"),
            button = f.querySelector('[type="submit"]');
          return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            timeline: t.getBoundingClientRect().height,
            composer: f.getBoundingClientRect().bottom,
            nav: nav.getBoundingClientRect().top,
            navVisible: getComputedStyle(nav).display !== "none",
            buttonBackground: getComputedStyle(button).backgroundColor,
            gold: getComputedStyle(document.querySelector(".support-workspace"))
              .getPropertyValue("--chat-gold")
              .trim(),
          };
        });
        assert.equal(
          bounds.overflow,
          false,
          `${person === customer ? "customer" : "admin"} overflow ${width} ${theme}`,
        );
        assert.ok(bounds.timeline > 150, "timeline remains readable");
        if (bounds.navVisible)
          assert.ok(
            bounds.composer <= bounds.nav + 1,
            `composer overlaps navigation ${width} ${theme}`,
          );
        await page.screenshot({
          path: `test-results/support-redesign-${person === customer ? "customer" : "admin"}-${theme}-${width}.png`,
          animations: "disabled",
        });
        if (width <= 390) {
          await page.locator('[data-chat="back"]').click();
          await page.locator(".support-inbox").waitFor();
          await page.screenshot({
            path: `test-results/support-redesign-${person === customer ? "customer" : "admin"}-inbox-${theme}-${width}.png`,
          });
          await page.locator(".support-thread").first().click();
          await page.locator("[data-composer]").waitFor();
        }
      }
  // Reset only the isolated fixture IP write budget after the intentionally rapid viewport/navigation matrix.
  db.prepare("DELETE FROM rate_limits WHERE key LIKE ?").run("write:%");
  await admin.page.setViewportSize({ width: 1440, height: 900 });
  await admin.page.locator('[data-chat="details"]').first().click();
  await admin.page.locator(".support-details-title").waitFor();
  await admin.page.screenshot({
    path: "test-results/support-redesign-admin-details.png",
    animations: "disabled",
  });
  await admin.page
    .locator('[data-support-setting="stage"]')
    .selectOption("resolved");
  await customer.page.bringToFront();
  await customer.page.locator(".support-resolved").waitFor({ timeout: 10000 });
  await customer.page.locator('[data-chat="reopen"]').click();
  await customer.page.locator("[data-composer]").waitFor({ timeout: 10000 });
  await customer.page.setViewportSize({ width: 390, height: 900 });
  await customer.page.locator("[data-composer]").fill("Phone typing");
  await customer.page.locator("[data-composer]").press("Enter");
  assert.equal(
    await customer.page.locator("[data-composer]").inputValue(),
    "Phone typing\n",
  );
  await customer.page.setViewportSize({ width: 1440, height: 900 });
  await customer.page.locator("[data-composer]").fill("Desktop typing");
  await customer.page.locator("[data-composer]").press("Shift+Enter");
  assert.equal(
    await customer.page.locator("[data-composer]").inputValue(),
    "Desktop typing\n",
  );
  await customer.page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await customer.page
      .locator(".support-composer")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  // Emulate the visual viewport shrink used by mobile browsers when the software keyboard opens.
  await customer.page.setViewportSize({ width: 390, height: 900 });
  await customer.page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      get: () => 480,
    });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  const keyboardBounds = await customer.page.evaluate(() => ({
    composer: document.querySelector("[data-compose]").getBoundingClientRect()
      .bottom,
    send: document
      .querySelector("[data-compose] [type=submit]")
      .getBoundingClientRect().bottom,
    navHidden: document
      .querySelector(".bottom-nav")
      .classList.contains("support-keyboard-hidden"),
  }));
  assert.ok(keyboardBounds.composer <= 480);
  assert.ok(keyboardBounds.send <= 480);
  assert.equal(keyboardBounds.navHidden, true);
  await customer.page.screenshot({
    path: "test-results/support-redesign-keyboard.png",
  });
  await customer.page.evaluate(() => {
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });

  // Return to a cached conversation without losing its draft or the earlier reading position.
  await customer.page.locator('[data-chat="expand"]').click();
  await customer.page
    .locator("[data-composer]")
    .fill("QA fixture: draft kept while switching conversations.");
  await customer.page
    .locator("[data-timeline]")
    .evaluate((el) => (el.scrollTop = 220));
  const savedScroll = await customer.page
    .locator("[data-timeline]")
    .evaluate((el) => el.scrollTop);
  await customer.page.locator('[data-chat="back"]').click();
  await customer.page
    .locator("[data-inbox-search]")
    .fill("no-matching-qa-fixture");
  await customer.page.locator('[data-chat="clear-filters"]').click();
  assert.ok((await customer.page.locator(".support-thread").count()) > 0);
  await customer.page.locator('[data-chat="new"]').first().click();
  await customer.page.locator("#modal select").selectOption("Bot settings");
  await customer.page.locator('#modal button[type="submit"]').click();
  await customer.page.locator("[data-composer]").waitFor();
  await customer.page
    .locator("[data-composer]")
    .fill("QA fixture: second draft.");
  await customer.page.locator('[data-chat="back"]').click();
  await customer.page.locator(`[data-chat="select"][data-id="${cid}"]`).click();
  await customer.page.waitForFunction(
    () =>
      document.querySelector("[data-composer]")?.value ===
      "QA fixture: draft kept while switching conversations.",
  );
  const restoredScroll = await customer.page
    .locator("[data-timeline]")
    .evaluate((el) => el.scrollTop);
  assert.ok(
    Math.abs(savedScroll - restoredScroll) < 2,
    "conversation switching preserves reading position",
  );
  // Cold-access errors offer a working retry and do not discard authentication.
  await customer.page.locator('[data-chat="back"]').click();
  let blockOnce = true;
  await customer.context.route("**/api/support/workspace/*", async (route) => {
    if (route.request().method() === "GET" && blockOnce) {
      blockOnce = false;
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: "QA fixture: conversation temporarily restricted.",
        }),
      });
    }
    return route.fallback();
  });
  await customer.page.reload();
  await customer.page.locator(".support-workspace").waitFor();
  await customer.page.locator(`[data-chat="select"][data-id="${cid}"]`).click();
  await customer.page.locator('[data-chat="retry-conversation"]').waitFor();
  await customer.page.locator('[data-chat="retry-conversation"]').click();
  await customer.page.locator("[data-composer]").waitFor();
  await customer.context.unroute("**/api/support/workspace/*");

  assert.deepEqual(errors, []);
  console.log(
    "Support redesign browser passed: both roles and all widths/themes, native sheets, retry IDs, history anchoring, search, quick replies, keyboard controls, viewport shrink, reduced motion;  two sessions, typing, replies, reads, notes, private document upload, moderation, drafts, offline recovery, 360/390/768/1440 both themes, no overflow/overlap.",
  );
} catch (e) {
  console.log("QA errors:", errors);
  console.log(
    "QA admin state:",
    (await admin.page.locator("body").innerText()).slice(-1800),
  );
  console.log(
    "QA database stage:",
    db
      .prepare(
        "SELECT value FROM support_state WHERE id IN (SELECT id FROM conversations)",
      )
      .all()
      .map((r) => JSON.parse(r.value).stage),
  );
  await customer.page.screenshot({
    path: "test-results/support-browser-failure.png",
  });
  console.log((await customer.page.locator("body").innerText()).slice(-6000));
  throw e;
} finally {
  for (const c of contexts) await c.close();
  await browser.close();
  await app.close();
  db.close();
  rmSync(folder, { recursive: true, force: true });
}
