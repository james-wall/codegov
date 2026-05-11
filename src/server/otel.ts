import type { Request, Response } from "express";
import { insertToolEvent } from "../db/queries.js";

interface OtelSpan {
  traceId?: string;
  spanId?: string;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: Array<{ key: string; value: { stringValue?: string; intValue?: string; doubleValue?: number } }>;
}

interface OtelResourceSpan {
  resource?: {
    attributes?: Array<{ key: string; value: { stringValue?: string } }>;
  };
  scopeSpans?: Array<{
    spans?: OtelSpan[];
  }>;
}

interface OtelTracePayload {
  resourceSpans?: OtelResourceSpan[];
}

function getAttr(attrs: OtelSpan["attributes"], key: string): string | undefined {
  const attr = attrs?.find(a => a.key === key);
  return attr?.value?.stringValue ?? attr?.value?.intValue ?? attr?.value?.doubleValue?.toString();
}

function parseTimestamp(nanos?: string): string {
  if (!nanos) return new Date().toISOString();
  return new Date(Number(BigInt(nanos) / BigInt(1_000_000))).toISOString();
}

export function handleOtelTraces(req: Request, res: Response): void {
  const payload = req.body as OtelTracePayload;

  if (!payload.resourceSpans?.length) {
    res.status(200).json({ message: "no spans" });
    return;
  }

  let ingested = 0;

  for (const resourceSpan of payload.resourceSpans) {
    const resourceAttrs = resourceSpan.resource?.attributes;
    const tool = getAttr(resourceAttrs as OtelSpan["attributes"], "service.name")
      ?? getAttr(resourceAttrs as OtelSpan["attributes"], "telemetry.sdk.name")
      ?? "unknown";

    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        const attrs = span.attributes;
        const developer = getAttr(attrs, "user.id")
          ?? getAttr(attrs, "developer")
          ?? getAttr(attrs, "user.name")
          ?? "unknown";

        const filePath = getAttr(attrs, "file.path")
          ?? getAttr(attrs, "code.filepath")
          ?? undefined;

        const eventType = getAttr(attrs, "event.type")
          ?? span.name
          ?? "span";

        insertToolEvent({
          tool: normalizeToolName(tool),
          developer,
          timestamp: parseTimestamp(span.startTimeUnixNano),
          event_type: eventType,
          file_path: filePath,
          lines_added: parseInt(getAttr(attrs, "lines.added") ?? "0", 10),
          lines_removed: parseInt(getAttr(attrs, "lines.removed") ?? "0", 10),
          model: getAttr(attrs, "gen_ai.request.model") ?? getAttr(attrs, "model") ?? undefined,
          tokens_in: parseInt(getAttr(attrs, "gen_ai.usage.input_tokens") ?? getAttr(attrs, "tokens.input") ?? "0", 10),
          tokens_out: parseInt(getAttr(attrs, "gen_ai.usage.output_tokens") ?? getAttr(attrs, "tokens.output") ?? "0", 10),
          cost_usd: parseFloat(getAttr(attrs, "cost.usd") ?? "0"),
          session_id: getAttr(attrs, "session.id") ?? span.traceId,
          raw_span: JSON.stringify(span),
        });

        ingested++;
      }
    }
  }

  res.status(200).json({ ingested });
}

function normalizeToolName(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("claude") || lower.includes("anthropic")) return "claude-code";
  if (lower.includes("cursor")) return "cursor";
  if (lower.includes("copilot")) return "copilot";
  return raw;
}
