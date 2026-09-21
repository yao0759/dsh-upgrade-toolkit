# Issue 01 — `source summary requires notice form`

## Symptom
```
@deepseek-ai/dsh-session-format-v0-to-v1 refuses this format v0 Session:
user/message 10 source summary requires notice form
```
Old sessions fail to load with a "history load failed" toast.

## Root cause
A plugin `source` object has a `summary` field while its `form` is not
`"notice"`. Newer format validation rejects this. Typical offenders written by
older dsh-mnemon:

- `form: "instructions"` + `summary`
- `form: "recall"` + `summary`

The validator rule (from the reference package):
```ts
if (form === 'notice') stringValue(source.summary, ...)
else if (source.summary !== undefined)
  throw new SessionFormatError(`${label} summary requires notice form`)
```

## Fix
Remove the `summary` field for non-notice forms. It is a display title only;
the instructions body and recall data are preserved. Fleet-wide: run
`scripts/migrate-sessions.mjs --apply`.

## Verification
Re-run the tool (0 affected), confirm line count is unchanged, and open the
conversation in the UI.
