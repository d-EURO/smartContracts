# dEURO Monitoring Azure Infrastructure

This directory contains the Azure infrastructure setup for the dEURO blockchain monitoring service.

## 🏗️ Architecture

The infrastructure uses a modular Bicep approach with the following components:

- **Key Vault**: Secure secret management for sensitive configuration
- **PostgreSQL Flexible Server**: Database for monitoring data storage
- **Container Registry**: Private registry for monitoring application images
- **Container Apps**: Serverless container hosting with auto-scaling
- **Application Insights**: Comprehensive monitoring and logging
- **Log Analytics**: Centralized log aggregation and analysis

## 📁 Structure

```
azure/
├── bicep/
│   ├── main.bicep                 # Main template orchestrating all modules
│   ├── modules/                   # Reusable Bicep modules
│   │   ├── keyvault.bicep        # Key Vault for secret management
│   │   ├── database.bicep        # PostgreSQL database
│   │   ├── registry.bicep        # Container Registry
│   │   ├── containerapp.bicep    # Container Apps environment
│   │   └── appinsights.bicep     # Application Insights & Log Analytics
│   └── parameters/               # Environment-specific parameters
│       ├── dev.json              # Development environment
│       ├── loc.json              # Local/staging environment
│       └── prd.json              # Production environment
├── deploy-bicep.sh               # Main deployment script
└── README.md                     # This file
```

## 🚀 Deployment

### Prerequisites

1. **Azure CLI**: Install and authenticate
   ```bash
   az login
   ```

2. **Docker**: Required for building and pushing container images

3. **jq**: JSON processor for reading parameter files
   ```bash
   # macOS
   brew install jq
   
   # Ubuntu/Debian
   sudo apt-get install jq
   ```

### Deploy to Environment

The deployment script supports three environments: `dev`, `loc` (staging), and `prd` (production).

```bash
# Deploy to development (default)
./deploy-bicep.sh dev

# Deploy to staging
./deploy-bicep.sh loc

# Deploy to production
./deploy-bicep.sh prd
```

During deployment, you'll be prompted for:
- **PostgreSQL admin password**: Secure password for database access
- **RPC URL**: Blockchain RPC endpoint URL

### What Gets Created

The deployment creates resources following DFX naming conventions:

| Resource Type | Naming Pattern | Example |
|---------------|----------------|---------|
| Resource Group | `rg-deuro-monitoring-{env}` | `rg-deuro-monitoring-dev` |
| Key Vault | `kv-deuro-monitoring-{env}-{unique}` | `kv-deuro-monitoring-dev-abc123` |
| PostgreSQL | `psql-deuro-monitoring-{env}-{unique}` | `psql-deuro-monitoring-dev-abc123` |
| Container Registry | `crdeuromonitoring{env}{unique}` | `crdeuromonitoringdevabc123` |
| Container App | `ca-deuro-monitoring-{env}-{unique}` | `ca-deuro-monitoring-dev-abc123` |

## 🔧 Configuration

### Environment-Specific Settings

Each environment has different resource configurations:

| Setting | Dev | Staging (loc) | Production |
|---------|-----|---------------|------------|
| PostgreSQL SKU | B1ms | B1ms | D2s_v3 |
| Storage | 32GB | 32GB | 128GB |
| CPU | 1.0 | 0.5 | 2.0 |
| Memory | 2.0Gi | 1.0Gi | 4.0Gi |
| Replicas | 1-2 | 1 | 2-5 |
| Log Retention | 30 days | 7 days | 90 days |

### Secret Management

Secrets are stored in Azure Key Vault and accessed by the Container App using managed identity:

- `db-password`: PostgreSQL admin password
- `rpc-url`: Blockchain RPC endpoint URL

To update secrets:
```bash
az keyvault secret set --vault-name <key-vault-name> --name db-password --value <new-password>
az keyvault secret set --vault-name <key-vault-name> --name rpc-url --value <new-rpc-url>
```

## 📊 Monitoring & Logging

### Application Insights

- **Metrics**: Container performance, request rates, error rates
- **Logs**: Application logs and container logs
- **Alerts**: Configurable alerts for critical events

### Container App Logs

```bash
# View real-time logs
az containerapp logs show --name <container-app-name> --resource-group <resource-group> --follow

# View recent logs
az containerapp logs show --name <container-app-name> --resource-group <resource-group> --tail 100
```

### Database Monitoring

PostgreSQL metrics are available through Azure Monitor and can be viewed in the Azure portal.

## 🔄 Updates

### Container Image Updates

1. **Build and push new image**:
   ```bash
   docker build -t deuro-monitoring .
   docker tag deuro-monitoring <registry-url>/deuro-monitoring:latest
   az acr login --name <registry-name>
   docker push <registry-url>/deuro-monitoring:latest
   ```

2. **Update Container App**:
   ```bash
   az containerapp update \
     --name <container-app-name> \
     --resource-group <resource-group> \
     --image <registry-url>/deuro-monitoring:latest
   ```

### Infrastructure Updates

1. **Modify Bicep templates** as needed
2. **Update parameter files** if new parameters are added
3. **Redeploy**: `./deploy-bicep.sh <env>`

## 🛡️ Security Features

### Network Security
- Container Apps run in a managed environment with network isolation
- PostgreSQL uses Azure's built-in network security
- Key Vault access is restricted to Container App managed identity

### Authentication & Authorization
- **Managed Identity**: Container App uses system-assigned managed identity
- **RBAC**: Principle of least privilege for Key Vault access
- **Secrets**: No secrets stored in code or environment variables

### Data Protection
- **Encryption at Rest**: All data encrypted using Azure-managed keys
- **Encryption in Transit**: TLS/SSL for all connections
- **Backup**: Automated database backups with configurable retention

## 🔍 Troubleshooting

### Common Issues

1. **Deployment fails with permission errors**:
   - Ensure you have sufficient Azure permissions
   - Check if the resource group already exists

2. **Container App fails to start**:
   - Check container logs for application errors
   - Verify environment variables and secrets
   - Ensure database connectivity

3. **Database connection issues**:
   - Verify firewall rules allow Container App access
   - Check database credentials in Key Vault
   - Ensure SSL is properly configured

### Health Checks

The Container App includes health probes:
- **Liveness**: `/health` endpoint (every 30s)
- **Readiness**: `/ready` endpoint (every 10s)

Ensure your monitoring application implements these endpoints.

## 📈 Scaling

### Automatic Scaling
Container Apps automatically scale based on:
- CPU utilization (threshold: 70%)
- Custom metrics (if configured)

### Manual Scaling
```bash
az containerapp update \
  --name <container-app-name> \
  --resource-group <resource-group> \
  --min-replicas <min> \
  --max-replicas <max>
```

## 🏷️ Tags

All resources are automatically tagged with:
- `Environment`: dev/loc/prd
- `Project`: deuro-monitoring
- `ManagedBy`: bicep-deployment

## 📞 Support

For issues or questions:
1. Check Azure portal for resource status and metrics
2. Review Container App logs and Application Insights
3. Verify Key Vault secret accessibility
4. Check PostgreSQL connection and performance metrics