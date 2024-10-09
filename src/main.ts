import {
  PlaywrightCrawler,
  EnqueueStrategy,
  Dataset,
  KeyValueStore,
  purgeDefaultStorages,
  RequestQueue,
} from "crawlee";
import { uploadToSupabase, insertCrawlData, clearAllStorages } from "./helper";
import path from "path";

/****************************************
 * crawler settings
 ****************************************/
const mainCrawl = async (userId: string, siteUrl: string) => {
  const crawler = new PlaywrightCrawler({
    // Limitation: https://crawlee.dev/api/playwright-crawler/interface/PlaywrightCrawlerOptions#maxRequestsPerCrawl
    maxRequestsPerCrawl: 20,
    // timeoutSecs
    // navigationTimeoutSecs: 60,

    async requestHandler({ request, page, enqueueLinks, log, pushData }) {
      // Log the URL of the page being crawled
      log.info(`crawling ${request.url}...`);
      log.info(`retry count: ${request.retryCount}`);
      // https://crawlee.dev/api/core/function/enqueueLinks
      await enqueueLinks({
        strategy: EnqueueStrategy.SameOrigin,
        transformRequestFunction(req) {
          // ignore all links ending with `.pdf`
          if (req.url.endsWith(".pdf")) return false;
          return req;
        },
      });

      // Save the page data to the dataset
      const title = await page.title();
      const url = page.url();
      const hostName = new URL(url).hostname;

      // Capture the screenshot of the page
      const thumbnailFolder = path.join("screenshots");
      let thumbnailName = "";

      const renameThumbnailName = () => {
        if (url.replace(`${siteUrl}`, "") === "") {
          thumbnailName = `${url
            .replace(`${siteUrl}`, "top")
            .replace("#", "")
            .replace(/\//g, "-")
            .replace(/-$/, "")}.png`;
        } else {
          thumbnailName = `${url
            .replace(`${siteUrl}`, "")
            .replace("#", "")
            .replace(/\//g, "-")
            .replace(/-$/, "")}.png`;
        }
      };

      renameThumbnailName();
      const thumbnailPath = path.join(thumbnailFolder, thumbnailName);

      // TODO:Check if the file already exists but this is cause of the time out error
      // await page.waitForLoadState("networkidle");

      // take a screenshot of the page
      const image = await page.screenshot({ path: thumbnailPath });
      const supabaseImagePath = await uploadToSupabase(
        userId,
        `${hostName}-${thumbnailName}`,
        image
      );

      await pushData({
        title,
        url,
        thumbnailPath: supabaseImagePath,
      });
    },
  });

  await crawler.run([siteUrl]);
};

/***************************************************************************************
 * Open the dataset and save the result of the map to the default Key-value store
 ***************************************************************************************/
const migration = async (userId: string, siteUrl: string) => {
  const dataset = await Dataset.open<{
    url: string;
    title: string;
    thumbnailPath: string;
  }>();

  // calling reduce function and using memo to calculate number of headers
  const dataSetObjArr = await dataset.map((value) => {
    return {
      url: value.url,
      title: value.title,
      thumbnailPath: value.thumbnailPath,
    };
  });

  // for object array sorting and
  //ja , ja/about , en , en/about
  const sortDataSetObjArr = dataSetObjArr
    .filter(
      (value, index, self) =>
        self.findIndex((v) => v.url === value.url) === index
    )
    .sort((a, b) => {
      return a.url.length - b.url.length;
    })
    .sort((a, b) => a.url.split("/").length - b.url.split("/").length);

  // ex) https://www.marsflag.com/ja/ => [ 'ja' ]
  // sort the pathParts array by length and parent-child relationship
  let pathParts: string[][] = [];
  sortDataSetObjArr.map((value) => {
    const path = value.url
      .replace(siteUrl, "")
      .split("/")
      .filter((v) => v);

    pathParts.push(path);
  });

  // return the result of the map to the default Key-value store
  const result = {};

  // create site tree data
  pathParts.map((parts, index) => {
    let obj: { [key: string]: any } = result;

    // if the path is empty, add "top" to the path
    if (parts.filter((part) => part !== "top") && parts.length === 0) {
      parts.push("top");
    }

    // if the path is not starting with "top", add "top" to the path
    if (parts.length >= 1 && parts[0] !== "top") {
      parts.unshift("top");
    }

    // create site tree data
    parts.map((part, partOrder) => {
      if (!obj[part]) {
        // If partOrder is the last index of parts, add the url, title, and thumbnailPath
        if (partOrder === parts.length - 1) {
          obj[part] = {
            url: sortDataSetObjArr[index].url,
            title: sortDataSetObjArr[index].title,
            thumbnailPath: sortDataSetObjArr[index].thumbnailPath,
            level: parts.length - 1,
          };
        } else {
          if (part === "top") {
            obj[part] = {};
          } else {
            obj[part] = {
              title: part,
              url: parts.slice(0, partOrder + 1).join("/"),
              level: parts.length - 2,
            };
          }
        }
      }
      obj = obj[part];
    });
  });

  // saving result of map to default Key-value store
  await KeyValueStore.setValue("site_tree", result);

  try {
    await insertCrawlData(userId, siteUrl, result);
  } catch (err) {
    console.error(err);
  }

  return result;
};

/****************************************
 * Main crawl function
 ****************************************/
export const runCrawl = async (userId: string, siteUrl: string) => {
  try {
    // 1.For second crawl, clear all storages
    await clearAllStorages(
      purgeDefaultStorages,
      KeyValueStore,
      RequestQueue,
      Dataset
    );

    // 2.Run the main crawl
    await mainCrawl(userId, siteUrl);

    // 3.Run the migration
    const result = await migration(userId, siteUrl);

    // 4.Return the result of the migration
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
