import {
  PlaywrightCrawler,
  EnqueueStrategy,
  Dataset,
  KeyValueStore,
  purgeDefaultStorages,
  RequestQueue,
  RetryRequestError,
} from "crawlee";
import {
  uploadToSupabase,
  insertCrawlData,
  clearAllStorages,
} from "./supabaseHelper";
import { createThumbnailFolderAndRename, dataSort } from "./crawlHelper";
import type { DatasetObj } from "./crawlHelper";
import path from "path";
import { load } from "ts-dotenv";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

// removeQueryParams
const removeQueryParams = (url: string) => {
  return url.split("?")[0];
};

/****************************************
 * crawler settings
 ****************************************/
const mainCrawl = async (
  userId: string,
  siteUrl: string, // TODO: どこのページをtopして認識させるか or リダイレクト前のURLをtopとするか or その他(言語設定)
  numberOfCrawlPage?: string
) => {
  // count the number of crawled pages
  let numberOfCrawledPage = 0;

  const crawler = new PlaywrightCrawler({
    // Limitation: https://crawlee.dev/api/playwright-crawler/interface/PlaywrightCrawlerOptions#maxRequestsPerCrawl
    // navigationTimeoutSecs: 60,
    maxRequestsPerCrawl: numberOfCrawlPage ? Number(numberOfCrawlPage) : 10,
    maxRequestRetries: 3,

    // MAIN FUNCTION. Request queue configuration
    async requestHandler({ request, page, enqueueLinks, log, pushData }) {
      // Log the URL of the page being crawled
      log.info(`crawling ${request.url}...`);

      // https://crawlee.dev/api/core/function/enqueueLinks
      await enqueueLinks({
        // confirm that the URL is the same origin as the site
        strategy: EnqueueStrategy.SameOrigin,

        // remove query parameters from the URL.
        // ignore all links ending with `.pdf`
        transformRequestFunction(req) {
          req.url = removeQueryParams(req.url);
          if (req.url.endsWith(".pdf")) return false;
          return req;
        },
      });

      // TODO:Check if the file already exists but this is cause of the time out error
      // await page.waitForLoadState("networkidle");
      // await page.waitForTime(seconds: 1000);

      // Save the page data to the dataset
      const title = await page.title();
      const url = page.url();
      const hostName = new URL(url).hostname;

      // create the thumbnail folder and rename the file. from crawlHelper.ts
      const { thumbnailFolder, thumbnailName } =
        await createThumbnailFolderAndRename(url, siteUrl);

      // create the thumbnail path
      const thumbnailPath = path.join(thumbnailFolder, thumbnailName);

      // take a screenshot of the page
      const image = await page.screenshot({ path: thumbnailPath });

      // upload the screenshot to the Supabase storage
      const supabaseImagePath = await uploadToSupabase(
        userId,
        hostName,
        thumbnailName,
        image
      );

      // push the data to the dataset
      await pushData({
        title,
        url,
        thumbnailPath: supabaseImagePath,
      });

      // Check if the number of crawled pages exceeds the limit
      numberOfCrawledPage += 1;
      await insertCrawlData({
        userId,
        siteUrl,
        numberOfCrawledPage: String(numberOfCrawledPage),
      });
    },

    // error handling
    failedRequestHandler: async ({ request, log }) => {
      log.info(`Request ${request.url} failed ${request.retryCount} times`);
    },
  });

  await crawler.run([siteUrl]);
};

/***************************************************************************************
 * Open the dataset and save the result of the map to the default Key-value store
 ***************************************************************************************/
const formatCrawlData = async (userId: string, siteUrl: string) => {
  const dataset = await Dataset.open<DatasetObj>();
  const dataSetArr = await dataset.map(({ url, title, thumbnailPath }) => ({
    url,
    title,
    thumbnailPath,
  }));

  // Sort the data by the length of the URL
  const sortedData = await dataSort(dataSetArr);

  // build the site tree
  const buildSiteTree = (data: DatasetObj[]) => {
    const result: Record<string, any> = {};

    data.forEach(({ url, title, thumbnailPath }) => {
      // get the parts of the URL
      // 例: https://example.com/foo/bar/baz -> ["foo", "bar", "baz"]
      let parts = url.replace(siteUrl, "").split("/").filter(Boolean);

      // when the URL is the top page
      if (parts.length === 0 || parts[0] !== "top") {
        parts = ["top", ...parts];
      }

      let current = result;

      // create the site tree
      parts.forEach((part, index) => {
        const isLastPart = index === parts.length - 1;

        if (!current[part]) {
          current[part] = isLastPart
            ? {
                url,
                title,
                thumbnailPath,
                level: parts.length - 1,
              }
            : part === "top"
            ? {}
            : {
                url: parts.slice(0, index + 1).join("/"),
                title: part,
                level: parts.length - 2,
              };
        }

        current = current[part];
      });
    });

    return result;
  };

  const siteTree = buildSiteTree(sortedData);

  try {
    await KeyValueStore.setValue("site_tree", siteTree);
    await insertCrawlData({
      userId,
      siteUrl,
      data: siteTree,
    });
  } catch (err) {
    console.error(err);
  }

  return siteTree;
};

/****************************************
 * Main crawl function
 ****************************************/
export const runCrawl = async (
  userId: string,
  siteUrl: string,
  numberOfCrawlPage?: string
) => {
  try {
    // 1.For second crawl, clear all storages
    await clearAllStorages(
      purgeDefaultStorages,
      KeyValueStore,
      RequestQueue,
      Dataset
    );

    // 2.Run the main crawl
    await mainCrawl(userId, siteUrl, numberOfCrawlPage);

    // 3.Run the formatCrawlData
    const result = await formatCrawlData(userId, siteUrl);

    // 4.Return the result of the formatCrawlData
    return result;
  } catch (error) {
    // Log the error
    console.error("Error in runCrawl:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    throw error;
  }
};

/****************************************
 * Get the analytics data
 ****************************************/
const env = load(
  {
    GOOGLE_APPLICATION_CREDENTIALS: String,
  },
  { path: ".env.local" }
);
const analyticsDataClient = new BetaAnalyticsDataClient({
  keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS,
});
export const getAnalyticsData = async () => {
  // const propertyId = "properties/315106443";
  const propertyId = "properties/464702147";
  const response = await analyticsDataClient.runReport({
    property: propertyId,
    dateRanges: [
      {
        startDate: "7daysAgo",
        endDate: "yesterday",
      },
    ],
    dimensions: [
      {
        name: "date",
      },
      {
        name: "hostName",
      },
      {
        name: "pagePathPlusQueryString",
      },
    ],
    metrics: [
      // {
      //   name: "activeUsers",
      // },
      {
        name: "screenPageViews",
      },
    ],
  });

  return response;
};
