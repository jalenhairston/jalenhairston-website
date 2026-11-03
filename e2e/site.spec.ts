import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const routes = ["/", "/about", "/resume"];

const inViewport = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  const vp = page.viewportSize()!;
  return !!box && box.y >= 0 && box.y + box.height <= vp.height && box.x >= 0 && box.x + box.width <= vp.width;
};
const hasHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test.describe("home (US1, US2)", () => {
  test("name, headshot, pitch and contact links are above the fold at 1280x800", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator("h1")).toHaveText("Jane Sample");
    await expect(page.locator("main img").first()).toHaveAttribute("alt", /.+/);
    for (const sel of ["h1", "main img", "main h1 + p", 'a[href^="mailto:"]', 'a:has-text("LinkedIn")', 'a:has-text("GitHub")']) {
      expect(await inViewport(page, sel), `${sel} above the fold`).toBe(true);
    }
  });

  test("name, pitch and headshot are visible at 375x812 with no horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    for (const sel of ["h1", "main img", "main h1 + p"]) expect(await inViewport(page, sel), sel).toBe(true);
    expect(await hasHorizontalScroll(page)).toBe(false);
  });

  test("external contact links are safe and labelled", async ({ page }) => {
    await page.goto("/");
    const contact = page.getByRole("list", { name: "Contact" }).first();
    await expect(contact.getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:jane.sample@example.com");
    for (const name of [/LinkedIn/, /GitHub/]) {
      const link = contact.getByRole("link", { name });
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(link).toHaveAttribute("target", "_blank");
    }
  });

  test("highlight rows link to About and Resume, and featured projects show at most 3", async ({ page }) => {
    await page.goto("/");
    const highlights = page.getByRole("region", { name: "Highlights" });
    await expect(highlights.getByRole("link")).toHaveCount(2);
    await highlights.getByRole("link", { name: /about/i }).click();
    await expect(page).toHaveURL("/about");
    await page.goto("/");
    const cards = page.getByRole("region", { name: "Featured projects" }).getByRole("listitem").filter({ has: page.locator("h3") });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(3);
  });

  test("highlight rows alternate sides at >= 768px and stack below", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const rows = page.getByRole("region", { name: "Highlights" }).locator(":scope > div");
    const visualX = async (i: number) => (await rows.nth(i).locator(":scope > div").first().boundingBox())!.x;
    const textX = async (i: number) => (await rows.nth(i).locator(":scope > div").nth(1).boundingBox())!.x;
    expect(await visualX(0)).toBeLessThan(await textX(0));
    expect(await visualX(1)).toBeGreaterThan(await textX(1));
    await page.setViewportSize({ width: 375, height: 812 });
    expect(Math.abs((await visualX(0)) - (await textX(0)))).toBeLessThan(2);
  });
});

test.describe("about (US3)", () => {
  test("roles are reverse-chronological with Present for the current role", async ({ page }) => {
    await page.goto("/about");
    const roles = page.locator('[id^="role-"]');
    await expect(roles).toHaveCount(2);
    await expect(roles.first()).toHaveId("role-sample-staff-engineer");
    await expect(roles.first()).toContainText("– Present");
    await expect(roles.nth(1)).toContainText("Jun 2016 – Feb 2022");
  });

  test("role anchors scroll into view", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto("/about#role-sample-software-engineer");
    await expect(page.locator("#role-sample-software-engineer")).toBeInViewport();
  });

  test("selected work shows labelled STAR sections, anchor id and the story's role", async ({ page }) => {
    await page.goto("/about");
    const story = page.locator("#story-sample-migration-story");
    await expect(story).toBeVisible();
    for (const label of ["Situation", "Task", "Action", "Result"]) await expect(story.locator("dt", { hasText: label })).toBeVisible();
    await expect(story).toContainText("Senior Sample Engineer · Sample Company Inc.");
  });
});

test.describe("resume (US4)", () => {
  test("renders header, experience, skills by category and education", async ({ page }) => {
    await page.goto("/resume");
    await expect(page.locator("h1")).toHaveText("Jane Sample");
    await expect(page.locator("#experience li").first()).toContainText("Senior Sample Engineer");
    await expect(page.locator("#skills dt", { hasText: "Languages" })).toBeVisible();
    await expect(page.locator("#skills dd").first()).toContainText("TypeScript");
    await expect(page.locator("#education")).toContainText("Sample State University");
  });

  test("no Download PDF button when profile.resumePdf is absent", async ({ page }) => {
    await page.goto("/resume");
    await expect(page.getByRole("link", { name: "Download PDF" })).toHaveCount(0);
  });

  test("print hides site chrome but keeps contact info", async ({ page }) => {
    await page.goto("/resume");
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("body > header")).toBeHidden();
    await expect(page.locator("body > footer")).toBeHidden();
    await expect(page.getByRole("button", { name: "Menu" })).toBeHidden();
    await expect(page.getByRole("list", { name: "Contact" })).toBeVisible();
  });
});

test.describe("menu pill (US5)", () => {
  test("opens with the keyboard, marks the current page, and closes with Escape returning focus", async ({ page }) => {
    await page.goto("/about");
    const button = page.getByRole("button", { name: "Menu" });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    const panelId = await button.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const nav = page.locator(`[id="${panelId}"]`);
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "About" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("Space toggles it and choosing a link navigates and closes it", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: "Menu" });
    await button.focus();
    await page.keyboard.press("Space");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Resume" }).click();
    await expect(page).toHaveURL("/resume");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("main")).toBeFocused();
  });

  test("clicking outside closes it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.locator("h1").click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  });
});

test.describe("site-wide (US7, US8, US9, NFRs)", () => {
  for (const route of routes) {
    test(`${route}: no axe WCAG 2.2 AA violations`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });

    test(`${route}: noindex while sample content exists, unique title, description, OG`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /.+/);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /.+/);
    });

    test(`${route}: no horizontal scroll at 375px`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(route);
      expect(await hasHorizontalScroll(page)).toBe(false);
    });
  }

  test("titles are unique per route", async ({ page }) => {
    const titles = new Set<string>();
    for (const route of routes) {
      await page.goto(route);
      titles.add(await page.title());
    }
    expect(titles.size).toBe(routes.length);
  });

  test("skip link moves focus to main content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  test("main reserves bottom space for the ask bar and the slot renders nothing", async ({ page }) => {
    await page.goto("/");
    const padding = await page.locator("main").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    expect(padding).toBeGreaterThanOrEqual(72);
    // Nothing is rendered after the footer except framework/analytics scripts.
    const visibleAfterFooter = await page.evaluate(() => {
      const footer = document.querySelector("body > footer")!;
      let n = footer.nextElementSibling;
      const out: string[] = [];
      while (n) {
        if (!["SCRIPT", "NEXT-ROUTE-ANNOUNCER", "TEMPLATE", "LINK", "STYLE"].includes(n.tagName) && (n as HTMLElement).offsetHeight > 0) out.push(n.tagName);
        n = n.nextElementSibling;
      }
      return out;
    });
    expect(visibleAfterFooter).toEqual([]);
  });

  test("Vercel Analytics is mounted", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('script[src*="/_vercel/insights/script.js"], script[src*="va.vercel-scripts.com"]')).toHaveCount(1);
  });

  test("unknown path returns a styled 404 with a link home", async ({ page }) => {
    const res = await page.goto("/definitely-not-a-page");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back home" })).toHaveAttribute("href", "/");
  });
});

test.describe("things-to-do map (POC)", () => {
  test("selecting a pin opens a sheet with TikTok-first, new-tab links, no horizontal scroll at 375x812", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // Stub the third-party basemap style so the test is deterministic and offline-safe.
    await page.route("https://tiles.openfreemap.org/**", (route) =>
      route.fulfill({
        json: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#dbe4ee" } }] },
      }),
    );
    await page.goto("/map");
    const sheet = page.getByRole("region", { name: "Neptune Oyster" });
    // Wait for the map to be up (clusters drawn) before selecting.
    await expect(page.locator('button[aria-label$="places, zoom in"]').first()).toBeVisible();
    // Select via the hidden list (flies the map in), then tap the now-separate pin itself.
    await page.getByRole("button", { name: "Neptune Oyster, Boston (food)" }).dispatchEvent("click");
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(async () => {
      await page.locator('button[aria-label="Neptune Oyster, Boston"]').click({ force: true, timeout: 1000 });
      await expect(sheet).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    // TikTok search is listed first and opens in a new tab.
    const search = sheet.getByRole("link", { name: /^TikTok/ }).first();
    await expect(search).toHaveText(/TikTok/);
    await expect(search).toHaveAttribute("href", "https://www.tiktok.com/search?q=Neptune%20Oyster%20Boston");
    await expect(search).toHaveAttribute("target", "_blank");
    await expect(search).toHaveAttribute("rel", "noopener noreferrer");
    // Instagram hashtag search sits after the TikTok links, also in a new tab.
    const insta = sheet.getByRole("link", { name: /^Instagram/ }).first();
    await expect(insta).toHaveAttribute("href", "https://www.instagram.com/explore/tags/neptuneoyster/");
    await expect(insta).toHaveAttribute("target", "_blank");
    expect(await hasHorizontalScroll(page)).toBe(false);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("dense areas show count clusters that zoom in to individual pins", async ({ page }) => {
    await page.route("https://tiles.openfreemap.org/**", (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#dbe4ee" } }] } }),
    );
    await page.goto("/map");
    const clusters = page.locator('button[aria-label$="places, zoom in"]');
    await expect(clusters.first()).toBeVisible();
    await expect(clusters.first()).toHaveText(/^\d+$/);
    const pins = page.locator("button.map-pin");
    // Tap a cluster until it has expanded into individual photo pins.
    for (let i = 0; i < 8 && (await pins.count()) === 0; i++) {
      await clusters.first().click({ force: true });
      await page.waitForTimeout(700);
    }
    expect(await pins.count()).toBeGreaterThan(0);
  });

  test("expanded card shows more photos with credits, then Instagram last", async ({ page }) => {
    await page.goto("/map");
    // The hidden place list selects a place without needing its pin on screen.
    await page.getByRole("button", { name: /^Ponce City Market, Atlanta/ }).dispatchEvent("click");
    const sheet = page.getByRole("region", { name: "Ponce City Market" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("list", { name: "Photos" }).getByRole("img")).toHaveCount(3);
    await expect(sheet.getByRole("link", { name: /Wikimedia Commons/ }).first()).toHaveAttribute("target", "_blank");
    await expect(sheet.getByRole("link").last()).toHaveText(/Instagram/);
  });

  test("pins show a photo thumbnail and the place name before selecting", async ({ page }) => {
    await page.route("https://tiles.openfreemap.org/**", (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#dbe4ee" } }] } }),
    );
    await page.goto("/map");
    const pin = page.locator('button[aria-label="Borough Market, London"]');
    await expect(pin.locator("img")).toHaveAttribute("src", /Borough_Market_I\.jpg/);
    await expect(pin).toContainText("Borough Market");
  });

  test("full screen button expands the map over the page and exits again", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.route("https://tiles.openfreemap.org/**", (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#dbe4ee" } }] } }),
    );
    await page.goto("/map");
    const shell = page.getByTestId("map-shell");
    const before = await shell.boundingBox();
    expect(before!.height).toBeLessThan(812);
    await page.getByRole("button", { name: "Full screen" }).click();
    await expect(shell).toHaveAttribute("data-fullscreen", "true");
    const box = await shell.boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width: 375, height: 812 });
    expect(await hasHorizontalScroll(page)).toBe(false);
    // Pins still work in full screen.
    await expect(page.locator('button[aria-label$="places, zoom in"]').first()).toBeVisible();
    await page.getByRole("button", { name: "Exit full screen" }).click();
    await expect(shell).toHaveAttribute("data-fullscreen", "false");
    expect((await shell.boundingBox())!.height).toBeLessThan(812);
  });

  test("locate button shows the user's position on the map", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      permissions: ["geolocation"],
      geolocation: { latitude: 42.3555, longitude: -71.0603 },
    });
    const page = await context.newPage();
    await page.route("https://tiles.openfreemap.org/**", (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#dbe4ee" } }] } }),
    );
    await page.goto("http://localhost:3100/map");
    await expect(page.locator(".maplibregl-user-location-dot")).toHaveCount(0);
    await page.getByRole("button", { name: "Find my location" }).click();
    await expect(page.locator(".maplibregl-user-location-dot")).toBeVisible();
    await context.close();
  });

  test("a denied location permission explains how to fix it", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } }); // no geolocation permission
    const page = await context.newPage();
    await page.route("https://tiles.openfreemap.org/**", (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#dbe4ee" } }] } }),
    );
    await page.goto("http://localhost:3100/map");
    await page.getByRole("button", { name: "Find my location" }).click();
    await expect(page.getByText(/Location is blocked|Couldn't find your location/)).toBeVisible();
    await context.close();
  });

  test("menu links to the map", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("link", { name: "Map" }).click();
    await expect(page).toHaveURL(/\/map$/);
  });
});
