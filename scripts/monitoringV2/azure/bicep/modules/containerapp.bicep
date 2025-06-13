@description('Location for the container app')
param location string

@description('Environment suffix')
param env string

@description('Name prefix')
param namePrefix string

@description('Container app CPU allocation')
param containerAppCpu string

@description('Container app memory allocation')
param containerAppMemory string

@description('Minimum replicas')
param containerAppMinReplicas int

@description('Maximum replicas')
param containerAppMaxReplicas int

@description('Log Analytics workspace customer ID')
param logAnalyticsCustomerId string

@description('Log Analytics workspace shared key')
@secure()
param logAnalyticsSharedKey string

@description('Container Registry login server')
param containerRegistryLoginServer string

@description('Container Registry username')
param containerRegistryUsername string

@description('Container Registry password')
@secure()
param containerRegistryPassword string

@description('PostgreSQL server FQDN')
param postgresServerFqdn string

@description('PostgreSQL admin login')
param postgresAdminLogin string

@description('PostgreSQL database name')
param postgresDatabaseName string

@description('Key Vault URI for database password')
param dbPasswordSecretUri string

@description('Key Vault URI for RPC URL')
param rpcUrlSecretUri string

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Deployment block number')
param deploymentBlock string

@description('Blockchain ID')
param blockchainId string

@description('Monitoring interval')
param monitoringInterval string

resource containerAppEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: 'cae-${namePrefix}-${env}-${uniqueString(resourceGroup().id)}'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'ca-${namePrefix}-${env}-${uniqueString(resourceGroup().id)}'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      registries: [
        {
          server: containerRegistryLoginServer
          username: containerRegistryUsername
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: containerRegistryPassword
        }
        {
          name: 'db-password-secret'
          keyVaultUrl: dbPasswordSecretUri
          identity: 'system'
        }
        {
          name: 'rpc-url-secret'
          keyVaultUrl: rpcUrlSecretUri
          identity: 'system'
        }
      ]
      ingress: {
        external: false
        targetPort: 3000
        traffic: [
          {
            weight: 100
            latestRevision: true
          }
        ]
      }
    }
    template: {
      containers: [
        {
          name: 'monitoring'
          image: '${containerRegistryLoginServer}/deuro-monitoring:latest'
          env: [
            {
              name: 'DB_HOST'
              value: postgresServerFqdn
            }
            {
              name: 'DB_PORT'
              value: '5432'
            }
            {
              name: 'DB_NAME'
              value: postgresDatabaseName
            }
            {
              name: 'DB_USER'
              value: postgresAdminLogin
            }
            {
              name: 'DB_PASSWORD'
              secretRef: 'db-password-secret'
            }
            {
              name: 'DB_SSL'
              value: 'true'
            }
            {
              name: 'RPC_URL'
              secretRef: 'rpc-url-secret'
            }
            {
              name: 'DEPLOYMENT_BLOCK'
              value: deploymentBlock
            }
            {
              name: 'BLOCKCHAIN_ID'
              value: blockchainId
            }
            {
              name: 'MONITORING_INTERVAL'
              value: monitoringInterval
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsightsConnectionString
            }
            {
              name: 'NODE_ENV'
              value: env == 'prd' ? 'production' : 'development'
            }
          ]
          resources: {
            cpu: json(containerAppCpu)
            memory: containerAppMemory
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              initialDelaySeconds: 30
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/ready'
                port: 3000
              }
              initialDelaySeconds: 10
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: containerAppMinReplicas
        maxReplicas: containerAppMaxReplicas
        rules: [
          {
            name: 'cpu-scaling'
            custom: {
              type: 'cpu'
              metadata: {
                type: 'Utilization'
                value: '70'
              }
            }
          }
        ]
      }
    }
  }
}

output containerAppEnvironmentId string = containerAppEnvironment.id
output containerAppId string = containerApp.id
output containerAppName string = containerApp.name
output containerAppPrincipalId string = containerApp.identity.principalId
output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn