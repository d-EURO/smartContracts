@description('Location for the database')
param location string

@description('Environment suffix')
param env string

@description('Name prefix')
param namePrefix string

@description('PostgreSQL administrator login')
param postgresAdminLogin string

@description('PostgreSQL administrator password')
@secure()
param postgresAdminPassword string

@description('PostgreSQL SKU name')
param postgresSkuName string

@description('PostgreSQL SKU tier')
param postgresSkuTier string

@description('Storage size in GB')
param postgresStorageSizeGB int

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2022-12-01' = {
  name: 'psql-${namePrefix}-${env}-${uniqueString(resourceGroup().id)}'
  location: location
  sku: {
    name: postgresSkuName
    tier: postgresSkuTier
  }
  properties: {
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    version: '15'
    storage: {
      storageSizeGB: postgresStorageSizeGB
    }
    backup: {
      backupRetentionDays: env == 'prd' ? 35 : 7
      geoRedundantBackup: env == 'prd' ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: env == 'prd' ? 'ZoneRedundant' : 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2022-12-01' = {
  parent: postgresServer
  name: 'deuro_monitoring'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.UTF8'
  }
}

resource postgresFirewallRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2022-12-01' = {
  parent: postgresServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output postgresServerId string = postgresServer.id
output postgresServerName string = postgresServer.name
output postgresServerFqdn string = postgresServer.properties.fullyQualifiedDomainName
output postgresDatabaseName string = postgresDatabase.name