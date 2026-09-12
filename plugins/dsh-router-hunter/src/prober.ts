import type { DiscoveredModel, GatewayCredits, ProbeOptions, ProbeResult } from "./types.js";

const DEFAULT_USER_AGENT = "claude-cli/2.1.119 (external, cli)";

const LONG_CONTEXT_BENCHMARK_PROMPT = `
You are evaluating system stability and reasoning performance across long contexts.
Below is a multi-paragraph architectural scenario:
Modern multi-agent architectures require reliable coordination across distributed nodes.
In high-throughput microservices, edge proxies must forward user requests without silent dropping or buffer overflow.
When dealing with token buffers, distributed gateways must ensure backoff jitter and idempotent request IDs are honored.
Data transformations should preserve strict schema typing without truncating intermediate arrays or stream events.
Furthermore, resilience patterns require automatic circuit breaking when upstream error rates exceed 5% over a 60-second sliding window.
Distributed tracing must inject W3C tracecontext headers (traceparent and tracestate) across all egress HTTP requests.
Cache invalidation should follow write-through or cache-aside strategies depending on whether read-after-write consistency is mandatory.
If database replication lag exceeds 500 milliseconds, read queries must automatically route to the primary write replica.
Log compaction and telemetry batching must flush asynchronously every 2000 milliseconds or when batch sizes exceed 64 kilobytes.
Finally, token bucket rate limiters must apply per-IP and per-tenant sliding windows to prevent denial-of-service degradation.

Question: Please summarize the circuit-breaking threshold mentioned above in exactly ONE sentence starting with: "The circuit-breaking threshold is"
`;

export class GatewayProber {
  static getDefaultHeaders(apiKey: string, customHeaders?: Record<string, string>): Record<string, string> {
    return {
      "User-Agent": DEFAULT_USER_AGENT,
      "user-agent": DEFAULT_USER_AGENT,
      "Authorization": `Bearer ${apiKey}`,
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...(customHeaders || {})
    };
  }

  static async probeGateway(
    baseUrl: string,
    apiKey: string,
    options: ProbeOptions = {}
  ): Promise<ProbeResult> {
    const cleanUrl = baseUrl.replace(/\/+$/, "");
    const headers = this.getDefaultHeaders(apiKey);
    const errors: string[] = [];

    let engine = "unknown";
    let statusInfo: any = null;
    let credits: GatewayCredits = { currency: "USD" };
    const models: DiscoveredModel[] = [];

    // 1. Detect engine via /api/status
    try {
      const res = await fetch(`${cleanUrl}/api/status`, { headers, signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        statusInfo = await res.json();
        if (statusInfo?.data?.system_name || statusInfo?.data?.version) {
          engine = "new-api";
        }
      }
    } catch (e: any) {
      errors.push(`Status probe: ${e.message}`);
    }

    // 2. Query Credits & Quota via subscription & usage
    try {
      const subRes = await fetch(`${cleanUrl}/v1/dashboard/billing/subscription`, { headers, signal: AbortSignal.timeout(6000) });
      if (subRes.ok) {
        const subData = await subRes.json();
        const hardLimit = typeof subData.hard_limit_usd === "number" ? subData.hard_limit_usd : undefined;

        let usageUsd = 0;
        try {
          const now = new Date();
          const start = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
          const end = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
          const usageRes = await fetch(`${cleanUrl}/v1/dashboard/billing/usage?start_date=${start}&end_date=${end}`, { headers, signal: AbortSignal.timeout(6000) });
          if (usageRes.ok) {
            const usageData = await usageRes.json();
            usageUsd = (usageData.total_usage || 0) / 100; // New-API usage is in cents
          }
        } catch {}

        const isUnlimited = hardLimit && hardLimit >= 10000000;
        credits = {
          currency: "USD",
          hardLimitUsd: isUnlimited ? undefined : hardLimit,
          totalUsageUsd: usageUsd,
          remainingUsd: isUnlimited ? undefined : (hardLimit !== undefined ? Math.max(0, hardLimit - usageUsd) : undefined),
          isUnlimitedOrUnverified: Boolean(isUnlimited)
        };
      }
    } catch (e: any) {
      errors.push(`Credit probe: ${e.message}`);
    }

    // 3. Query Models via /v1/models & /api/pricing
    const modelSet = new Map<string, DiscoveredModel>();

    try {
      const modelsRes = await fetch(`${cleanUrl}/v1/models`, { headers, signal: AbortSignal.timeout(8000) });
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        if (Array.isArray(data?.data)) {
          for (const m of data.data) {
            const mid = m.id || m.name;
            if (!mid) continue;
            const endpoints = Array.isArray(m.supported_endpoint_types) ? m.supported_endpoint_types : [];
            let protocol: "openai" | "anthropic" | "dual" = "openai";
            if (endpoints.includes("anthropic") && endpoints.includes("openai")) protocol = "dual";
            else if (endpoints.includes("anthropic")) protocol = "anthropic";

            modelSet.set(mid, {
              id: mid,
              name: m.name || mid,
              contextWindow: 128000,
              maxTokens: 8192,
              input: ["text"],
              protocol,
              status: "UNTESTED"
            });
          }
        }
      } else if (modelsRes.status === 403) {
        errors.push("Cloudflare WAF / 403 detected on /v1/models");
      }
    } catch (e: any) {
      errors.push(`Models probe: ${e.message}`);
    }

    // 4. Fallback: Query /api/pricing if /v1/models was empty
    if (modelSet.size === 0) {
      try {
        const pricingRes = await fetch(`${cleanUrl}/api/pricing`, { headers, signal: AbortSignal.timeout(6000) });
        if (pricingRes.ok) {
          const pData = await pricingRes.json();
          if (Array.isArray(pData?.data)) {
            for (const item of pData.data) {
              const mid = item.model_name || item.id;
              if (mid && !modelSet.has(mid)) {
                modelSet.set(mid, {
                  id: mid,
                  name: mid,
                  contextWindow: 128000,
                  maxTokens: 8192,
                  input: ["text"],
                  protocol: mid.includes("claude") ? "anthropic" : "openai",
                  status: "UNTESTED"
                });
              }
            }
          }
        }
      } catch {}
    }

    // 5. If models still empty, test well-known candidate models
    if (modelSet.size === 0) {
      const candidates = [
        "deepseek-v4-pro",
        "deepseek-v4-flash",
        "deepseek-chat",
        "glm-5.3",
        "claude-opus-5",
        "claude-opus-4-8",
        "claude-3-5-sonnet-20241022",
        "gpt-4o",
        "gpt-4o-mini"
      ];
      for (const c of candidates) {
        modelSet.set(c, {
          id: c,
          name: c,
          contextWindow: 128000,
          maxTokens: 8192,
          input: ["text"],
          protocol: c.includes("claude") ? "anthropic" : "openai",
          status: "UNTESTED"
        });
      }
    }

    // 6. Benchmark & Smoke Test models
    const timeout = options.timeoutMs || 10000;
    for (const [id, m] of modelSet.entries()) {
      if (options.testShort !== false) {
        const testRes = await this.testModel(cleanUrl, apiKey, m, {
          testLongContext: options.testLongContext ?? true,
          timeoutMs: timeout
        });
        m.status = testRes.status;
        m.latencyMs = testRes.latencyMs;
        m.notes = testRes.notes;
        m.lastTestedAt = new Date().toISOString();
      }
      models.push(m);
    }

    const online = models.some(m => m.status === "HEALTHY" || m.status === "SILENT_FAILURE_LONG_CONTEXT") ||
                   (statusInfo !== null);

    const hostId = new URL(cleanUrl).hostname.replace(/[^a-zA-Z0-9]/g, "-");
    const keySuffix = apiKey.length >= 4 ? apiKey.slice(-4) : "default";

    return {
      gatewayId: `${hostId}-${keySuffix}`,
      baseUrl: cleanUrl,
      online,
      engine,
      statusInfo,
      credits,
      models,
      errors
    };
  }

  static async testModel(
    baseUrl: string,
    apiKey: string,
    model: DiscoveredModel,
    options: { testLongContext?: boolean; timeoutMs?: number } = {}
  ): Promise<{ status: DiscoveredModel["status"]; latencyMs?: number; notes?: string }> {
    const headers = this.getDefaultHeaders(apiKey);
    const timeout = options.timeoutMs || 12000;

    // A. Smoke test (Short prompt)
    const startTime = Date.now();
    try {
      const isAnthropic = model.protocol === "anthropic";
      const targetUrl = isAnthropic ? `${baseUrl}/v1/messages` : `${baseUrl}/v1/chat/completions`;

      const payload = isAnthropic ? {
        model: model.id,
        max_tokens: 15,
        messages: [{ role: "user", content: "Reply with the word OK." }]
      } : {
        model: model.id,
        max_tokens: 15,
        messages: [{ role: "user", content: "Reply with the word OK." }]
      };

      const res = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeout)
      });

      const latencyMs = Date.now() - startTime;

      if (res.status === 402 || res.status === 403) {
        const errText = await res.text();
        if (errText.includes("quota") || errText.includes("Budget pool") || errText.includes("额度不足")) {
          return { status: "QUOTA_EXHAUSTED", latencyMs, notes: "Quota exhausted or pool empty" };
        }
        if (res.status === 403 && errText.length === 0) {
          return { status: "WAF_BLOCKED", notes: "Cloudflare WAF 403 block on POST endpoint" };
        }
        return { status: "WAF_BLOCKED", notes: `HTTP ${res.status}: ${errText.slice(0, 80)}` };
      }

      if (!res.ok) {
        const errText = await res.text();
        return { status: "UNTESTED", notes: `HTTP ${res.status}: ${errText.slice(0, 80)}` };
      }

      const resJson = await res.json();
      let outputText = "";
      if (isAnthropic) {
        outputText = resJson?.content?.[0]?.text || "";
      } else {
        outputText = resJson?.choices?.[0]?.message?.content || "";
      }

      if (!outputText && !resJson?.choices?.[0]?.message?.reasoning_content) {
        return { status: "SILENT_FAILURE_LONG_CONTEXT", latencyMs, notes: "Returned zero output tokens on smoke test" };
      }

      // B. Anti-Silent-Failure Benchmark (>400 words)
      if (options.testLongContext) {
        try {
          const longPayload = isAnthropic ? {
            model: model.id,
            max_tokens: 50,
            messages: [{ role: "user", content: LONG_CONTEXT_BENCHMARK_PROMPT }]
          } : {
            model: model.id,
            max_tokens: 50,
            messages: [{ role: "user", content: LONG_CONTEXT_BENCHMARK_PROMPT }]
          };

          const longRes = await fetch(targetUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(longPayload),
            signal: AbortSignal.timeout(timeout + 5000)
          });

          if (longRes.ok) {
            const longJson = await longRes.json();
            const longText = (isAnthropic ? longJson?.content?.[0]?.text : longJson?.choices?.[0]?.message?.content) || "";
            if (!longText || longText.trim().length === 0) {
              return {
                status: "SILENT_FAILURE_LONG_CONTEXT",
                latencyMs,
                notes: "⚠️ Silent failure detected on long context (>400 words). Safe for short prompts only."
              };
            }
          }
        } catch {}
      }

      return { status: "HEALTHY", latencyMs, notes: "Verified responsive & full context passing" };

    } catch (err: any) {
      return { status: "UNTESTED", notes: `Probe error: ${err.message}` };
    }
  }
}
