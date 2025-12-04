# Production Deployment Script for Speech Quiz Application
# Deploys to existing Azure resources: App Services, Cosmos DB, Storage, Key Vault

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroup = "speech-quiz-prod-rg",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "eastus2",
    
    [Parameter(Mandatory=$false)]
    [string]$FrontendAppName = "sgai01",
    
    [Parameter(Mandatory=$false)]
    [string]$BackendAppName = "sgai02",
    
    [Parameter(Mandatory=$false)]
    [string]$CosmosDbAccount = "sgaicosmos",
    
    [Parameter(Mandatory=$false)]
    [string]$StorageAccount = "stgsgai",
    
    [Parameter(Mandatory=$false)]
    [string]$KeyVaultName = "sgakv013",
    
    [Parameter(Mandatory=$false)]
    [string]$CosmosDbName = "speech-quiz-db",
    
    [Parameter(Mandatory=$false)]
    [string]$CosmosContainer = "sessions"
)

Write-Host "=== Production Deployment ===" -ForegroundColor Cyan
Write-Host "Resource Group: $ResourceGroup" -ForegroundColor Yellow
Write-Host "Frontend App: $FrontendAppName" -ForegroundColor Yellow
Write-Host "Backend App: $BackendAppName" -ForegroundColor Yellow
Write-Host "Cosmos DB: $CosmosDbAccount" -ForegroundColor Yellow
Write-Host "Storage: $StorageAccount" -ForegroundColor Yellow
Write-Host "Key Vault: $KeyVaultName" -ForegroundColor Yellow

# Check Azure login
Write-Host "`nChecking Azure login..." -ForegroundColor Cyan
az account show > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged in. Running 'az login'..." -ForegroundColor Yellow
    az login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Login failed. Exiting." -ForegroundColor Red
        exit 1
    }
}

$subscriptionId = az account show --query id -o tsv
$tenantId = az account show --query tenantId -o tsv
Write-Host "Using subscription: $subscriptionId" -ForegroundColor Green

# Function to check if resource exists
function Test-AzureResource {
    param($Type, $Name, $ResourceGroup)
    $exists = az resource list --resource-group $ResourceGroup --resource-type $Type --name $Name --query "[0].name" -o tsv 2>$null
    return ($null -ne $exists -and $exists -ne "")
}

# Create Resource Group if not exists
Write-Host "`nChecking Resource Group..." -ForegroundColor Cyan
$rgExists = az group exists --name $ResourceGroup
if ($rgExists -eq "false") {
    Write-Host "Creating Resource Group: $ResourceGroup" -ForegroundColor Yellow
    az group create --name $ResourceGroup --location $Location
} else {
    Write-Host "Resource Group already exists: $ResourceGroup" -ForegroundColor Green
}

# Check/Create App Service Plan
Write-Host "`nChecking App Service Plan..." -ForegroundColor Cyan
$planName = "ASP-sgai01-9d39"
$planExists = Test-AzureResource "Microsoft.Web/serverfarms" $planName $ResourceGroup
if (-not $planExists) {
    Write-Host "Creating App Service Plan: $planName" -ForegroundColor Yellow
    az appservice plan create `
        --name $planName `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku B1 `
        --is-linux
} else {
    Write-Host "App Service Plan already exists: $planName" -ForegroundColor Green
}

# Check/Create Backend App Service
Write-Host "`nChecking Backend App Service..." -ForegroundColor Cyan
$backendExists = Test-AzureResource "Microsoft.Web/sites" $BackendAppName $ResourceGroup
if (-not $backendExists) {
    Write-Host "Creating Backend App Service: $BackendAppName" -ForegroundColor Yellow
    az webapp create `
        --name $BackendAppName `
        --resource-group $ResourceGroup `
        --plan $planName `
        --runtime "NODE:18-lts"
} else {
    Write-Host "Backend App Service already exists: $BackendAppName" -ForegroundColor Green
}

# Check/Create Frontend App Service
Write-Host "`nChecking Frontend App Service..." -ForegroundColor Cyan
$frontendExists = Test-AzureResource "Microsoft.Web/sites" $FrontendAppName $ResourceGroup
if (-not $frontendExists) {
    Write-Host "Creating Frontend App Service: $FrontendAppName" -ForegroundColor Yellow
    az webapp create `
        --name $FrontendAppName `
        --resource-group $ResourceGroup `
        --plan $planName `
        --runtime "NODE:18-lts"
} else {
    Write-Host "Frontend App Service already exists: $FrontendAppName" -ForegroundColor Green
}

# Check/Create Cosmos DB Account
Write-Host "`nChecking Cosmos DB Account..." -ForegroundColor Cyan
$cosmosExists = Test-AzureResource "Microsoft.DocumentDB/databaseAccounts" $CosmosDbAccount $ResourceGroup
if (-not $cosmosExists) {
    Write-Host "Creating Cosmos DB Account: $CosmosDbAccount (this may take several minutes)..." -ForegroundColor Yellow
    az cosmosdb create `
        --name $CosmosDbAccount `
        --resource-group $ResourceGroup `
        --locations regionName=$Location `
        --kind GlobalDocumentDB `
        --default-consistency-level Session `
        --enable-free-tier false
} else {
    Write-Host "Cosmos DB Account already exists: $CosmosDbAccount" -ForegroundColor Green
}

# Create Cosmos DB Database and Container
Write-Host "`nSetting up Cosmos DB Database and Container..." -ForegroundColor Cyan
az cosmosdb sql database create `
    --account-name $CosmosDbAccount `
    --resource-group $ResourceGroup `
    --name $CosmosDbName `
    --throughput 400 2>$null

az cosmosdb sql container create `
    --account-name $CosmosDbAccount `
    --resource-group $ResourceGroup `
    --database-name $CosmosDbName `
    --name $CosmosContainer `
    --partition-key-path "/sessionId" 2>$null

Write-Host "Cosmos DB Database and Container configured" -ForegroundColor Green

# Check/Create Storage Account
Write-Host "`nChecking Storage Account..." -ForegroundColor Cyan
$storageExists = Test-AzureResource "Microsoft.Storage/storageAccounts" $StorageAccount $ResourceGroup
if (-not $storageExists) {
    Write-Host "Creating Storage Account: $StorageAccount" -ForegroundColor Yellow
    az storage account create `
        --name $StorageAccount `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku Standard_LRS `
        --kind StorageV2
} else {
    Write-Host "Storage Account already exists: $StorageAccount" -ForegroundColor Green
}

# Create blob container for audio storage
Write-Host "Creating blob container..." -ForegroundColor Cyan
az storage container create `
    --name "audio-recordings" `
    --account-name $StorageAccount `
    --auth-mode login 2>$null

# Check/Create Key Vault
Write-Host "`nChecking Key Vault..." -ForegroundColor Cyan
$kvExists = Test-AzureResource "Microsoft.KeyVault/vaults" $KeyVaultName $ResourceGroup
if (-not $kvExists) {
    Write-Host "Creating Key Vault: $KeyVaultName" -ForegroundColor Yellow
    az keyvault create `
        --name $KeyVaultName `
        --resource-group $ResourceGroup `
        --location $Location `
        --enabled-for-deployment true `
        --enabled-for-template-deployment true
} else {
    Write-Host "Key Vault already exists: $KeyVaultName" -ForegroundColor Green
}

# Get connection strings and keys
Write-Host "`nRetrieving connection strings and keys..." -ForegroundColor Cyan

$cosmosConnectionString = az cosmosdb keys list --name $CosmosDbAccount --resource-group $ResourceGroup --type connection-strings --query "connectionStrings[0].connectionString" -o tsv
$storageConnectionString = az storage account show-connection-string --name $StorageAccount --resource-group $ResourceGroup --query connectionString -o tsv

# Store secrets in Key Vault
Write-Host "`nStoring secrets in Key Vault..." -ForegroundColor Cyan
Write-Host "Please enter your Azure OpenAI and Speech Service credentials:" -ForegroundColor Yellow

$azureOpenAIEndpoint = Read-Host "Azure OpenAI Endpoint (e.g., https://your-resource.openai.azure.com)"
$azureOpenAIKey = Read-Host "Azure OpenAI API Key" -AsSecureString
$azureOpenAIKeyPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($azureOpenAIKey))
$azureOpenAIDeployment = Read-Host "Azure OpenAI Deployment Name (e.g., o4-mini)"
$speechRegion = Read-Host "Speech Service Region (e.g., eastus2)"
$speechKey = Read-Host "Speech Service Key" -AsSecureString
$speechKeyPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($speechKey))

# Set secrets in Key Vault
az keyvault secret set --vault-name $KeyVaultName --name "COSMOS-CONNECTION-STRING" --value $cosmosConnectionString > $null
az keyvault secret set --vault-name $KeyVaultName --name "STORAGE-CONNECTION-STRING" --value $storageConnectionString > $null
az keyvault secret set --vault-name $KeyVaultName --name "AZURE-OPENAI-ENDPOINT" --value $azureOpenAIEndpoint > $null
az keyvault secret set --vault-name $KeyVaultName --name "AZURE-OPENAI-API-KEY" --value $azureOpenAIKeyPlain > $null
az keyvault secret set --vault-name $KeyVaultName --name "AZURE-OPENAI-DEPLOYMENT" --value $azureOpenAIDeployment > $null
az keyvault secret set --vault-name $KeyVaultName --name "SPEECH-REGION" --value $speechRegion > $null
az keyvault secret set --vault-name $KeyVaultName --name "SPEECH-KEY" --value $speechKeyPlain > $null

Write-Host "Secrets stored in Key Vault" -ForegroundColor Green

# Enable Managed Identity for Backend App Service
Write-Host "`nEnabling Managed Identity for Backend App Service..." -ForegroundColor Cyan
az webapp identity assign --name $BackendAppName --resource-group $ResourceGroup > $null
$backendPrincipalId = az webapp identity show --name $BackendAppName --resource-group $ResourceGroup --query principalId -o tsv

# Grant Backend App Service access to Key Vault
Write-Host "Granting Backend App Service access to Key Vault..." -ForegroundColor Cyan
az keyvault set-policy `
    --name $KeyVaultName `
    --object-id $backendPrincipalId `
    --secret-permissions get list

# Configure Backend App Settings
Write-Host "`nConfiguring Backend App Settings..." -ForegroundColor Cyan
az webapp config appsettings set `
    --name $BackendAppName `
    --resource-group $ResourceGroup `
    --settings `
        USE_KEY_VAULT="true" `
        KEY_VAULT_NAME="$KeyVaultName" `
        COSMOS_ENDPOINT="https://$CosmosDbAccount.documents.azure.com:443/" `
        COSMOS_DATABASE="$CosmosDbName" `
        COSMOS_CONTAINER="$CosmosContainer" `
        STORAGE_ACCOUNT_NAME="$StorageAccount" `
        AZURE_OPENAI_ENDPOINT="$azureOpenAIEndpoint" `
        AZURE_OPENAI_DEPLOYMENT="$azureOpenAIDeployment" `
        SPEECH_REGION="$speechRegion" `
        SCM_DO_BUILD_DURING_DEPLOYMENT="true" `
        WEBSITE_NODE_DEFAULT_VERSION="~18" `
        NODE_ENV="production"

# Enable CORS for backend
Write-Host "`nEnabling CORS..." -ForegroundColor Cyan
$frontendUrl = "https://$FrontendAppName.azurewebsites.net"
az webapp cors add `
    --name $BackendAppName `
    --resource-group $ResourceGroup `
    --allowed-origins $frontendUrl "https://portal.azure.com"

# Build and Deploy Backend
Write-Host "`nBuilding Backend..." -ForegroundColor Cyan
Push-Location backend
npm install --production=false
npm run build

# Create deployment package
Write-Host "Creating backend deployment package..." -ForegroundColor Cyan
if (Test-Path "../backend-deploy.zip") { Remove-Item "../backend-deploy.zip" -Force }
# Copy scripts folder with questions.json
if (Test-Path "scripts") { Remove-Item "scripts" -Recurse -Force }
Copy-Item -Path "../scripts" -Destination "scripts" -Recurse
Compress-Archive -Path dist,package.json,package-lock.json,node_modules,scripts -DestinationPath ../backend-deploy.zip -Force
Remove-Item "scripts" -Recurse -Force
Pop-Location

Write-Host "Deploying Backend to $BackendAppName..." -ForegroundColor Cyan
az webapp deployment source config-zip `
    --name $BackendAppName `
    --resource-group $ResourceGroup `
    --src backend-deploy.zip

# Build and Deploy Frontend
$backendUrl = "https://$BackendAppName.azurewebsites.net"
Write-Host "`nBuilding Frontend with backend URL: $backendUrl" -ForegroundColor Cyan

Push-Location frontend

# Create production vite config
Write-Host "Creating production Vite config..." -ForegroundColor Cyan
@"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: '$backendUrl',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
"@ | Out-File -FilePath vite.config.prod.ts -Encoding utf8

npm install --production=false
$env:VITE_BACKEND_URL = $backendUrl
npm run build

# Create startup script for frontend
Write-Host "Creating frontend startup script..." -ForegroundColor Cyan
@"
#!/bin/bash
npm install -g serve
serve -s /home/site/wwwroot -l 8080
"@ | Out-File -FilePath dist/startup.sh -Encoding utf8

# Create package.json for frontend deployment
@"
{
  "name": "speech-quiz-frontend",
  "version": "1.0.0",
  "scripts": {
    "start": "serve -s . -l 8080"
  },
  "dependencies": {
    "serve": "^14.2.0"
  }
}
"@ | Out-File -FilePath dist/package.json -Encoding utf8

Write-Host "Creating frontend deployment package..." -ForegroundColor Cyan
Push-Location dist
if (Test-Path "../../frontend-deploy.zip") { Remove-Item "../../frontend-deploy.zip" -Force }
Compress-Archive -Path * -DestinationPath ../../frontend-deploy.zip -Force
Pop-Location
Pop-Location

Write-Host "Deploying Frontend to $FrontendAppName..." -ForegroundColor Cyan
az webapp deployment source config-zip `
    --name $FrontendAppName `
    --resource-group $ResourceGroup `
    --src frontend-deploy.zip

# Configure Frontend startup
az webapp config set `
    --name $FrontendAppName `
    --resource-group $ResourceGroup `
    --startup-file "npm install && npm start"

# Restart both apps
Write-Host "`nRestarting applications..." -ForegroundColor Cyan
az webapp restart --name $BackendAppName --resource-group $ResourceGroup
az webapp restart --name $FrontendAppName --resource-group $ResourceGroup

# Cleanup
Write-Host "`nCleaning up deployment files..." -ForegroundColor Cyan
Remove-Item backend-deploy.zip -ErrorAction SilentlyContinue
Remove-Item frontend-deploy.zip -ErrorAction SilentlyContinue

Write-Host "`n=== Deployment Complete! ===" -ForegroundColor Green
Write-Host "`nApplication URLs:" -ForegroundColor Cyan
Write-Host "  Frontend: https://$FrontendAppName.azurewebsites.net" -ForegroundColor Green
Write-Host "  Backend:  https://$BackendAppName.azurewebsites.net" -ForegroundColor Green
Write-Host "`nAzure Resources:" -ForegroundColor Cyan
Write-Host "  Cosmos DB: $CosmosDbAccount" -ForegroundColor Yellow
Write-Host "  Storage:   $StorageAccount" -ForegroundColor Yellow
Write-Host "  Key Vault: $KeyVaultName" -ForegroundColor Yellow
Write-Host "`nNote: It may take 2-3 minutes for the applications to fully start." -ForegroundColor Yellow
Write-Host "Check logs with: az webapp log tail --name $BackendAppName --resource-group $ResourceGroup" -ForegroundColor Cyan
