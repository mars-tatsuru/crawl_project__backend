import {
  PlaywrightCrawler,
  EnqueueStrategy,
  Dataset,
  KeyValueStore,
  purgeDefaultStorages,
  RequestQueue,
  RetryRequestError,
} from "crawlee";
import { createClient } from "@supabase/supabase-js";
import { load } from "ts-dotenv";
import path from "path";

/****************************************
 * type DatasetObj
 ****************************************/
export type DatasetObj = {
  url: string;
  title: string;
  thumbnailPath: string;
};

/****************************************
 * thumbnailFolder and thumbnailName
 ****************************************/
let thumbnailFolder = "";
let thumbnailName = "";
export const createThumbnailFolderAndRename = async (
  url: string,
  siteUrl: string
): Promise<{ thumbnailFolder: string; thumbnailName: string }> => {
  // Capture the screenshot of the page
  thumbnailFolder = path.join("screenshots");

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

  return {
    thumbnailFolder,
    thumbnailName,
  };
};

/****************************************
 * sort sitemap data
 ****************************************/
export const dataSort = async (dataset: DatasetObj[]) => {
  return dataset.sort((a: any, b: any) => {
    return a.url.split("/").length - b.url.split("/").length;
  });
};
