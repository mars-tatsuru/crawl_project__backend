import {
  PlaywrightCrawler,
  EnqueueStrategy,
  Dataset,
  KeyValueStore,
} from "crawlee";

// use ts-dotenv to load environment variables
import { load } from "ts-dotenv";

// Import supabase client
import { createClient } from "@supabase/supabase-js";

// Load environment variables from .env.local file
const env = load(
  {
    SUPABASE_URL: String,
    SUPABASE_KEY: String,
  },
  { path: ".env.local" }
);

// Create a single supabase client for interacting with your database
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);

/****************************************
 * crawler settings
 ****************************************/
const urls: string[] = [];
import path from "path";
const MAX_RETRIES = 3;

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
        `${userId}-${hostName}-${thumbnailName}`,
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

/*********************
 * HELPER FUNCTIONS
 *********************/
const uploadToSupabase = async (fileName: string, image: Buffer) => {
  console.log(`Uploading image ${fileName} to Supabase storage...`);
  const { data, error } = await supabase.storage
    .from("thumbnail")
    .upload(`private/${fileName}`, image, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    console.error("Error uploading file:", error);
    throw error;
  }

  return data.path;
};

const insertCrawlData = async (userId: string, siteUrl: string, data: any) => {
  const { data: crawlData, error } = await supabase.from("crawl_data").insert({
    user_id: userId,
    site_url: siteUrl,
    json_data: data,
    thumbnail_path: extractFirstThumbnailPath(data),
  });

  if (error) {
    console.error("Error inserting data:", error);
  }

  return crawlData;
};

const extractFirstThumbnailPath = (obj: any): string | null => {
  if (obj.hasOwnProperty("thumbnailPath")) {
    return obj.thumbnailPath;
  }

  for (let key in obj) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      const result = extractFirstThumbnailPath(obj[key]);
      if (result !== null) {
        return result;
      }
    }
  }

  return null;
};

/****************************************
 * Main crawl function
 ****************************************/
export const runCrawl = async (userId: string, siteUrl: string) => {
  // siteUrl = siteUrl.toString();
  await mainCrawl(userId, siteUrl);
  const result = migration(userId, siteUrl);

  return result;
};
