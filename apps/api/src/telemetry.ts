import { SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';

export const tracer = trace.getTracer('leadpilot');

/** Runs `fn` inside a span; no-op cost when the OTel SDK is not started. */
export async function withSpan<T>(name: string, attributes: Attributes, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn();
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}
