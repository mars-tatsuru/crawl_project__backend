import { createClient } from "@supabase/supabase-js";
import { load } from "ts-dotenv";

/****************************************
 * setup supabase
 ****************************************/
const env = load(
  {
    SUPABASE_URL: String,
    SUPABASE_KEY: String,
  },
  { path: ".env.local" }
);

// Create a single supabase client for interacting with your database
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
  // auth: {
  //   autoRefreshToken: false,
  //   persistSession: false,
  // },
});

/****************************************
 * uploadToSupabase from the second time onwards
 ****************************************/
export const uploadToSupabase = async (
  userId: string,
  hostName: string,
  thumbnailName: string,
  image: Buffer
) => {
  console.log(`Uploading image ${hostName} to Supabase storage...`);
  const { data, error } = await supabase.storage
    .from("thumbnail")
    .upload(`private/${userId}/${hostName}/${thumbnailName}`, image, {
      cacheControl: "3600",
      upsert: false,
      contentType: "image/*",
    });

  if (error) {
    console.error("Error uploading file:", error);
    throw error;
  }

  return data.path;
};

/****************************************
 * insertCrawlData
 ****************************************/
export const insertCrawlData = async (
  userId: string,
  siteUrl: string,
  data: any
) => {
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

// extractFirstThumbnailPath function is used to extract the first thumbnail path from the object
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
 * clearAllStorages
 ****************************************/
export const clearAllStorages = async (
  purgeDefaultStorages: () => any,
  KeyValueStore: { open: () => any },
  RequestQueue: { open: () => any },
  Dataset: { open: () => any }
) => {
  console.log("Clearing all storages...");
  await purgeDefaultStorages();

  // Manually clear key-value store
  const keyValueStore = await KeyValueStore.open();
  await keyValueStore.drop();

  // Manually clear dataset
  const dataset = await Dataset.open();
  await dataset.drop();

  // Manually clear request queue
  const requestQueue = await RequestQueue.open();
  await requestQueue.drop();

  console.log("All storages cleared.");
};
