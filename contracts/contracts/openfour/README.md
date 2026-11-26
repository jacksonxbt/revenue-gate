# OpenFour integration

`modules/RevenueGateMigrateModule.sol` is our OpenFour Hub mechanism: a Migrate module that lets a token graduate only when its sale conditions are met and its RevenueGate contract reports the gate open.

`interfaces/`, `libraries/` and `helpers/` are copied unchanged from the FairLaunch starter in
https://github.com/four-meme-community/openfour-docs (`developer/startup/contracts`, MIT per their SPDX headers).
The module itself is adapted from that starter's `FairLaunchMigrateModule.sol`.

Compiler settings match OpenFour: solc 0.8.24, optimizer 200 runs, viaIR.
