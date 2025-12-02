# Production Deployment Guide

This guide covers deploying the Speech Quiz application to Azure using your existing resources.

## Prerequisites

- Azure CLI installed (`az --version`)
- Node.js 18+ installed
- PowerShell (Windows) or PowerShell Core (cross-platform)
- Azure subscription with appropriate permissions

## Azure Resources

The deployment uses the following Azure resources:

| Resource Type | Resource Name | Purpose |
|--------------|---------------|---------|
| App Service | `sgai01` | Frontend (React + Vite) |
| App Service | `sgai02` | Backend (Node.js + Express) |
| Cosmos DB | `sgaicosmos` | Session and answer storage |
| Storage Account | `stgsgai` | Audio recordings storage |
| Key Vault | `sgakv013` | Secure secrets management |

## Deployment Steps

### 1. Login to Azure

```powershell
az login
```

Verify you're using the correct subscription:

```powershell
az account show
```

### 2. Run the Deployment Script

```powershell
cd c:\Azure\SGAIFDPO\speech-quiz-azure
.\deploy-production.ps1
```

The script will prompt you for:
- **Azure OpenAI Endpoint**: e.g., `https://shrganesh-5205-resource.openai.azure.com`
- **Azure OpenAI API Key**: Your API key
- **Azure OpenAI Deployment**: e.g., `o4-mini`
- **Speech Service Region**: e.g., `eastus2`
- **Speech Service Key**: Your Speech API key

### 3. Deployment Process

The script will:

1. ✅ Check/create resource group
2. ✅ Check/create App Service Plan (B1 tier)
3. ✅ Check/create App Services for frontend and backend
4. ✅ Check/create Cosmos DB account, database, and container
5. ✅ Check/create Storage Account with blob container
6. ✅ Check/create Key Vault
7. ✅ Store all secrets securely in Key Vault
8. ✅ Enable Managed Identity for backend
9. ✅ Grant Key Vault access to backend
10. ✅ Build and deploy backend code
11. ✅ Build and deploy frontend code
12. ✅ Configure CORS and app settings
13. ✅ Restart applications

### 4. Verify Deployment

After deployment completes (2-3 minutes), access your application:

**Frontend URL**: `https://sgai01.azurewebsites.net`

**Backend URL**: `https://sgai02.azurewebsites.net`

Test the backend health endpoint:

```powershell
Invoke-WebRequest -Uri "https://sgai02.azurewebsites.net/api/nextquestion?idx=0"
```

### 5. Monitor Logs

View backend logs in real-time:

```powershell
az webapp log tail --name sgai02 --resource-group speech-quiz-prod-rg
```

View frontend logs:

```powershell
az webapp log tail --name sgai01 --resource-group speech-quiz-prod-rg
```

## Configuration

### Environment Variables

The backend uses the following environment variables (set automatically):

- `USE_KEY_VAULT=true` - Enable Key Vault integration
- `KEY_VAULT_NAME=sgakv013` - Key Vault name
- `COSMOS_ENDPOINT` - Cosmos DB endpoint URL
- `COSMOS_DATABASE=speech-quiz-db` - Database name
- `COSMOS_CONTAINER=sessions` - Container name
- `STORAGE_ACCOUNT_NAME=stgsgai` - Storage account
- `AZURE_OPENAI_ENDPOINT` - OpenAI endpoint
- `AZURE_OPENAI_DEPLOYMENT` - Deployment name
- `SPEECH_REGION` - Speech service region
- `NODE_ENV=production` - Production mode

### Secrets in Key Vault

The following secrets are stored in Key Vault:

- `COSMOS-CONNECTION-STRING`
- `STORAGE-CONNECTION-STRING`
- `AZURE-OPENAI-ENDPOINT`
- `AZURE-OPENAI-API-KEY`
- `AZURE-OPENAI-DEPLOYMENT`
- `SPEECH-REGION`
- `SPEECH-KEY`

## Cosmos DB Structure

**Database**: `speech-quiz-db`
**Container**: `sessions`
**Partition Key**: `/sessionId`

Each session document contains:
```json
{
  "id": "unique-id",
  "sessionId": "session-id",
  "userName": "User Name",
  "userEmail": "email@example.com",
  "technicalConfidence": 7,
  "consultativeConfidence": 8,
  "overallScore": 75,
  "timestamp": "2025-12-02T10:30:00Z",
  "results": [...]
}
```

## Storage Account

**Container**: `audio-recordings`

Used to store audio recordings of user responses (if feature is enabled).

## Troubleshooting

### Backend not starting

Check logs:
```powershell
az webapp log tail --name sgai02 --resource-group speech-quiz-prod-rg
```

Common issues:
- Managed Identity not properly configured
- Key Vault access policy not set
- Cosmos DB connection issues

### Frontend not loading

1. Check if backend URL is correct:
```powershell
az webapp config appsettings list --name sgai01 --resource-group speech-quiz-prod-rg
```

2. Verify CORS is enabled on backend:
```powershell
az webapp cors show --name sgai02 --resource-group speech-quiz-prod-rg
```

### Cosmos DB connection failed

Verify Managed Identity has access:
```powershell
az cosmosdb show --name sgaicosmos --resource-group speech-quiz-prod-rg
```

### Key Vault access denied

Check access policies:
```powershell
az keyvault show --name sgakv013 --resource-group speech-quiz-prod-rg
```

Grant access manually if needed:
```powershell
$principalId = az webapp identity show --name sgai02 --resource-group speech-quiz-prod-rg --query principalId -o tsv
az keyvault set-policy --name sgakv013 --object-id $principalId --secret-permissions get list
```

## Scaling

### Scale App Service Plan

Upgrade to higher tier for better performance:

```powershell
az appservice plan update --name speech-quiz-plan --resource-group speech-quiz-prod-rg --sku S1
```

### Scale Cosmos DB

Adjust throughput:

```powershell
az cosmosdb sql database throughput update --account-name sgaicosmos --resource-group speech-quiz-prod-rg --name speech-quiz-db --throughput 1000
```

Or switch to autoscale:

```powershell
az cosmosdb sql database throughput migrate --account-name sgaicosmos --resource-group speech-quiz-prod-rg --name speech-quiz-db --throughput-type autoscale
```

## CI/CD with GitHub Actions

For automated deployments, see `.github/workflows/deploy.yml` (create this file for automated CI/CD).

## Cost Estimation

**Monthly costs** (approximate):

- App Service Plan (B1): $13
- Cosmos DB (400 RU/s): $24
- Storage Account: $1-5
- Key Vault: $0.03 per 10K operations
- Azure OpenAI: Usage-based
- Speech Service: Usage-based

**Total**: ~$40-100/month (depending on usage)

## Security Considerations

✅ All secrets stored in Key Vault
✅ Managed Identity for authentication
✅ CORS configured to only allow frontend origin
✅ HTTPS enforced on all App Services
✅ No secrets in code or configuration files

## Support

For issues or questions, check:
- Backend logs: `az webapp log tail --name sgai02 --resource-group speech-quiz-prod-rg`
- Azure Portal: https://portal.azure.com
- Application Insights (if configured)

## Rollback

To rollback to a previous deployment:

```powershell
az webapp deployment list --name sgai02 --resource-group speech-quiz-prod-rg
az webapp deployment source delete --name sgai02 --resource-group speech-quiz-prod-rg --deployment-id <id>
```
