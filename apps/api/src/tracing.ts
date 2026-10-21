/**
 * OpenTelemetry bootstrap. Loaded with `node --import ./dist/tracing.js` so the
 * auto-instrumentations patch http, pg, ioredis and fastify before they are imported.
 * Does nothing unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'leadpilot',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });
  sdk.start();
  const shutdown = () => {
    sdk.shutdown().finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
}
