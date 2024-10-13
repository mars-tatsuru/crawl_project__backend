import fastify from "fastify";
import multiPart from "@fastify/multipart";
import cors from "@fastify/cors";
import { runCrawl } from "./main";

const server = fastify();
server.register(cors, {
  // origin: true,
  origin: ["http://localhost:3000", "https://saas-project-khaki.vercel.app/"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  // credentials: true,
});
server.register(multiPart, {
  attachFieldsToBody: "keyValues",
  limits: {
    fileSize: 2147483648, // ファイルサイズの制限 (50MB)
    fieldSize: 2147483648, // フィールドサイズの制限 (50MB)
  },
});

/*******************************************************
 * CREATE SERVER
 *******************************************************/
server.listen({ port: 8000, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});

// API
server.get("/test", async (request: any, reply: any) => {
  console.log("/test called");
  reply.send("/test called");
});

// crawl API
server.get("/crawl", async (request: any, reply: any) => {
  const { userId, siteUrl } = request.query;
  console.log("userId:", userId);
  console.log("siteUrl:", siteUrl);

  // Run the crawler and process the data
  let result;
  try {
    result = await runCrawl(userId, siteUrl);
    console.log("Crawling and migration completed successfully");
  } catch (error) {
    console.error("Error occurred during crawling or migration:", error);
  }

  reply.send(result);
});
