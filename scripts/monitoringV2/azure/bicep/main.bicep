@description('Location for all resources')
param location string = resourceGroup().location

@description('Environment (dev, loc, prd)')
param env string

@description('Name prefix for all resources')
param namePrefix string

@description('PostgreSQL administrator login')
param postgresAdminLogin string

@description('PostgreSQL administrator password')
@secure()
param postgresAdminPassword string

@description('RPC URL for blockchain connection')
@secure()
param rpcUrl string

@description('PostgreSQL SKU name')
param postgresSkuName string

@description('PostgreSQL SKU tier')
param postgresSkuTier string

@description('PostgreSQL storage size in GB')
param postgresStorageSizeGB int

@description('Container app CPU allocation')
param containerAppCpu string

@description('Container app memory allocation')
param containerAppMemory string

@description('Container app minimum replicas')
param containerAppMinReplicas int

@description('Container app maximum replicas')
param containerAppMaxReplicas int

@description('Log retention in days')
param logRetentionDays int

@description('Deployment block number')
param deploymentBlock string

@description('Blockchain ID')
param blockchainId string

@description('Monitoring interval in milliseconds')
param monitoringInterval string

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyVaultDeployment'
  params: {
    location: location
    env: env
    namePrefix: namePrefix
    postgresAdminPassword: postgresAdminPassword
    rpcUrl: rpcUrl
  }
}

module appInsights 'modules/appinsights.bicep' = {
  name: 'appInsightsDeployment'
  params: {
    location: location
    env: env
    namePrefix: namePrefix
    retentionInDays: logRetentionDays
  }
}

module containerRegistry 'modules/registry.bicep' = {
  name: 'containerRegistryDeployment'
  params: {
    location: location
    env: env
    namePrefix: namePrefix
  }
}

module database 'modules/database.bicep' = {
  name: 'databaseDeployment'
  params: {
    location: location
    env: env
    namePrefix: namePrefix
    postgresAdminLogin: postgresAdminLogin
    postgresAdminPassword: postgresAdminPassword
    postgresSkuName: postgresSkuName
    postgresSkuTier: postgresSkuTier
    postgresStorageSizeGB: postgresStorageSizeGB
  }
}

module containerApp 'modules/containerapp.bicep' = {
  name: 'containerAppDeployment'
  params: {
    location: location
    env: env
    namePrefix: namePrefix
    containerAppCpu: containerAppCpu
    containerAppMemory: containerAppMemory
    containerAppMinReplicas: containerAppMinReplicas
    containerAppMaxReplicas: containerAppMaxReplicas
    logAnalyticsCustomerId: appInsights.outputs.logAnalyticsCustomerId
    logAnalyticsSharedKey: appInsights.outputs.logAnalyticsSharedKey
    containerRegistryLoginServer: containerRegistry.outputs.containerRegistryLoginServer
    containerRegistryUsername: containerRegistry.outputs.containerRegistryUsername
    containerRegistryPassword: containerRegistry.outputs.containerRegistryPassword
    postgresServerFqdn: database.outputs.postgresServerFqdn
    postgresAdminLogin: postgresAdminLogin
    postgresDatabaseName: database.outputs.postgresDatabaseName
    dbPasswordSecretUri: keyVault.outputs.dbPasswordSecretUri
    rpcUrlSecretUri: keyVault.outputs.rpcUrlSecretUri
    appInsightsConnectionString: appInsights.outputs.appInsightsConnectionString
    deploymentBlock: deploymentBlock
    blockchainId: blockchainId
    monitoringInterval: monitoringInterval
  }
}

resource keyVaultRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.outputs.keyVaultId, containerApp.outputs.containerAppPrincipalId, 'Key Vault Secrets User')
  scope: resourceGroup()
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: containerApp.outputs.containerAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output resourceGroupName string = resourceGroup().name
output keyVaultName string = keyVault.outputs.keyVaultName
output containerRegistryLoginServer string = containerRegistry.outputs.containerRegistryLoginServer
output postgresServerFqdn string = database.outputs.postgresServerFqdn
output containerAppName string = containerApp.outputs.containerAppName
output containerAppFqdn string = containerApp.outputs.containerAppFqdn
output appInsightsInstrumentationKey string = appInsights.outputs.appInsightsInstrumentationKey