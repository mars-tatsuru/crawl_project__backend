import fastify from "fastify";
import { FastifyReply, FastifyRequest } from "fastify";
import multiPart from "@fastify/multipart";
import cors from "@fastify/cors";
import { runCrawl } from "./main";
import Queue from "better-queue";
import { uploadToSupabase, insertCrawlData, clearAllStorages } from "./helper";

const server = fastify();
server.register(cors, {
  // origin: true,
  origin: ["http://localhost:3000", "https://saas-project-khaki.vercel.app/"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
});
server.register(multiPart, {
  attachFieldsToBody: "keyValues",
  limits: {
    fileSize: 2147483648, // ファイルサイズの制限 (50MB)
    fieldSize: 2147483648, // フィールドサイズの制限 (50MB)
  },
});

/*******************************************************
 * CRAWL TASKS　QUEUE
 *******************************************************/
type CrawlTaskStatus = {
  id: string;
  userId: string;
  siteUrl: string;
  status: "queued" | "processing" | "completed" | "error";
  progress?: number;
  result?: any;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
};

type CrawlTask = {
  taskId: string;
  userId: string;
  siteUrl: string;
};

const crawlTasks = new Map<string, CrawlTaskStatus>();

// helper function to update the task status
function updateTaskStatus(taskId: string, updates: Partial<CrawlTaskStatus>) {
  const currentTask = crawlTasks.get(taskId);
  if (currentTask) {
    crawlTasks.set(taskId, {
      ...currentTask,
      ...updates,
      updatedAt: new Date(),
    });
  }
}

// helper function to generate a task id
function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// create a crawling queue
const crawlQueue = new Queue<CrawlTask>(
  async (task, cb) => {
    const { taskId, userId, siteUrl } = task;

    try {
      // update the task status to processing
      updateTaskStatus(taskId, {
        status: "processing",
        progress: 0,
      });

      // conduct the crawl
      const result = await runCrawl(userId, siteUrl);

      // update the task status to completed
      updateTaskStatus(taskId, {
        status: "completed",
        result,
        progress: 100,
      });

      cb(null, result);
    } catch (error: Error | any) {
      // update the task status to error
      updateTaskStatus(taskId, {
        status: "error",
        error: error.message,
      });

      cb(error);
    }
  },
  {
    concurrent: 1, // limit to 1 concurrent job
    maxRetries: 3,
    retryDelay: 2000,
  }
);

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

/*******************************************************
 * ENDPOINTS
 *******************************************************/
// Crawl endpoint
server.get("/crawl", async (request: FastifyRequest, reply: FastifyReply) => {
  const { userId, siteUrl } = request.query as {
    userId: string;
    siteUrl: string;
  };

  await insertCrawlData(userId, siteUrl);

  // パラメータのバリデーション
  if (!userId || !siteUrl) {
    reply.status(400).send({
      error: "Bad Request",
      message: "userId and siteUrl are required",
    });
    return;
  }

  // タスクIDの生成と初期状態の保存
  const taskId = generateTaskId();
  const taskStatus: CrawlTaskStatus = {
    id: taskId,
    userId,
    siteUrl,
    status: "queued",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  crawlTasks.set(taskId, taskStatus);

  // キューにタスクを追加
  crawlQueue.push({
    taskId,
    userId,
    siteUrl,
  });

  // タスクIDと初期状態を返す
  return {
    taskId,
    status: "queued",
    message: "Crawl task has been queued",
  };
});

// Status check endpoint
server.get(
  "/crawl/status/:taskId",
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { taskId } = request.params as { taskId: string };
    const taskStatus = crawlTasks.get(taskId);

    if (!taskStatus) {
      reply.status(404).send({
        error: "Not Found",
        message: "Task not found",
      });
      return;
    }

    return taskStatus;
  }
);

// Cancel endpoint
server.post(
  "/crawl/:taskId/cancel",
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { taskId } = request.params as { taskId: string };
    const taskStatus = crawlTasks.get(taskId);

    if (!taskStatus) {
      reply.status(404).send({
        error: "Not Found",
        message: "Task not found",
      });
      return;
    }

    if (taskStatus.status === "completed" || taskStatus.status === "error") {
      return {
        message: "Task has already finished",
        status: taskStatus.status,
      };
    }

    // キューからタスクを削除
    crawlQueue.cancel(taskId);
    updateTaskStatus(taskId, {
      status: "error",
      error: "Task cancelled by user",
    });

    return {
      message: "Crawl task has been cancelled",
      status: "cancelled",
    };
  }
);

// Routine clean-up process
setInterval(() => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  crawlTasks.forEach((task, taskId) => {
    if (task.updatedAt < oneHourAgo) {
      crawlTasks.delete(taskId);
    }
  });
}, 30 * 60 * 1000); // 30分ごとに実行
