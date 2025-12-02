# Azure App Service Deployment Script
# This script deploys both backend and frontend to Azure App Service

param(
    [Parameter(Mandatory=$false)]
    [string]$ResourceGroup = "speech-quiz-rg",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "eastus2",
    
    [Parameter(Mandatory=$false)]
    [string]$AppName = "speech-quiz-app-$(Get-Random -Maximum 9999)",
    
    [Parameter(Mandatory=$false)]
    [string]$PlanName = "speech-quiz-plan"
)

Write-Host "=== Azure App Service Deployment ===" -ForegroundColor Cyan
Write-Host "Resource Group: $ResourceGroup" -ForegroundColor Yellow
Write-Host "Location: $Location" -ForegroundColor Yellow
Write-Host "App Name: $AppName" -ForegroundColor Yellow

# Login check
Write-Host "`nChecking Azure login..." -ForegroundColor Cyan
az account show > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged in. Running 'az login'..." -ForegroundColor Yellow
    az login
}

# Create resource group
Write-Host "`nCreating resource group..." -ForegroundColor Cyan
az group create --name $ResourceGroup --location $Location

# Create App Service Plan (Linux, F1 tier - Free)
Write-Host "`nCreating App Service Plan..." -ForegroundColor Cyan
az appservice plan create `
    --name $PlanName `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku F1 `
    --is-linux

# Create Web App for Backend (Node.js)
Write-Host "`nCreating Web App for Backend..." -ForegroundColor Cyan
az webapp create `
    --name "$AppName-backend" `
    --resource-group $ResourceGroup `
    --plan $PlanName `
    --runtime "NODE:18-lts"

# Configure backend app settings
Write-Host "`nConfiguring backend environment variables..." -ForegroundColor Cyan
Write-Host "NOTE: You need to manually configure these app settings in Azure Portal:" -ForegroundColor Yellow
Write-Host "  - AZURE_OPENAI_API_KEY" -ForegroundColor Yellow
Write-Host "  - AZURE_OPENAI_ENDPOINT" -ForegroundColor Yellow
Write-Host "  - AZURE_OPENAI_DEPLOYMENT" -ForegroundColor Yellow
Write-Host "  - SPEECH_REGION" -ForegroundColor Yellow
Write-Host "  - SPEECH_KEY" -ForegroundColor Yellow
Write-Host "" -ForegroundColor Yellow

az webapp config appsettings set `
    --name "$AppName-backend" `
    --resource-group $ResourceGroup `
    --settings `
        USE_KEY_VAULT="false" `
        SCM_DO_BUILD_DURING_DEPLOYMENT="true" `
        WEBSITE_NODE_DEFAULT_VERSION="~18"

# Enable CORS for backend
Write-Host "`nEnabling CORS..." -ForegroundColor Cyan
az webapp cors add `
    --name "$AppName-backend" `
    --resource-group $ResourceGroup `
    --allowed-origins "*"

# Build backend
Write-Host "`nBuilding backend..." -ForegroundColor Cyan
Push-Location backend
npm install
npm run build
Pop-Location

# Deploy backend
Write-Host "`nDeploying backend..." -ForegroundColor Cyan
Push-Location backend
Compress-Archive -Path * -DestinationPath ../backend-deploy.zip -Force
Pop-Location

az webapp deployment source config-zip `
    --name "$AppName-backend" `
    --resource-group $ResourceGroup `
    --src backend-deploy.zip

# Create Web App for Frontend (Node.js with static build)
Write-Host "`nCreating Web App for Frontend..." -ForegroundColor Cyan
az webapp create `
    --name "$AppName-frontend" `
    --resource-group $ResourceGroup `
    --plan $PlanName `
    --runtime "NODE:18-lts"

# Update frontend to point to backend URL
$backendUrl = "https://$AppName-backend.azurewebsites.net"
Write-Host "`nUpdating frontend to use backend URL: $backendUrl" -ForegroundColor Cyan

# Build frontend with backend URL
Push-Location frontend
# Update the axios baseURL
(Get-Content src/ui/App.tsx) -replace 'http://localhost:7071', $backendUrl | Set-Content src/ui/App.tsx
npm install
npm run build
Pop-Location

# Deploy frontend
Write-Host "`nDeploying frontend..." -ForegroundColor Cyan
Push-Location frontend/dist
Compress-Archive -Path * -DestinationPath ../../frontend-deploy.zip -Force
Pop-Location

az webapp deployment source config-zip `
    --name "$AppName-frontend" `
    --resource-group $ResourceGroup `
    --src frontend-deploy.zip

# Configure frontend to serve static files
az webapp config set `
    --name "$AppName-frontend" `
    --resource-group $ResourceGroup `
    --startup-file "pm2 serve /home/site/wwwroot --no-daemon --spa"

Write-Host "`n=== Deployment Complete! ===" -ForegroundColor Green
Write-Host "Backend URL: https://$AppName-backend.azurewebsites.net" -ForegroundColor Green
Write-Host "Frontend URL: https://$AppName-frontend.azurewebsites.net" -ForegroundColor Green
Write-Host "`nCleaning up zip files..." -ForegroundColor Cyan
Remove-Item backend-deploy.zip -ErrorAction SilentlyContinue
Remove-Item frontend-deploy.zip -ErrorAction SilentlyContinue

Write-Host "`nNote: It may take a few minutes for the apps to start." -ForegroundColor Yellow
Write-Host "You can check the status in Azure Portal or run:" -ForegroundColor Yellow
Write-Host "  az webapp browse --name $AppName-frontend --resource-group $ResourceGroup" -ForegroundColor Cyan
