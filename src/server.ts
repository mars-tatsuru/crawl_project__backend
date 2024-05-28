import fastify from "fastify";
import multiPart from "@fastify/multipart";
import cors from "@fastify/cors";
import { runCrawl, migration } from "./main";
import fastifyCors from "@fastify/cors";
import helmet from "@fastify/helmet";

const server = fastify();
// CORS configuration

const whitelist = [
  // Add more client URLs as needed
  "http://localhost:3000",
  "http://192.168.0.116:3000",
  "http://127.0.0.1:3000",
];

server.register(fastifyCors, {
  // origin: (origin, callback) => {
  //   if (!origin || whitelist.includes(origin)) {
  //     callback(null, true);
  //   } else {
  //     callback(new Error("Not allowed by CORS"), false);
  //   }
  // },
  origin: true,
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
server.listen({ port: 8080, host: "0.0.0.0" }, (err, address) => {
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
  return request;
});

// crawl API
server.get("/crawl", async (request: any, reply: any) => {
  const { siteUrl } = request.query;
  // Run the crawler and process the data
  let result;
  try {
    await runCrawl(siteUrl);
    result = await migration();
    console.log("Crawling and migration completed successfully");
  } catch (error) {
    console.error("Error occurred during crawling or migration:", error);
  }

  reply.send(result);
});
