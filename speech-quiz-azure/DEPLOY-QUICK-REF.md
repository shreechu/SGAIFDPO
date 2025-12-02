# Quick Deployment Reference

## Deploy to Production

```powershell
cd c:\Azure\SGAIFDPO\speech-quiz-azure
.\deploy-production.ps1
```

**You'll need to provide:**
- Azure OpenAI Endpoint: `https://shrganesh-5205-resource.openai.azure.com`
- Azure OpenAI API Key: `[your-key]`
- Azure OpenAI Deployment: `o4-mini`
- Speech Region: `eastus2`
- Speech Key: `[your-key]`

## Your Azure Resources

| Resource | Name | URL |
|----------|------|-----|
| Frontend | `sgai01` | https://sgai01.azurewebsites.net |
| Backend | `sgai02` | https://sgai02.azurewebsites.net |
| Cosmos DB | `sgaicosmos` | - |
| Storage | `stgsgai` | - |
| Key Vault | `sgakv013` | - |

## Quick Commands

### View Backend Logs
```powershell
az webapp log tail --name sgai02 --resource-group speech-quiz-prod-rg
```

### View Frontend Logs
```powershell
az webapp log tail --name sgai01 --resource-group speech-quiz-prod-rg
```

### Restart Apps
```powershell
az webapp restart --name sgai02 --resource-group speech-quiz-prod-rg
az webapp restart --name sgai01 --resource-group speech-quiz-prod-rg
```

### Test Backend
```powershell
Invoke-WebRequest -Uri "https://sgai02.azurewebsites.net/api/nextquestion?idx=0"
```

### Check Cosmos DB Data
```powershell
az cosmosdb sql container query `
  --account-name sgaicosmos `
  --resource-group speech-quiz-prod-rg `
  --database-name speech-quiz-db `
  --name sessions `
  --query-text "SELECT * FROM c ORDER BY c.timestamp DESC"
```

## Troubleshooting

### App Not Starting
1. Check logs with `az webapp log tail`
2. Verify Managed Identity: `az webapp identity show --name sgai02 --resource-group speech-quiz-prod-rg`
3. Check Key Vault access: `az keyvault show --name sgakv013 --resource-group speech-quiz-prod-rg`

### Grant Key Vault Access Manually
```powershell
$principalId = az webapp identity show --name sgai02 --resource-group speech-quiz-prod-rg --query principalId -o tsv
az keyvault set-policy --name sgakv013 --object-id $principalId --secret-permissions get list
```

### Update App Settings
```powershell
az webapp config appsettings set `
  --name sgai02 `
  --resource-group speech-quiz-prod-rg `
  --settings KEY=VALUE
```

## Deployment Time
- Initial: ~10-15 minutes
- Updates: ~3-5 minutes

## Cost Estimate
~$40-100/month depending on usage
