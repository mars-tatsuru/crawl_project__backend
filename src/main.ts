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
  getGa4Data,
  insertGa4Data,
  clearAllStorages,
  getSpecificCrawlData,
} from "./supabaseHelper";
import {
  createThumbnailFolderAndRename,
  dataSort,
  DatasetObj,
} from "./crawlHelper";
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
            ? {
                url: siteUrl,
                title: "Top",
                level: 0,
              }
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
// const env = load(
//   {
//     GOOGLE_APPLICATION_CREDENTIALS: String,
//   },
//   { path: ".env.local" }
// );
export const getAnalyticsData = async (paramsId: string) => {
  const ga4Data = await getGa4Data(paramsId);

  const analyticsDataClient = new BetaAnalyticsDataClient({
    // insert the path to the JSON key file
    // keyFilename: ga4Data?.[0].json_key,

    // insert the JSON key directly
    credentials: ga4Data?.[0].json_key,
  });

  // ex) const propertyId = "properties/315106443";
  // ex) const propertyId = "properties/399561128";
  const propertyId = `properties/${ga4Data?.[0].property_id}`;

  const analyticsData = await analyticsDataClient.runReport({
    property: propertyId,
    dateRanges: [
      {
        startDate: "2021-01-01",
        endDate: "today",
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

  let analyticsGraphData: {
    date: string;
    domainName: string;
    pageView: string;
  }[] = [];

  if (analyticsData[0] && analyticsData?.length > 0) {
    // sort by date
    const sortedRows = [...(analyticsData[0].rows || [])].sort((a, b) =>
      (a.dimensionValues?.[0]?.value || "").localeCompare(
        b.dimensionValues?.[0]?.value || ""
      )
    );

    // plus when the same date
    const combinedRows = sortedRows.reduce(
      (acc: any[], item: any, index: number) => {
        const accDate = (acc[acc.length - 1] as any)?.dimensionValues[0].value;
        const itemDate = item.dimensionValues?.[0]?.value;

        if (accDate === itemDate) {
          // combine the same date domain name
          const accDomainName =
            acc[acc.length - 1].dimensionValues[1].value +
            acc[acc.length - 1].dimensionValues[2].value;
          const itemDomainName =
            item.dimensionValues[1].value + item.dimensionValues[2].value;

          if (accDomainName === itemDomainName) {
            // combine the same date
            acc[acc.length - 1].metricValues[0].value =
              Number(acc[acc.length - 1].metricValues[0].value) +
              Number(item.metricValues[0].value);
          } else {
            acc.push(item);
          }
        } else {
          acc.push(item);
        }
        return acc;
      },
      []
    );

    combinedRows.forEach((item: any) => {
      analyticsGraphData.push({
        date:
          item.dimensionValues[0].value.slice(0, 4) +
          "/" +
          item.dimensionValues[0].value
            .slice(4)
            .replace(/(\d{2})(\d{2})/, "$1/$2"),
        domainName:
          item.dimensionValues[1].value + item.dimensionValues[2].value,
        pageView: item.metricValues[0].value,
      });
    });
  }

  await insertGa4Data({
    paramsId,
    data: analyticsGraphData,
  });

  //TODO: 日付ごとにinsertできるようにする。
  // const crawlData = await getSpecificCrawlData(paramsId);
  // function updatePageViews(crawlData: any, analyticsData: any) {
  //   // 早期リターンでバリデーション
  //   if (!crawlData[0]) {
  //     console.warn("crawlData is undefined or null");
  //     return undefined;
  //   }

  //   if (
  //     !analyticsData ||
  //     !Array.isArray(analyticsData) ||
  //     analyticsData.length === 0
  //   ) {
  //     console.warn("analyticsData is invalid");
  //     return crawlData.json_data; // 元のデータをそのまま返す
  //   }

  //   const rows = analyticsData[0]?.rows;
  //   if (!rows || !Array.isArray(rows) || rows.length === 0) {
  //     console.warn("No rows found in analyticsData");
  //     return crawlData.json_data;
  //   }

  //   const updatedCrawlData = JSON.parse(JSON.stringify(crawlData[0].json_data));

  //   rows.forEach((row) => {
  //     try {
  //       if (!row.dimensionValues?.[2] || !row.metricValues?.[0]) {
  //         console.warn("Invalid row structure:", row);
  //         return;
  //       }

  //       const path = row.dimensionValues[2].value;
  //       const pageViews = parseInt(row.metricValues[0].value);

  //       if (!path || isNaN(pageViews)) {
  //         console.warn(
  //           `Invalid path or pageViews: path=${path}, pageViews=${pageViews}`
  //         );
  //         return;
  //       }

  //       console.info(`Processing: path=${path}, pageViews=${pageViews}`);

  //       if (path === "/") {
  //         if ("top" in updatedCrawlData) {
  //           updatedCrawlData.top.screenPageViews = pageViews;
  //           console.info(`Updated top page views: ${pageViews}`);
  //         }
  //       } else if (path in updatedCrawlData) {
  //         updatedCrawlData[path].screenPageViews = pageViews;
  //         console.info(`Updated page views for ${path}: ${pageViews}`);
  //       } else {
  //         console.warn(`Path not found in crawl data: ${path}`);
  //       }
  //     } catch (error) {
  //       console.error(`Error processing row:`, error);
  //     }
  //   });

  //   return updatedCrawlData;
  // }

  // const result = updatePageViews(crawlData, analyticsData);
  // await insertCrawlData({
  //   id: paramsId,
  //   data: result,
  // });

  return analyticsGraphData;
};
