@description('Location for the container registry')
param location string

@description('Environment suffix')
param env string

@description('Name prefix')
param namePrefix string

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' = {
  name: 'cr${replace(namePrefix, '-', '')}${env}${uniqueString(resourceGroup().id)}'
  location: location
  sku: {
    name: env == 'prd' ? 'Standard' : 'Basic'
  }
  properties: {
    adminUserEnabled: true
    policies: {
      quarantinePolicy: {
        status: 'disabled'
      }
      trustPolicy: {
        type: 'Notary'
        status: 'disabled'
      }
      retentionPolicy: {
        days: env == 'prd' ? 30 : 7
        status: 'enabled'
      }
    }
    encryption: {
      status: 'disabled'
    }
    dataEndpointEnabled: false
    publicNetworkAccess: 'Enabled'
    networkRuleBypassOptions: 'AzureServices'
  }
}

output containerRegistryId string = containerRegistry.id
output containerRegistryName string = containerRegistry.name
output containerRegistryLoginServer string = containerRegistry.properties.loginServer
output containerRegistryUsername string = containerRegistry.listCredentials().username
output containerRegistryPassword string = containerRegistry.listCredentials().passwords[0].value