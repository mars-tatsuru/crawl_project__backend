import { createClient } from "@supabase/supabase-js";
import { load } from "ts-dotenv";
import path from "path";

/****************************************
 * setup supabase
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
