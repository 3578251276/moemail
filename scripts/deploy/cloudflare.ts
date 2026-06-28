import Cloudflare from "cloudflare";
import "dotenv/config";

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CUSTOM_DOMAIN = process.env.CUSTOM_DOMAIN;
const PROJECT_NAME = process.env.PROJECT_NAME || "moemail";
const DATABASE_NAME = process.env.DATABASE_NAME || "moemail-db";
const KV_NAMESPACE_NAME = process.env.KV_NAMESPACE_NAME || "moemail-kv";
const DATABASE_ID = process.env.DATABASE_ID;

const client = new Cloudflare({
  apiKey: CF_API_TOKEN,
  maxRetries: 5,
  timeout: 120000,
  defaultHeaders: {
    "Accept-Encoding": "identity",
  },
} as any);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isNotFoundError = (error: any) => {
  return (
    error?.status === 404 ||
    error?.code === 404 ||
    error?.constructor?.name === "NotFoundError"
  );
};

const isRetryableError = (error: any) => {
  const message = String(error?.message || error || "");
  const code = String(error?.code || error?.cause?.code || "");

  return (
    code.includes("ERR_STREAM_PREMATURE_CLOSE") ||
    code.includes("STREAM_PREMATURE_CLOSE") ||
    code.includes("ECONNRESET") ||
    code.includes("ETIMEDOUT") ||
    code.includes("EAI_AGAIN") ||
    message.includes("Premature close") ||
    message.includes("fetch failed") ||
    message.includes("Invalid response body") ||
    message.includes("network") ||
    message.includes("timeout")
  );
};

const withRetry = async <T>(
  name: string,
  fn: () => Promise<T>,
  retries = 5,
  delayMs = 5000
): Promise<T> => {
  let lastError: any;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (isNotFoundError(error)) {
        throw error;
      }

      if (!isRetryableError(error) || attempt >= retries) {
        throw error;
      }

      const waitMs = delayMs * attempt;
      console.warn(
        `⚠️ ${name} failed, retrying ${attempt}/${retries} in ${waitMs / 1000}s...`
      );
      console.warn(error);

      await sleep(waitMs);
    }
  }

  throw lastError;
};

export const getPages = async () => {
  const projectInfo = await withRetry("Get Pages project", async () => {
    return client.pages.projects.get(PROJECT_NAME, {
      account_id: CF_ACCOUNT_ID,
    });
  });

  return projectInfo;
};

export const createPages = async () => {
  console.log(`🆕 Creating new Cloudflare Pages project: "${PROJECT_NAME}"`);

  const project = await withRetry("Create Pages project", async () => {
    return client.pages.projects.create({
      account_id: CF_ACCOUNT_ID,
      name: PROJECT_NAME,
      production_branch: "master",
    });
  });

  if (CUSTOM_DOMAIN) {
    console.log("🔗 Setting pages domain...");

    await withRetry("Create Pages custom domain", async () => {
      return client.pages.projects.domains.create(PROJECT_NAME, {
        account_id: CF_ACCOUNT_ID,
        name: CUSTOM_DOMAIN,
      });
    });

    console.log("✅ Pages domain set successfully");
  }

  console.log("✅ Project created successfully");

  return project;
};

export const getDatabase = async () => {
  if (DATABASE_ID) {
    return {
      uuid: DATABASE_ID,
    };
  }

  const database = await withRetry("Get D1 database", async () => {
    return client.d1.database.get(DATABASE_NAME, {
      account_id: CF_ACCOUNT_ID,
    });
  });

  return database;
};

export const createDatabase = async () => {
  console.log(`🆕 Creating new D1 database: "${DATABASE_NAME}"`);

  const database = await withRetry("Create D1 database", async () => {
    return client.d1.database.create({
      account_id: CF_ACCOUNT_ID,
      name: DATABASE_NAME,
    });
  });

  console.log("✅ Database created successfully");

  return database;
};

export const getKVNamespaceList = async () => {
  const kvNamespaces = await withRetry("List KV namespaces", async () => {
    const list = [];

    for await (const namespace of client.kv.namespaces.list({
      account_id: CF_ACCOUNT_ID,
    })) {
      list.push(namespace);
    }

    return list;
  });

  return kvNamespaces;
};

export const createKVNamespace = async () => {
  console.log(`🆕 Creating new KV namespace: "${KV_NAMESPACE_NAME}"`);

  const kvNamespace = await withRetry("Create KV namespace", async () => {
    return client.kv.namespaces.create({
      account_id: CF_ACCOUNT_ID,
      title: KV_NAMESPACE_NAME,
    });
  });

  console.log("✅ KV namespace created successfully");

  return kvNamespace;
};
