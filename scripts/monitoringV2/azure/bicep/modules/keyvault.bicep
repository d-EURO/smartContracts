@description('Location for the Key Vault')
param location string

@description('Environment suffix')
param env string

@description('Name prefix for the Key Vault')
param namePrefix string

@description('PostgreSQL administrator password')
@secure()
param postgresAdminPassword string

@description('RPC URL for blockchain connection')
@secure()
param rpcUrl string

resource keyVault 'Microsoft.KeyVault/vaults@2023-02-01' = {
  name: 'kv-${namePrefix}-${env}-${uniqueString(resourceGroup().id)}'
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: tenant().tenantId
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enableRbacAuthorization: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource dbPasswordSecret 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = {
  parent: keyVault
  name: 'db-password'
  properties: {
    value: postgresAdminPassword
    contentType: 'PostgreSQL admin password'
  }
}

resource rpcUrlSecret 'Microsoft.KeyVault/vaults/secrets@2023-02-01' = {
  parent: keyVault
  name: 'rpc-url'
  properties: {
    value: rpcUrl
    contentType: 'RPC URL for blockchain connection'
  }
}

output keyVaultId string = keyVault.id
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output dbPasswordSecretUri string = dbPasswordSecret.properties.secretUri
output rpcUrlSecretUri string = rpcUrlSecret.properties.secretUri