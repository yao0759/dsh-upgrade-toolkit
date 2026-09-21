# Issue 04 — dsh-pocket fails to activate

## Symptom
```
Error: cannot get property "webServer" without inject
DSH Host Connection RPC unavailable
1 entry did not activate
```

## Fix
Upgrade dsh-pocket to the release matching the new Host (2.10.6 for the
0.1.6-alpha jump). Use the profile's own pnpm store to avoid
`ERR_PNPM_UNEXPECTED_STORE`.

# Issue 05 — dsh-mnemon settings RPC

## Symptom
Memory system settings fail to load; UI asks whether the Host granted the
settings RPC.

## Fix
1. Upgrade dsh-mnemon 0.4.4 → 0.5.12.
2. Set `remoteAccess: trusted-host` in the profile patch (see
   `config/cordis.patch.example.yml`).
3. Restart and use the new token.
