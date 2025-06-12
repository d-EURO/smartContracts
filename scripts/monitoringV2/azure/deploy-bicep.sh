#!/bin/bash

# Azure Bicep deployment script for dEURO monitoring
set -e

# Configuration
RESOURCE_GROUP="deuro-monitoring-rg"
LOCATION="West Europe"
DEPLOYMENT_NAME="deuro-monitoring-deployment"

echo "🚀 Starting Azure Bicep deployment for dEURO monitoring..."

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI is not installed. Please install it first."
    exit 1
fi

# Check if user is logged in
if ! az account show &> /dev/null; then
    echo "❌ Not logged into Azure CLI. Please run 'az login' first."
    exit 1
fi

# 1. Create Resource Group
echo "📦 Creating resource group..."
az group create \
  --name $RESOURCE_GROUP \
  --location "$LOCATION"

# 2. Deploy Bicep template
echo "🏗️  Deploying infrastructure with Bicep..."

# Prompt for secrets
read -s -p "Enter PostgreSQL admin password: " POSTGRES_PASSWORD
echo
read -s -p "Enter RPC URL: " RPC_URL
echo

az deployment group create \
  --resource-group $RESOURCE_GROUP \
  --template-file bicep/main.bicep \
  --parameters location="$LOCATION" \
  --parameters postgresAdminPassword="$POSTGRES_PASSWORD" \
  --parameters rpcUrl="$RPC_URL" \
  --name $DEPLOYMENT_NAME

# 3. Get deployment outputs
echo "📋 Getting deployment outputs..."
CONTAINER_REGISTRY=$(az deployment group show --resource-group $RESOURCE_GROUP --name $DEPLOYMENT_NAME --query "properties.outputs.containerRegistryLoginServer.value" --output tsv)
POSTGRES_FQDN=$(az deployment group show --resource-group $RESOURCE_GROUP --name $DEPLOYMENT_NAME --query "properties.outputs.postgresServerFqdn.value" --output tsv)
CONTAINER_APP_NAME=$(az deployment group show --resource-group $RESOURCE_GROUP --name $DEPLOYMENT_NAME --query "properties.outputs.containerAppName.value" --output tsv)

# 4. Build and push Docker image
echo "🔨 Building and pushing Docker image..."

# Extract ACR name from login server
ACR_NAME=$(echo $CONTAINER_REGISTRY | cut -d'.' -f1)

# Build image locally
docker build -t deuro-monitoring .

# Tag for ACR
docker tag deuro-monitoring $CONTAINER_REGISTRY/deuro-monitoring:latest

# Login to ACR and push
az acr login --name $ACR_NAME
docker push $CONTAINER_REGISTRY/deuro-monitoring:latest

# 5. Initialize database schema
echo "🗄️  Initializing database schema..."
echo "Note: You may need to manually run the schema.sql file against your PostgreSQL database"
echo "Connection string: postgresql://monitoring:$POSTGRES_PASSWORD@$POSTGRES_FQDN:5432/deuro_monitoring?sslmode=require"

# 6. Update container app with latest image
echo "🔄 Updating container app..."
az containerapp update \
  --name $CONTAINER_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --image "$CONTAINER_REGISTRY/deuro-monitoring:latest"

echo "✅ Deployment completed successfully!"
echo ""
echo "🔗 Resources created:"
echo "   Resource Group: $RESOURCE_GROUP"
echo "   Container Registry: $CONTAINER_REGISTRY"
echo "   PostgreSQL Server: $POSTGRES_FQDN"
echo "   Container App: $CONTAINER_APP_NAME"
echo ""
echo "📝 Next steps:"
echo "1. Initialize database schema by running schema.sql"
echo "2. Monitor logs: az containerapp logs show --name $CONTAINER_APP_NAME --resource-group $RESOURCE_GROUP --follow"
echo "3. Update image: docker push $CONTAINER_REGISTRY/deuro-monitoring:latest && az containerapp update --name $CONTAINER_APP_NAME --resource-group $RESOURCE_GROUP --image $CONTAINER_REGISTRY/deuro-monitoring:latest"