#!/usr/bin/env bash
# End-to-end demo against a running `docker compose up` stack:
# inbound lead -> AI extraction + RAG draft -> operator approval -> deal in CRM.
set -euo pipefail

API=${API:-http://localhost:3000}
AGENT=${DEMO_AGENT_KEY:-lp_dev_agent_change_me}
OPERATOR=${DEMO_OPERATOR_KEY:-lp_dev_operator_change_me}
KEY="demo-$(date +%s)"

json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log($1)})"; }

echo "1) A lead arrives from the website form (Idempotency-Key: $KEY)"
BODY='{"channel":"web","text":"Здравствуйте! Меня зовут Анна. Сколько стоит интеграция сайта с Битрикс24? Бюджет 150к. Телефон 8 (912) 345-67-89","contact":{"email":"anna@example.com"}}'
TICKET=$(curl -sf -X POST "$API/v1/inbound" -H "authorization: Bearer $AGENT" -H "idempotency-key: $KEY" -H 'content-type: application/json' -d "$BODY" | json o.ticketId)
echo "   ticket $TICKET"

echo "2) The client retries the same request: same ticket, replayed response"
curl -si -X POST "$API/v1/inbound" -H "authorization: Bearer $AGENT" -H "idempotency-key: $KEY" -H 'content-type: application/json' -d "$BODY" | grep -i -E '^HTTP|idempotent-replayed'

echo "3) Worker: LLM extraction (validated by Zod) + knowledge base search + draft reply"
for _ in $(seq 1 50); do
  STATUS=$(curl -sf "$API/v1/tickets/$TICKET" -H "authorization: Bearer $OPERATOR" | json o.status)
  [ "$STATUS" = "awaiting_review" ] && break; sleep 0.3
done
curl -sf "$API/v1/tickets/$TICKET" -H "authorization: Bearer $OPERATOR" \
  | json "JSON.stringify({extraction:o.extraction, draft:o.draft.reply, sources:o.sources.map(s=>s.title+' ('+s.score+')')},null,2)"

echo "4) An agent key cannot approve (human-in-the-loop is enforced)"
curl -s -o /dev/null -w '   HTTP %{http_code}\n' -X POST "$API/v1/tickets/$TICKET/approve" -H "authorization: Bearer $AGENT" -H 'content-type: application/json' -d '{}'

echo "5) Operator approves the draft -> CRM sync job"
curl -sf -X POST "$API/v1/tickets/$TICKET/approve" -H "authorization: Bearer $OPERATOR" -H 'content-type: application/json' -d '{}' >/dev/null
for _ in $(seq 1 50); do
  STATUS=$(curl -sf "$API/v1/tickets/$TICKET" -H "authorization: Bearer $OPERATOR" | json o.status)
  [ "$STATUS" = "synced" ] && break; sleep 0.3
done
echo "   status: $STATUS"
curl -sf "$API/v1/crm/deals?q=%D0%91%D0%B8%D1%82%D1%80%D0%B8%D0%BA%D1%81" -H "authorization: Bearer $AGENT" | json "JSON.stringify(o.items[0],null,2)"

echo "6) Metrics"
curl -sf "$API/metrics" | grep -E '^leadpilot_(inbound_total|llm_requests_total|ticket_transitions_total)' | head -12
