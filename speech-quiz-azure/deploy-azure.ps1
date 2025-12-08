# Azure App Service Deployment Script
# This script deploys both backend and frontend to existing Azure resources

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroup = "sgai01",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "canadacentral",
    
    [Parameter(Mandatory=$false)]
    [string]$FrontendAppName = "sgai01",
    
    [Parameter(Mandatory=$false)]
    [string]$BackendAppName = "sgai02",
    
    [Parameter(Mandatory=$false)]
    [string]$CosmosDBAccount = "sgaicosmos13",
    
    [Parameter(Mandatory=$false)]
    [string]$StorageAccount = "stgsgai",
    
    [Parameter(Mandatory=$false)]
    [string]$KeyVault = "sgakv013"
)

Write-Host "=== Azure App Service Deployment ===" -ForegroundColor Cyan
Write-Host "Resource Group: $ResourceGroup" -ForegroundColor Yellow
Write-Host "Location: $Location" -ForegroundColor Yellow
Write-Host "Frontend App: $FrontendAppName" -ForegroundColor Yellow
Write-Host "Backend App: $BackendAppName" -ForegroundColor Yellow
Write-Host "Cosmos DB: $CosmosDBAccount" -ForegroundColor Yellow
Write-Host "Storage Account: $StorageAccount" -ForegroundColor Yellow
Write-Host "Key Vault: $KeyVault" -ForegroundColor Yellow

# Login check
Write-Host "`nChecking Azure login..." -ForegroundColor Cyan
az account show > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged in. Running 'az login'..." -ForegroundColor Yellow
    az login
}

# Check if resource group exists
Write-Host "`nChecking resource group..." -ForegroundColor Cyan
$rgExists = az group exists --name $ResourceGroup
if ($rgExists -eq "false") {
    Write-Host "ERROR: Resource group $ResourceGroup does not exist!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "Using existing resource group: $ResourceGroup" -ForegroundColor Green
}

# Check if backend app service exists
Write-Host "`nChecking backend App Service..." -ForegroundColor Cyan
$backendExists = az webapp show --name $BackendAppName --resource-group $ResourceGroup 2>$null
if (!$backendExists) {
    Write-Host "ERROR: Backend App Service $BackendAppName does not exist!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "Using existing backend App Service: $BackendAppName" -ForegroundColor Green
}

# Check if frontend app service exists
Write-Host "`nChecking frontend App Service..." -ForegroundColor Cyan
$frontendExists = az webapp show --name $FrontendAppName --resource-group $ResourceGroup 2>$null
if (!$frontendExists) {
    Write-Host "ERROR: Frontend App Service $FrontendAppName does not exist!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "Using existing frontend App Service: $FrontendAppName" -ForegroundColor Green
}

# Configure backend app settings
Write-Host "`nConfiguring backend environment variables..." -ForegroundColor Cyan
az webapp config appsettings set `
    --name $BackendAppName `
    --resource-group $ResourceGroup `
    --settings `
        SCM_DO_BUILD_DURING_DEPLOYMENT="false" `
        WEBSITE_NODE_DEFAULT_VERSION="~18" `
        KEY_VAULT_NAME="$KeyVault" `
        COSMOS_DB_ACCOUNT="$CosmosDBAccount" `
        PORT="8080"

# Enable CORS for backend
Write-Host "`nEnabling CORS..." -ForegroundColor Cyan
az webapp cors add `
    --name $BackendAppName `
    --resource-group $ResourceGroup `
    --allowed-origins "https://$FrontendAppName.azurewebsites.net" "http://localhost:5173" 2>$null

# Build backend
Write-Host "`nBuilding backend..." -ForegroundColor Cyan
Push-Location backend
npm install
npm run build

# Create deployment package with all necessary files
Write-Host "Creating backend deployment package..." -ForegroundColor Cyan
$deployPath = "deploy-temp"
if (Test-Path $deployPath) {
    Remove-Item -Recurse -Force $deployPath
}
New-Item -ItemType Directory -Path $deployPath | Out-Null

# Copy necessary files including node_modules
Write-Host "Copying dist folder..." -ForegroundColor Cyan
Copy-Item -Path "dist" -Destination "$deployPath\dist" -Recurse
Write-Host "Copying node_modules..." -ForegroundColor Cyan
Copy-Item -Path "node_modules" -Destination "$deployPath\node_modules" -Recurse
Write-Host "Copying scripts folder..." -ForegroundColor Cyan
Copy-Item -Path "scripts" -Destination "$deployPath\scripts" -Recurse
Copy-Item -Path "package.json" -Destination "$deployPath\"
Copy-Item -Path "package-lock.json" -Destination "$deployPath\"

# Compress for deployment
Write-Host "Compressing deployment package..." -ForegroundColor Cyan
Compress-Archive -Path "$deployPath\*" -DestinationPath "../backend-deploy.zip" -Force
Remove-Item -Recurse -Force $deployPath
Pop-Location

# Deploy backend
Write-Host "`nDeploying backend..." -ForegroundColor Cyan
az webapp deployment source config-zip `
    --name $BackendAppName `
    --resource-group $ResourceGroup `
    --src backend-deploy.zip

# Update frontend to point to backend URL
$backendHostname = az webapp show --name $BackendAppName --resource-group $ResourceGroup --query "defaultHostName" --output tsv
$backendUrl = "https://$backendHostname"
Write-Host "`nUpdating frontend to use backend URL: $backendUrl" -ForegroundColor Cyan

# Build frontend with backend URL
Push-Location frontend
# Create production environment file
@"
VITE_API_BASE_URL=$backendUrl
"@ | Set-Content .env.production
npm install
npm run build
Pop-Location

# Deploy frontend
Write-Host "`nDeploying frontend..." -ForegroundColor Cyan
Push-Location frontend/dist
Compress-Archive -Path * -DestinationPath ../../frontend-deploy.zip -Force
Pop-Location

az webapp deployment source config-zip `
    --name $FrontendAppName `
    --resource-group $ResourceGroup `
    --src frontend-deploy.zip

# Configure frontend to serve static files
az webapp config set `
    --name $FrontendAppName `
    --resource-group $ResourceGroup `
    --startup-file "pm2 serve /home/site/wwwroot --no-daemon --spa"

Write-Host "`n=== Deployment Complete! ===" -ForegroundColor Green
Write-Host "Backend URL: https://$BackendAppName.azurewebsites.net" -ForegroundColor Green
Write-Host "Frontend URL: https://$FrontendAppName.azurewebsites.net" -ForegroundColor Green
Write-Host "`nCleaning up zip files..." -ForegroundColor Cyan
Remove-Item backend-deploy.zip -ErrorAction SilentlyContinue
Remove-Item frontend-deploy.zip -ErrorAction SilentlyContinue

Write-Host "`nNote: It may take a few minutes for the apps to start." -ForegroundColor Yellow
Write-Host "You can check the status in Azure Portal or run:" -ForegroundColor Yellow
Write-Host "  az webapp browse --name $AppName-frontend --resource-group $ResourceGroup" -ForegroundColor Cyan
