import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

function createRateLimiter(): Ratelimit | null {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    try {
        const redis = new Redis({ url, token });
        return new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(60, "1 m"),
            analytics: true,
            prefix: "mc-api",
        });
    } catch {
        return null;
    }
}

const rateLimiter = createRateLimiter();

export async function checkRateLimit(
    identifier: string
): Promise<{ success: boolean; remaining?: number; reset?: number }> {
    if (!rateLimiter) return { success: true };
    try {
        const result = await rateLimiter.limit(identifier);
        return {
            success: result.success,
            remaining: result.remaining,
            reset: result.reset,
        };
    } catch {
        return { success: true };
    }
}
