#!/bin/bash

# Azure Bicep deployment script for dEURO monitoring
set -e

# Get environment from command line argument or default to 'dev'
ENV=${1:-dev}

# Validate environment
if [[ ! "$ENV" =~ ^(dev|loc|prd)$ ]]; then
    echo "❌ Invalid environment. Use: dev, loc, or prd"
    echo "Usage: $0 [dev|loc|prd]"
    exit 1
fi

# Configuration based on DFX pattern
RESOURCE_GROUP="rg-deuro-monitoring-${ENV}"
DEPLOYMENT_NAME="deuro-monitoring-${ENV}-deployment"
PARAMETER_FILE="bicep/parameters/${ENV}.json"

echo "🚀 Starting Azure Bicep deployment for dEURO monitoring (${ENV} environment)..."

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

# Check if parameter file exists
if [[ ! -f "$PARAMETER_FILE" ]]; then
    echo "❌ Parameter file not found: $PARAMETER_FILE"
    exit 1
fi

# Get location from parameter file
LOCATION=$(jq -r '.parameters.location.value' "$PARAMETER_FILE")

# 1. Create Resource Group
echo "📦 Creating resource group: $RESOURCE_GROUP..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION"

# 2. Deploy Bicep template
echo "🏗️  Deploying infrastructure with Bicep..."

# Prompt for secrets (not stored in parameter files for security)
read -s -p "Enter PostgreSQL admin password: " POSTGRES_PASSWORD
echo
read -s -p "Enter RPC URL: " RPC_URL
echo

az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file bicep/main.bicep \
  --parameters "@${PARAMETER_FILE}" \
  --parameters postgresAdminPassword="$POSTGRES_PASSWORD" \
  --parameters rpcUrl="$RPC_URL" \
  --name "$DEPLOYMENT_NAME"

# 3. Get deployment outputs
echo "📋 Getting deployment outputs..."
CONTAINER_REGISTRY=$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOYMENT_NAME" --query "properties.outputs.containerRegistryLoginServer.value" --output tsv)
POSTGRES_FQDN=$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOYMENT_NAME" --query "properties.outputs.postgresServerFqdn.value" --output tsv)
CONTAINER_APP_NAME=$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOYMENT_NAME" --query "properties.outputs.containerAppName.value" --output tsv)
KEY_VAULT_NAME=$(az deployment group show --resource-group "$RESOURCE_GROUP" --name "$DEPLOYMENT_NAME" --query "properties.outputs.keyVaultName.value" --output tsv)

# 4. Build and push Docker image
echo "🔨 Building and pushing Docker image..."

# Extract ACR name from login server
ACR_NAME=$(echo "$CONTAINER_REGISTRY" | cut -d'.' -f1)

# Check if Dockerfile exists in current directory or parent directories
DOCKERFILE_PATH=""
if [[ -f "Dockerfile" ]]; then
    DOCKERFILE_PATH="."
elif [[ -f "../Dockerfile" ]]; then
    DOCKERFILE_PATH=".."
elif [[ -f "../../Dockerfile" ]]; then
    DOCKERFILE_PATH="../.."
else
    echo "⚠️  Dockerfile not found. Please build and push the image manually:"
    echo "   docker build -t deuro-monitoring ."
    echo "   docker tag deuro-monitoring $CONTAINER_REGISTRY/deuro-monitoring:latest"
    echo "   az acr login --name $ACR_NAME"
    echo "   docker push $CONTAINER_REGISTRY/deuro-monitoring:latest"
    DOCKERFILE_PATH=""
fi

if [[ -n "$DOCKERFILE_PATH" ]]; then
    # Build image locally
    docker build -t deuro-monitoring "$DOCKERFILE_PATH"

    # Tag for ACR
    docker tag deuro-monitoring "$CONTAINER_REGISTRY/deuro-monitoring:latest"

    # Login to ACR and push
    az acr login --name "$ACR_NAME"
    docker push "$CONTAINER_REGISTRY/deuro-monitoring:latest"

    # 5. Update container app with latest image
    echo "🔄 Updating container app..."
    az containerapp update \
      --name "$CONTAINER_APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --image "$CONTAINER_REGISTRY/deuro-monitoring:latest"
fi

echo "✅ Deployment completed successfully!"
echo ""
echo "🔗 Resources created:"
echo "   Environment: $ENV"
echo "   Resource Group: $RESOURCE_GROUP"
echo "   Key Vault: $KEY_VAULT_NAME"
echo "   Container Registry: $CONTAINER_REGISTRY"
echo "   PostgreSQL Server: $POSTGRES_FQDN"
echo "   Container App: $CONTAINER_APP_NAME"
echo ""
echo "📝 Next steps:"
echo "1. Initialize database schema by running schema.sql against the database"
echo "2. Monitor logs: az containerapp logs show --name $CONTAINER_APP_NAME --resource-group $RESOURCE_GROUP --follow"
echo "3. Update secrets in Key Vault if needed: az keyvault secret set --vault-name $KEY_VAULT_NAME --name <secret-name> --value <secret-value>"
echo "4. Update image: docker push $CONTAINER_REGISTRY/deuro-monitoring:latest && az containerapp update --name $CONTAINER_APP_NAME --resource-group $RESOURCE_GROUP --image $CONTAINER_REGISTRY/deuro-monitoring:latest"