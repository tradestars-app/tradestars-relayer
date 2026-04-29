import { Redis } from "@upstash/redis";
import { requireEnv } from "@/lib/env-utils";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: requireEnv(
        "UPSTASH_REDIS_REST_URL",
        process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
      ),
      token: requireEnv(
        "UPSTASH_REDIS_REST_TOKEN",
        process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
      ),
    });
  }

  return redis;
}
