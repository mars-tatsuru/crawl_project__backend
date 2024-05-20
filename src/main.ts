import {
  PlaywrightCrawler,
  EnqueueStrategy,
  Dataset,
  KeyValueStore,
} from "crawlee";

// use ts-dotenv to load environment variables
import { load } from "ts-dotenv";
import {
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
  CreateMultipartUploadCommand,
} from "@aws-sdk/client-s3";

// Load environment variables from .env.local file
const env = load(
  {
    AWS_ACCESS_KEY_ID: String,
    AWS_SECRET_ACCESS_KEY: String,
    REGION: String,
    BUCKETNAME: String,
    FILEPATH: String,
  },
  { path: ".env.local" }
);

// Create an S3 client
const client = new S3Client({
  region: env.REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

// get s3 url
const s3Url = `https://${env.BUCKETNAME}.s3.${env.REGION}.amazonaws.com`;

// URL to crawl
const crawlUrl = "https://www.marsflag.com/";

/****************************************
 * crawler settings
 ****************************************/
const urls: string[] = [];
import path from "path";

const crawler = new PlaywrightCrawler({
  // Limitation for only 10 requests (do not use if you want to crawl all links)
  // https://crawlee.dev/api/playwright-crawler/interface/PlaywrightCrawlerOptions#maxRequestsPerCrawl
  maxRequestsPerCrawl: 20,

  async requestHandler({ request, page, enqueueLinks, log, pushData }) {
    // Log the URL of the page being crawled
    log.info(`crawling ${request.url}...`);

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

    // Capture the screenshot of the page
    const thumbnailFolder = path.join("screenshots");
    let thumbnailName = "";

    const renameThumbnailName = () => {
      if (url.replace(`${crawlUrl}`, "") === "") {
        thumbnailName = `${url
          .replace(`${crawlUrl}`, "top")
          .replace("#", "")
          .replace(/\//g, "-")
          .replace(/-$/, "")}.png`;
      } else {
        thumbnailName = `${url
          .replace(`${crawlUrl}`, "")
          .replace("#", "")
          .replace(/\//g, "-")
          .replace(/-$/, "")}.png`;
      }
    };

    renameThumbnailName();
    const thumbnailPath = path.join(thumbnailFolder, thumbnailName);

    // Check if the file already exists
    await page.waitForLoadState("networkidle");

    // take a screenshot of the page
    const image = await page.screenshot({ path: thumbnailPath });

    postDataToBucket(thumbnailName, image);

    await pushData({
      title,
      url,
      thumbnailPath: `${s3Url}/${env.FILEPATH}/snapshoot/${thumbnailName}`,
    });
  },
});

export const runCrawl = async () => {
  await crawler.run([crawlUrl]);
};

/***************************************************************************************
 * Open the dataset and save the result of the map to the default Key-value store
 ***************************************************************************************/
export const migration = async () => {
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
      .replace(crawlUrl, "")
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
  await KeyValueStore.setValue("page_data", dataSetObjArr);
  await KeyValueStore.setValue("page_data_sorted", sortDataSetObjArr);
  await KeyValueStore.setValue("site_tree", result);
  await KeyValueStore.setValue("site_path", pathParts);

  // send the result to the aws s3 bucket
  const command = new PutObjectCommand({
    Bucket: `${env.BUCKETNAME}`,
    Key: `${env.FILEPATH}/tree/site_tree.json`,
    Body: Buffer.from(JSON.stringify(result)),
    ContentType: "application/json",
  });

  try {
    await client.send(command);
  } catch (err) {
    console.error(err);
  }

  return result;
};

/*********************
 * HELPER FUNCTIONS
 *********************/
const postDataToBucket = async (screenshotName: string, fileData: Buffer) => {
  const command = new PutObjectCommand({
    Bucket: `${env.BUCKETNAME}`,
    Key: `${env.FILEPATH}/snapshoot/${screenshotName}`,
    Body: fileData,
    ContentType: "png",
  });

  try {
    const response = await client.send(command);
    return response;
  } catch (err) {
    console.error(err);
  }
};
