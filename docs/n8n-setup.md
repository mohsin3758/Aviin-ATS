# n8n Webhook Setup for AVIIN ATS
# Access n8n at: https://ats.aviinjobs.com/n8n/ or http://187.127.179.128:5678

## Manual Setup (if API key not configured)
1. Go to http://187.127.179.128:5678
2. Create account / login
3. Go to Settings → API → Enable n8n API → Generate API key
4. Then run: N8N_API_KEY=<your-key> python3 /root/n8n_workflows.py

## Webhooks to activate:
- retention-bank-released  → GET http://n8n:5678/webhook/retention-bank-released
- loyalty-milestone-achieved → GET http://n8n:5678/webhook/loyalty-milestone-achieved
- monthly-incentive-summary  → GET http://n8n:5678/webhook/monthly-incentive-summary

## Test a webhook:
curl -X POST http://localhost:5678/webhook/retention-bank-released \
  -H "Content-Type: application/json" \
  -d '{"count": 2, "total": 25000}'
