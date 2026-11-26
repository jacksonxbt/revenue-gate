# OpenFour integration

`modules/RevenueGateMigrateModule.sol` is our OpenFour Hub mechanism: a Migrate module that lets a token graduate only when its sale conditions are met and its RevenueGate contract reports the gate open.

`interfaces/`, `libraries/` and `helpers/` are copied unchanged from the FairLaunch starter in
https://github.com/four-meme-community/openfour-docs (`developer/startup/contracts`, MIT per their SPDX headers).
The module itself is adapted from that starter's `FairLaunchMigrateModule.sol`.

Compiler settings match OpenFour: solc 0.8.24, optimizer 200 runs, viaIR.

## Testnet deployment (BNB testnet, chain 97)

Deployed on a developer-owned OpenFour fork created with `developer/fork-deploy` from openfour-docs. It is not the official OpenFour registry.

- Fork addresses: `deployments/bsctestnet-fork.json` (Core `0x47bbd1Fef75cD12EE89d66375652DFDaC3D34f15`)
- Preset registration: `deployments/bsctestnet-revenue-gate-preset.json` (preset id `1795681909735`)
- Preset used to create the token: `presets/revenue-gate.json`
- Validator source: `validators/RevenueGatePresetValidator.sol.txt` (the starter's FairLaunch validator with `revenueGate` added to the migrate params; kept as text because its interface is not vendored here)
- Token: Revenue Gate Demo (RGATE) `0xBb9C33F7c3A0813ed8b7DC767ce577DF305816aE`
- Create tx `0xef7abaacc087fee08fd6b0c336cfb67e420c745c9dbcafea5e32049cc69c304c`
- Buy tx `0xa051b3f4dc4e70b3782c218e252943bb8740f8aca02a83e0168d795b83ddc36d` raised 0.002 tBNB against a 0.001 soft cap.

Observed on 26 Nov 2026: after that buy the token stayed in the Trading phase with no `MigrateExecuted` event, and the module's `evaluate()` (read as Core) returned `canMigrate = false`, reason "Revenue gate closed: verified product payments are below the threshold". The allowed path has only been exercised in unit tests, because no payment has yet scored 60 or more on the live gate.
