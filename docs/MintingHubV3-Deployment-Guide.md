# MintingHubV3 Deployment Guide

Dieses Dokument beschreibt den vollständigen Deployment-Prozess für MintingHubV3 auf dem bestehenden dEURO-System.

---

## Inhaltsverzeichnis

1. [Übersicht](#1-übersicht)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Architektur](#3-architektur)
4. [Bestehende Contract-Adressen](#4-bestehende-contract-adressen)
5. [Neue Contracts](#5-neue-contracts)
6. [Deployment-Reihenfolge](#6-deployment-reihenfolge)
7. [Post-Deployment Konfiguration](#7-post-deployment-konfiguration)
8. [Verifikation](#8-verifikation)
9. [Frontend-Integration](#9-frontend-integration)
10. [Wichtige Hinweise](#10-wichtige-hinweise)

---

## 1. Übersicht

### Was ist MintingHubV3?

MintingHubV3 ist die nächste Version des Minting-Systems für dEURO mit folgenden neuen Features:

- **Native ETH Support**: Direkte ETH-Einzahlung ohne manuelles WETH-Wrapping
- **Price Reference System**: Cooldown-freie Preiserhöhungen mit gültiger Referenz-Position
- **Optimierte Zinsberechnung**: Zinsen nur auf den "usable" Anteil (nach Reserve-Abzug)
- **Genesis Position**: Erste Position pro Collateral kann Init-Period überspringen

### Warum eine neue FrontendGateway?

Die bestehende FrontendGateway (`0x5c49C00f897bD970d964BFB8c3065ae65a180994`) ist **permanent** an MintingHubV2 gebunden. Nach dem Aufruf von `init()` wird die Ownership aufgegeben und kann nicht mehr geändert werden.

Daher benötigt MintingHubV3 eine eigene FrontendGateway-Instanz für das Frontend-Reward-System.

---

## 2. Voraussetzungen

### Technische Anforderungen

- [ ] Node.js >= 18.x
- [ ] Hardhat installiert (`npm install`)
- [ ] Private Key mit ausreichend ETH für Gas
- [ ] 1000 dEURO für die Minter Application Fee

### Benötigte Wallets/Accounts

| Rolle | Beschreibung |
|-------|--------------|
| Deployer | Account der alle Contracts deployed |
| FrontendGateway Owner | Temporär der Deployer, dann renounced |

### Empfohlene Gas-Einstellungen

```javascript
// Für Mainnet-Deployment
const gasSettings = {
  maxFeePerGas: ethers.parseUnits("30", "gwei"),      // Anpassen nach Netzwerk
  maxPriorityFeePerGas: ethers.parseUnits("2", "gwei")
};
```

---

## 3. Architektur

### System-Übersicht

```
                    ┌─────────────────────────────┐
                    │     DecentralizedEURO       │
                    │  (bestehender Contract)     │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
           ┌────────▼────────┐          ┌────────▼────────┐
           │   V2 SYSTEM     │          │   V3 SYSTEM     │
           │   (bestehend)   │          │   (NEU)         │
           └────────┬────────┘          └────────┬────────┘
                    │                             │
     ┌──────────────┼──────────────┐   ┌─────────┼──────────────┐
     │              │              │   │         │              │
┌────▼────┐  ┌──────▼──────┐  ┌───▼───┐  ┌──────▼──────┐  ┌────▼────┐
│MintingHub│  │FrontendGW  │  │Leadrate│  │FrontendGW  │  │MintingHub│
│GatewayV2 │  │    V1      │  │(shared)│  │    V3      │  │GatewayV3 │
└────┬────┘  └─────────────┘  └───┬───┘  └─────────────┘  └────┬────┘
     │                            │                            │
┌────▼────┐                       │                       ┌────▼────┐
│Position │                       │                       │Position │
│FactoryV2│                       │                       │FactoryV3│
└─────────┘                       │                       └─────────┘
                                  │
                           ┌──────▼──────┐
                           │   Equity    │
                           │  (nDEPS)    │
                           └─────────────┘
```

### Geteilte vs. Neue Contracts

| Contract | Status | Begründung |
|----------|--------|------------|
| DecentralizedEURO | GETEILT | Core Token, unveränderlich |
| Equity (nDEPS) | GETEILT | Reserve/Governance |
| Leadrate | GETEILT | Gleiche Zinsrate für V2 und V3 |
| DEPSWrapper | GETEILT | Utility Contract |
| WETH9 | GETEILT | Standard Ethereum Contract |
| FrontendGateway | **NEU** | Locked auf einen MintingHub |
| MintingHubGateway | **NEU** | V3 Implementation |
| PositionFactory | **NEU** | V3 Position Contract |
| PositionRoller | **NEU** | V3 mit Native ETH Support |

---

## 4. Bestehende Contract-Adressen

### Ethereum Mainnet

```javascript
const MAINNET = {
  // Core Contracts (WIEDERVERWENDEN)
  decentralizedEURO: "0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea",
  equity: "0xc71104001A3CCDA1BEf1177d765831Bd1bfE8eE6",
  DEPSwrapper: "0x103747924E74708139a9400e4Ab4BEA79FFFA380",
  WETH9: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",

  // V2 System (NICHT ÄNDERN - nur zur Referenz)
  mintingHubGatewayV2: "0x8B3c41c649B9c7085C171CbB82337889b3604618",
  frontendGatewayV1: "0x5c49C00f897bD970d964BFB8c3065ae65a180994",
  savingsGateway: "0x073493d73258C4BEb6542e8dd3e1b2891C972303",
  positionRollerV2: "0x4CE0AB2FC21Bd27a47A64F594Fdf7654Ea57Dc79",
  positionFactoryV2: "0x167144d66AC1D02EAAFCa3649ef3305ea31Ee5A8",
};
```

### Leadrate-Adresse ermitteln

Die Leadrate-Adresse ist nicht direkt in der Konfiguration gespeichert. Sie kann vom bestehenden MintingHubV2 abgefragt werden:

```javascript
const mintingHubV2 = await ethers.getContractAt(
  "IMintingHub",
  MAINNET.mintingHubGatewayV2
);
const leadrateAddress = await mintingHubV2.RATE();
console.log("Leadrate:", leadrateAddress);
```

---

## 5. Neue Contracts

### 5.1 PositionFactoryV3

**Pfad:** `contracts/MintingHubV3/PositionFactory.sol`

**Funktion:** Erstellt neue Position-Contracts (V3) mit Native ETH Support.

**Constructor:**
```solidity
constructor() // Keine Parameter
```

### 5.2 PositionRollerV3

**Pfad:** `contracts/MintingHubV3/PositionRoller.sol`

**Funktion:** Ermöglicht das Rollen von Positionen in neue Positionen. V3 unterstützt Native ETH.

**Constructor:**
```solidity
constructor(address deuro_)
```

| Parameter | Typ | Beschreibung |
|-----------|-----|--------------|
| deuro_ | address | DecentralizedEURO Contract Adresse |

### 5.3 FrontendGatewayV3

**Pfad:** `contracts/gateway/FrontendGateway.sol`

**Funktion:** Verwaltet Frontend-Rewards für V3 Positionen.

**Constructor:**
```solidity
constructor(address deuro_, address deps_)
```

| Parameter | Typ | Beschreibung |
|-----------|-----|--------------|
| deuro_ | address | DecentralizedEURO Contract Adresse |
| deps_ | address | DEPSWrapper Contract Adresse |

**WICHTIG:** Nach dem Deployment muss `init()` aufgerufen werden!

### 5.4 MintingHubGatewayV3

**Pfad:** `contracts/gateway/MintingHubGatewayV3.sol`

**Funktion:** Haupt-Contract für das Minting-System V3.

**Constructor:**
```solidity
constructor(
    address _deuro,
    address _leadrate,
    address payable _roller,
    address _factory,
    address _gateway,
    address _weth
)
```

| Parameter | Typ | Beschreibung |
|-----------|-----|--------------|
| _deuro | address | DecentralizedEURO Contract |
| _leadrate | address | Leadrate Contract (vom V2 System) |
| _roller | address payable | PositionRollerV3 (neu deployed) |
| _factory | address | PositionFactoryV3 (neu deployed) |
| _gateway | address | FrontendGatewayV3 (neu deployed) |
| _weth | address | WETH9 Contract |

---

## 6. Deployment-Reihenfolge

### Schritt 1: PositionFactoryV3 deployen

```javascript
const PositionFactory = await ethers.getContractFactory("PositionFactory");
const positionFactoryV3 = await PositionFactory.deploy();
await positionFactoryV3.waitForDeployment();

console.log("PositionFactoryV3:", await positionFactoryV3.getAddress());
```

**Erwartete Gas-Kosten:** ~2.5M Gas

### Schritt 2: PositionRollerV3 deployen

```javascript
const PositionRoller = await ethers.getContractFactory("PositionRoller");
const positionRollerV3 = await PositionRoller.deploy(MAINNET.decentralizedEURO);
await positionRollerV3.waitForDeployment();

console.log("PositionRollerV3:", await positionRollerV3.getAddress());
```

**Erwartete Gas-Kosten:** ~1.5M Gas

### Schritt 3: FrontendGatewayV3 deployen

```javascript
const FrontendGateway = await ethers.getContractFactory("FrontendGateway");
const frontendGatewayV3 = await FrontendGateway.deploy(
  MAINNET.decentralizedEURO,
  MAINNET.DEPSwrapper
);
await frontendGatewayV3.waitForDeployment();

console.log("FrontendGatewayV3:", await frontendGatewayV3.getAddress());
```

**Erwartete Gas-Kosten:** ~2M Gas

### Schritt 4: MintingHubGatewayV3 deployen

```javascript
// Leadrate-Adresse vom V2 System holen
const mintingHubV2 = await ethers.getContractAt(
  "IMintingHub",
  MAINNET.mintingHubGatewayV2
);
const leadrateAddress = await mintingHubV2.RATE();

const MintingHubGatewayV3 = await ethers.getContractFactory("MintingHubGatewayV3");
const mintingHubGatewayV3 = await MintingHubGatewayV3.deploy(
  MAINNET.decentralizedEURO,
  leadrateAddress,
  await positionRollerV3.getAddress(),
  await positionFactoryV3.getAddress(),
  await frontendGatewayV3.getAddress(),
  MAINNET.WETH9
);
await mintingHubGatewayV3.waitForDeployment();

console.log("MintingHubGatewayV3:", await mintingHubGatewayV3.getAddress());
```

**Erwartete Gas-Kosten:** ~3M Gas

### Schritt 5: FrontendGatewayV3 initialisieren

```javascript
// WICHTIG: Dieser Schritt ist IRREVERSIBEL!
// Nach init() wird die Ownership aufgegeben.

const tx = await frontendGatewayV3.init(
  MAINNET.savingsGateway,           // Bestehende SavingsGateway
  await mintingHubGatewayV3.getAddress()  // Neue MintingHubGatewayV3
);
await tx.wait();

console.log("FrontendGatewayV3 initialized and ownership renounced");

// Verifizieren
const owner = await frontendGatewayV3.owner();
console.log("Owner after init:", owner); // Sollte 0x0 sein
```

**Erwartete Gas-Kosten:** ~100K Gas

### Schritt 6: Minter-Registrierung starten

```javascript
const deuro = await ethers.getContractAt(
  "IDecentralizedEURO",
  MAINNET.decentralizedEURO
);

// Application Fee: 1000 dEURO
const applicationFee = ethers.parseEther("1000");

// Application Period: mindestens MIN_APPLICATION_PERIOD (14 Tage)
const applicationPeriod = 14 * 24 * 60 * 60; // 14 Tage in Sekunden

// Erst Approval für die Fee
await deuro.approve(MAINNET.decentralizedEURO, applicationFee);

// Dann suggestMinter aufrufen
const tx = await deuro.suggestMinter(
  await mintingHubGatewayV3.getAddress(),
  applicationPeriod,
  applicationFee,
  "MintingHubV3 with Native ETH Support - https://github.com/d-EURO/smartContracts"
);
await tx.wait();

console.log("Minter suggestion submitted!");
console.log("Activation date:", new Date(Date.now() + applicationPeriod * 1000));
```

**Erwartete Gas-Kosten:** ~200K Gas

---

## 7. Post-Deployment Konfiguration

### 7.1 Warten auf Aktivierung

Nach `suggestMinter()` müssen **14 Tage** vergehen, bevor der MintingHub aktiv wird.

**Status prüfen:**
```javascript
const deuro = await ethers.getContractAt(
  "IDecentralizedEURO",
  MAINNET.decentralizedEURO
);

const mintingHubAddress = await mintingHubGatewayV3.getAddress();
const activationTimestamp = await deuro.minters(mintingHubAddress);
const isActive = await deuro.isMinter(mintingHubAddress);

console.log("Activation timestamp:", new Date(Number(activationTimestamp) * 1000));
console.log("Is active:", isActive);
```

### 7.2 Veto-Möglichkeit

Während der 14-Tage-Periode können qualifizierte nDEPS-Holder ein Veto einlegen:

```solidity
function denyMinter(
    address _minter,
    address[] calldata _helpers,
    string calldata _message
) external
```

**Voraussetzung:** Der Caller muss "qualified" sein (genug nDEPS halten).

### 7.3 Nach Aktivierung

Sobald `isMinter()` true zurückgibt:
- Positionen können über MintingHubGatewayV3 eröffnet werden
- Der PositionRollerV3 kann Positionen rollen
- Frontend-Rewards werden in FrontendGatewayV3 akkumuliert

---

## 8. Verifikation

### 8.1 Contract-Verifikation auf Etherscan

```bash
# PositionFactoryV3
npx hardhat verify --network mainnet <POSITION_FACTORY_V3_ADDRESS>

# PositionRollerV3
npx hardhat verify --network mainnet <POSITION_ROLLER_V3_ADDRESS> \
  "0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea"

# FrontendGatewayV3
npx hardhat verify --network mainnet <FRONTEND_GATEWAY_V3_ADDRESS> \
  "0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea" \
  "0x103747924E74708139a9400e4Ab4BEA79FFFA380"

# MintingHubGatewayV3
npx hardhat verify --network mainnet <MINTING_HUB_GATEWAY_V3_ADDRESS> \
  "0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea" \
  "<LEADRATE_ADDRESS>" \
  "<POSITION_ROLLER_V3_ADDRESS>" \
  "<POSITION_FACTORY_V3_ADDRESS>" \
  "<FRONTEND_GATEWAY_V3_ADDRESS>" \
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
```

### 8.2 Funktionale Verifikation

**Nach Aktivierung testen:**

```javascript
// 1. Position mit ETH öffnen (Native)
const mintingHub = await ethers.getContractAt(
  "MintingHubGatewayV3",
  mintingHubGatewayV3Address
);

// Test-Position Parameter
const params = {
  collateral: MAINNET.WETH9,
  minCollateral: ethers.parseEther("0.1"),
  initialCollateral: ethers.parseEther("1"),
  mintingMaximum: ethers.parseEther("2000"),
  initPeriodSeconds: 3 * 24 * 60 * 60,  // 3 Tage (Genesis kann 0 sein)
  expirationSeconds: 365 * 24 * 60 * 60, // 1 Jahr
  challengeSeconds: 1 * 24 * 60 * 60,    // 1 Tag
  riskPremium: 30000,  // 3%
  liqPrice: ethers.parseEther("2000"),   // 2000 dEURO/ETH
  reservePPM: 200000,  // 20%
  frontendCode: ethers.ZeroHash
};

// Native ETH senden
const tx = await mintingHub.openPosition(
  params.collateral,
  params.minCollateral,
  params.initialCollateral,
  params.mintingMaximum,
  params.initPeriodSeconds,
  params.expirationSeconds,
  params.challengeSeconds,
  params.riskPremium,
  params.liqPrice,
  params.reservePPM,
  params.frontendCode,
  { value: params.initialCollateral }  // Native ETH!
);

const receipt = await tx.wait();
console.log("Position created:", receipt);
```

---

## 9. Frontend-Integration

### 9.1 Separate Reward-Systeme

**WICHTIG:** V2 und V3 haben getrennte Frontend-Reward-Pools!

| System | FrontendGateway | Registrierung |
|--------|-----------------|---------------|
| V2 Positionen | FrontendGatewayV1 | Bestehende Registrierungen |
| V3 Positionen | FrontendGatewayV3 | **Neue Registrierung nötig!** |
| Savings | FrontendGatewayV1 | Bestehende Registrierungen |

### 9.2 Frontend-Code registrieren

Frontend-Provider müssen sich bei FrontendGatewayV3 registrieren:

```javascript
const frontendGatewayV3 = await ethers.getContractAt(
  "FrontendGateway",
  frontendGatewayV3Address
);

// Frontend-Code generieren (z.B. aus Domain-Name)
const frontendCode = ethers.keccak256(ethers.toUtf8Bytes("my-frontend.com"));

// Registrieren
await frontendGatewayV3.registerFrontendCode(frontendCode);
```

### 9.3 Rewards abheben

```javascript
// Rewards prüfen
const codeInfo = await frontendGatewayV3.frontendCodes(frontendCode);
console.log("Balance:", ethers.formatEther(codeInfo.balance));

// Rewards abheben
await frontendGatewayV3.withdrawRewards(frontendCode);
```

---

## 10. Wichtige Hinweise

### 10.1 Irreversible Aktionen

| Aktion | Irreversibel? | Beschreibung |
|--------|---------------|--------------|
| FrontendGateway.init() | **JA** | Ownership wird aufgegeben |
| suggestMinter() | **JA** | Fee wird nicht zurückerstattet |
| Position öffnen | NEIN | Kann geschlossen werden |

### 10.2 Kosten-Übersicht

| Posten | Geschätzte Kosten |
|--------|-------------------|
| Deployment Gas (~10M Gas @ 30 gwei) | ~0.3 ETH |
| Application Fee | 1000 dEURO |
| **Total** | **~0.3 ETH + 1000 dEURO** |

### 10.3 Risiken

1. **Veto während Application Period**
   - Qualifizierte nDEPS-Holder können die Aktivierung verhindern
   - Die 1000 dEURO Fee ist in diesem Fall verloren

2. **FrontendGateway-Konfiguration**
   - Nach `init()` kann der MINTING_HUB nicht mehr geändert werden
   - Fehlerhafte Initialisierung erfordert komplett neues Deployment

3. **Erste Position (Genesis)**
   - Die erste Position pro Collateral kann die Init-Period überspringen
   - Dies ist beabsichtigt, da es keinen Challenger gibt

### 10.4 Support & Dokumentation

- **GitHub:** https://github.com/d-EURO/smartContracts
- **Docs:** https://docs.deuro.com
- **Frontend:** https://app.deuro.com

---

## Anhang: Vollständiges Deployment-Script

```javascript
// scripts/deploy-minting-hub-v3.js

const { ethers } = require("hardhat");

const MAINNET = {
  decentralizedEURO: "0xbA3f535bbCcCcA2A154b573Ca6c5A49BAAE0a3ea",
  equity: "0xc71104001A3CCDA1BEf1177d765831Bd1bfE8eE6",
  DEPSwrapper: "0x103747924E74708139a9400e4Ab4BEA79FFFA380",
  WETH9: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  mintingHubGatewayV2: "0x8B3c41c649B9c7085C171CbB82337889b3604618",
  savingsGateway: "0x073493d73258C4BEb6542e8dd3e1b2891C972303",
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Leadrate vom V2 System holen
  const mintingHubV2 = await ethers.getContractAt("IMintingHub", MAINNET.mintingHubGatewayV2);
  const leadrateAddress = await mintingHubV2.RATE();
  console.log("Leadrate:", leadrateAddress);

  // 1. PositionFactoryV3
  console.log("\n1. Deploying PositionFactoryV3...");
  const PositionFactory = await ethers.getContractFactory("PositionFactory");
  const positionFactoryV3 = await PositionFactory.deploy();
  await positionFactoryV3.waitForDeployment();
  console.log("   PositionFactoryV3:", await positionFactoryV3.getAddress());

  // 2. PositionRollerV3
  console.log("\n2. Deploying PositionRollerV3...");
  const PositionRoller = await ethers.getContractFactory("PositionRoller");
  const positionRollerV3 = await PositionRoller.deploy(MAINNET.decentralizedEURO);
  await positionRollerV3.waitForDeployment();
  console.log("   PositionRollerV3:", await positionRollerV3.getAddress());

  // 3. FrontendGatewayV3
  console.log("\n3. Deploying FrontendGatewayV3...");
  const FrontendGateway = await ethers.getContractFactory("FrontendGateway");
  const frontendGatewayV3 = await FrontendGateway.deploy(
    MAINNET.decentralizedEURO,
    MAINNET.DEPSwrapper
  );
  await frontendGatewayV3.waitForDeployment();
  console.log("   FrontendGatewayV3:", await frontendGatewayV3.getAddress());

  // 4. MintingHubGatewayV3
  console.log("\n4. Deploying MintingHubGatewayV3...");
  const MintingHubGatewayV3 = await ethers.getContractFactory("MintingHubGatewayV3");
  const mintingHubGatewayV3 = await MintingHubGatewayV3.deploy(
    MAINNET.decentralizedEURO,
    leadrateAddress,
    await positionRollerV3.getAddress(),
    await positionFactoryV3.getAddress(),
    await frontendGatewayV3.getAddress(),
    MAINNET.WETH9
  );
  await mintingHubGatewayV3.waitForDeployment();
  console.log("   MintingHubGatewayV3:", await mintingHubGatewayV3.getAddress());

  // 5. FrontendGatewayV3 initialisieren
  console.log("\n5. Initializing FrontendGatewayV3...");
  const initTx = await frontendGatewayV3.init(
    MAINNET.savingsGateway,
    await mintingHubGatewayV3.getAddress()
  );
  await initTx.wait();
  console.log("   FrontendGatewayV3 initialized");

  // 6. suggestMinter
  console.log("\n6. Suggesting MintingHubGatewayV3 as minter...");
  const deuro = await ethers.getContractAt("IDecentralizedEURO", MAINNET.decentralizedEURO);

  const applicationFee = ethers.parseEther("1000");
  const applicationPeriod = 14 * 24 * 60 * 60; // 14 days

  // Check dEURO balance
  const balance = await deuro.balanceOf(deployer.address);
  console.log("   dEURO balance:", ethers.formatEther(balance));

  if (balance < applicationFee) {
    console.log("   ERROR: Insufficient dEURO balance for application fee!");
    return;
  }

  const suggestTx = await deuro.suggestMinter(
    await mintingHubGatewayV3.getAddress(),
    applicationPeriod,
    applicationFee,
    "MintingHubV3 with Native ETH Support"
  );
  await suggestTx.wait();

  const activationTimestamp = await deuro.minters(await mintingHubGatewayV3.getAddress());
  console.log("   Minter suggested!");
  console.log("   Activation date:", new Date(Number(activationTimestamp) * 1000));

  // Summary
  console.log("\n========== DEPLOYMENT SUMMARY ==========");
  console.log("PositionFactoryV3:", await positionFactoryV3.getAddress());
  console.log("PositionRollerV3:", await positionRollerV3.getAddress());
  console.log("FrontendGatewayV3:", await frontendGatewayV3.getAddress());
  console.log("MintingHubGatewayV3:", await mintingHubGatewayV3.getAddress());
  console.log("==========================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

---

**Dokument erstellt:** 2025-12-15
**Version:** 1.0
**Autor:** Claude Code Assistant
