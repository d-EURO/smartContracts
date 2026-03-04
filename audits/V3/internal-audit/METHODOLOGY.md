# Audit Methodology

**Project:** dEuro V3 Smart Contracts
**Framework:** Based on Trail of Bits' open-source audit checklist methodology
**Tool:** Claude Opus 4.6 (automated security analysis across 10 independent sessions)

---

## Approach

The audit was structured as 10 sequential phases, each executed in an isolated session to prevent context contamination. Phases build on prior results via written artifacts: each phase reads the reports from its dependencies and produces a standalone report. After all phases completed, findings were deduplicated and consolidated into a single final report.

---

## Phases

### Phase 1 — Architecture & Context

Foundation for all subsequent analysis. Produces deep architectural context including contract relationships, trust boundaries, invariant discovery, and data flow mapping.

**Dependencies:** None

### Phase 2 — Attack Surface Mapping

Enumerates all state-changing entry points, categorizes by access level (public, admin, role-restricted, contract-only), and maps call flows.

**Dependencies:** Phase 1

### Phase 3 — Secure Development Workflow

Runs Slither static analysis, checks for special features (upgradeability, ERC conformance, token integration), and performs manual review of security properties.

**Dependencies:** Phases 1, 2

### Phase 4 — Static Analysis (Semgrep)

Runs Semgrep with multiple rulesets (Decurity Solidity rules, security-audit, secrets, typescript) for complementary coverage to Slither.

**Dependencies:** Phase 1

### Phase 5 — Code Maturity Scorecard

Systematic assessment across 9 categories: arithmetic safety, auditing/events, access controls, complexity management, decentralization, documentation, MEV resistance, low-level manipulation, and testing.

**Dependencies:** Phases 1, 2, 3

### Phase 6 — Token Integration Analysis

Analyzes all token interactions against 20+ known weird ERC-20 patterns. Covers both the protocol's own tokens and external collateral/bridge token integrations.

**Dependencies:** Phases 1, 2

### Phase 7 — Specification Compliance

Verifies code behavior against README and whitepaper claims. Each specification claim is individually checked against the implementation.

**Dependencies:** Phase 1

### Phase 8 — Development Best Practices

Reviews codebase against Trail of Bits' development guidelines covering documentation, architecture, upgradeability, implementation quality, pitfalls, dependencies, and testing.

**Dependencies:** Phases 1, 2, 3

### Phase 9 — Variant Hunting

Takes specific vulnerability patterns found in prior phases and systematically hunts for additional instances across the full codebase.

**Dependencies:** All prior phases

### Phase 10 — Property-Based Testing Design

Designs invariants, handler actions, and edge-case tests based on all findings. Produces a fuzz testing plan targeting the highest-risk properties.

**Dependencies:** All prior phases

---

## Execution Rounds

Phases were executed in parallel where dependencies allowed:

| Round | Phases | Prerequisite |
|-------|--------|-------------|
| 1 | Phase 1 | — |
| 2 | Phases 2, 4, 7 | Round 1 |
| 3 | Phases 3, 6 | Round 2 |
| 4 | Phases 5, 8 | Round 3 |
| 5 | Phase 9 → 10 | All prior (sequential) |

After all phases completed, findings were deduplicated and consolidated into the final report.
