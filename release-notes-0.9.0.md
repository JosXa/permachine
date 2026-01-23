## Summary

- **Array merging for primitive values**: Arrays of primitives (strings, numbers, booleans, null) are now merged with deduplication when both base and machine configs contain arrays at the same key
- **Preserves order**: Base array order is preserved, machine values are appended (minus duplicates)
- **Strict validation**: Arrays containing objects or nested arrays throw an `ArrayMergeError` to prevent unexpected behavior

## Example

**Base config (`config.base.json`):**
```json
{
  "plugin": ["plugin-a", "plugin-b"]
}
```

**Machine config (`config.{machine=mymachine}.json`):**
```json
{
  "plugin": ["plugin-c", "plugin-a"]
}
```

**Merged output (`config.json`):**
```json
{
  "plugin": ["plugin-a", "plugin-b", "plugin-c"]
}
```

## Breaking Changes

Previously, machine arrays would **completely replace** base arrays. Now they are **merged with deduplication**. If you relied on the replacement behavior, you'll need to adjust your configs.

Arrays containing non-primitive values (objects, nested arrays) will now throw an error instead of being replaced silently.
