import puppeteer from "puppeteer";
import fs from "fs";

const BASE_URL = "https://google.com";
const titleToSearch = "Google";
const fileTimestamp = () => {
  const date = new Date();
  return `${date.getFullYear()}-${
    date.getMonth() + 1
  }-${date.getDate()}-${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`;
};
const OUTPUT_FILE = `pages-${fileTimestamp()}.json`;

async function scrapePage() {
  const browser = await puppeteer.launch({
    headless: true,
    ignoreHTTPSErrors: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const visitedUrls = new Set();
  const pagesToProcess = new Set([BASE_URL]);
  const validPages = [];

  async function processUrl(url) {
    if (visitedUrls.has(url)) return;
    visitedUrls.add(url);

    try {
      const page = await browser.newPage();

      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
      });
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      });

      await page.setBypassCSP(true);
      await page.setRequestInterception(true);
      let pendingRequests = new Set();

      page.on("request", (request) => {
        if (
          request.resourceType() === "xhr" ||
          request.resourceType() === "fetch"
        ) {
          pendingRequests.add(request.url());
        }
        request.continue();
      });

      page.on("requestfinished", (request) => {
        pendingRequests.delete(request.url());
      });

      page.on("requestfailed", (request) => {
        pendingRequests.delete(request.url());
      });

      console.log(`🔍 Processing: ${url}`);

      await page.goto(url, {
        waitUntil: ["networkidle0", "domcontentloaded"],
        timeout: 45000,
      });

      await page
        .waitForFunction(
          () => {
            return !document.querySelector("html").classList.contains("__next");
          },
          { timeout: 10000 }
        )
        .catch(() => null);

      await page.waitForFunction(
        () => {
          return window.performance
            .getEntriesByType("resource")
            .filter(
              (r) =>
                r.initiatorType === "fetch" ||
                r.initiatorType === "xmlhttprequest"
            )
            .every((r) => r.responseEnd > 0);
        },
        { timeout: 10000 }
      );

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const hasPendingRequests = pendingRequests.size > 0;
      if (hasPendingRequests) {
        console.log(`⏳ Waiting ${pendingRequests.size} pending requests...`);
        await page.waitForFunction(
          () => {
            return window.performance
              .getEntriesByType("resource")
              .filter(
                (r) =>
                  r.initiatorType === "fetch" ||
                  r.initiatorType === "xmlhttprequest"
              )
              .every((r) => r.responseEnd > 0);
          },
          { timeout: 5000 }
        );
      }

      const pageData = await page.evaluate(() => {
        const title = document.title.trim();
        const content =
          document.querySelector("body")?.textContent?.trim() || "";
        return { title, content };
      });

      if (pageData.title === titleToSearch) {
        validPages.push({ url, title: pageData.title });
        console.log(`✅ Found page with title ${titleToSearch} : ${url}`);
      }

      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll("a"))
          .map((a) => a.href)
          .filter((href) => href.startsWith(window.location.origin));
      });

      for (const link of links) {
        if (!visitedUrls.has(link)) {
          pagesToProcess.add(link);
        }
      }

      await page.close();
    } catch (error) {
      console.error(`❌ Error in ${url}:`, error.message);
    }
  }

  try {
    while (pagesToProcess.size > 0) {
      const batch = [];
      for (let i = 0; i < 4 && pagesToProcess.size > 0; i++) {
        const url = pagesToProcess.values().next().value;
        pagesToProcess.delete(url);
        batch.push(url);
      }

      await Promise.all(batch.map((url) => processUrl(url)));
      console.log(
        `📊 Progress: ${visitedUrls.size} processed, ${pagesToProcess.size} in queue`
      );
    }

    if (validPages.length > 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(validPages, null, 2));
      console.log(`✅ Saved ${OUTPUT_FILE}`);
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await browser.close();
  }
}

scrapePage();
