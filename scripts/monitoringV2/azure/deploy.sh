#!/bin/bash

# Azure deployment script for dEURO monitoring
set -e

# Configuration
RESOURCE_GROUP="deuro-monitoring-rg"
LOCATION="West Europe"
ACR_NAME="deuromonitoring"
APP_NAME="deuro-monitoring-app"
POSTGRES_SERVER="deuro-monitoring-db"
POSTGRES_ADMIN="monitoring"

echo "🚀 Starting Azure deployment for dEURO monitoring..."

# 1. Create Resource Group
echo "📦 Creating resource group..."
az group create \
  --name $RESOURCE_GROUP \
  --location "$LOCATION"

# 2. Create Azure Container Registry
echo "🐳 Creating Azure Container Registry..."
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --admin-enabled true

# Get ACR login server
ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --resource-group $RESOURCE_GROUP --query "loginServer" --output tsv)

# 3. Create PostgreSQL Flexible Server
echo "🗄️  Creating PostgreSQL Flexible Server..."
az postgres flexible-server create \
  --resource-group $RESOURCE_GROUP \
  --name $POSTGRES_SERVER \
  --location "$LOCATION" \
  --admin-user $POSTGRES_ADMIN \
  --admin-password "$(openssl rand -base64 32)" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 15

# Create database
az postgres flexible-server db create \
  --resource-group $RESOURCE_GROUP \
  --server-name $POSTGRES_SERVER \
  --database-name deuro_monitoring

# Configure firewall to allow Azure services
az postgres flexible-server firewall-rule create \
  --resource-group $RESOURCE_GROUP \
  --name $POSTGRES_SERVER \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

# 4. Build and push Docker image
echo "🔨 Building and pushing Docker image..."

# Build image locally
docker build -t deuro-monitoring .

# Tag for ACR
docker tag deuro-monitoring $ACR_LOGIN_SERVER/deuro-monitoring:latest

# Login to ACR and push
az acr login --name $ACR_NAME
docker push $ACR_LOGIN_SERVER/deuro-monitoring:latest

# 5. Create Container App Environment
echo "🌐 Creating Container App Environment..."
az containerapp env create \
  --name "deuro-monitoring-env" \
  --resource-group $RESOURCE_GROUP \
  --location "$LOCATION"

# 6. Deploy Container App
echo "🚀 Deploying Container App..."

# Get PostgreSQL connection details
POSTGRES_FQDN=$(az postgres flexible-server show --name $POSTGRES_SERVER --resource-group $RESOURCE_GROUP --query "fullyQualifiedDomainName" --output tsv)

az containerapp create \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --environment "deuro-monitoring-env" \
  --image "$ACR_LOGIN_SERVER/deuro-monitoring:latest" \
  --registry-server $ACR_LOGIN_SERVER \
  --registry-username $ACR_NAME \
  --registry-password "$(az acr credential show --name $ACR_NAME --query passwords[0].value --output tsv)" \
  --env-vars \
    "DB_HOST=$POSTGRES_FQDN" \
    "DB_PORT=5432" \
    "DB_NAME=deuro_monitoring" \
    "DB_USER=$POSTGRES_ADMIN" \
    "DB_SSL=true" \
    "DEPLOYMENT_BLOCK=22300000" \
    "BLOCKCHAIN_ID=1" \
    "MONITORING_INTERVAL=300000" \
  --secrets \
    "db-password=$(az postgres flexible-server show --name $POSTGRES_SERVER --resource-group $RESOURCE_GROUP --query "administratorLoginPassword" --output tsv)" \
    "rpc-url=$RPC_URL" \
  --cpu 1.0 \
  --memory 2.0Gi \
  --min-replicas 1 \
  --max-replicas 1

echo "✅ Deployment completed successfully!"
echo ""
echo "🔗 Resources created:"
echo "   Resource Group: $RESOURCE_GROUP"
echo "   Container Registry: $ACR_LOGIN_SERVER"
echo "   PostgreSQL Server: $POSTGRES_FQDN"
echo "   Container App: $APP_NAME"
echo ""
echo "📝 Next steps:"
echo "1. Set your RPC_URL secret: az containerapp secret set --name $APP_NAME --resource-group $RESOURCE_GROUP --secrets rpc-url=<your-rpc-url>"
echo "2. Set DB password secret: az containerapp secret set --name $APP_NAME --resource-group $RESOURCE_GROUP --secrets db-password=<postgres-password>"
echo "3. Initialize database schema manually if needed"
echo "4. Monitor logs: az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --follow"