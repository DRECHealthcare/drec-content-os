# Weekly Loop

## Monday 02:00

SENSE:

- Pull organic metrics for the last 28 days
- Pull active ad metrics
- Snapshot competitor/ad-library observations
- Write rows to `raw_metrics`

## Monday 08:00

DECIDE:

- Read KB, 28-day metrics, and 90-day outcome summary
- Generate weekly plan and briefs
- Hold plan for human approval

## Monday to Thursday

CREATE + REVIEW:

- Route carousel/single briefs to Creative Engine
- Route reel briefs to script workflow
- Run shared compliance checks
- Capture approvals, edits, regenerations, and rejects in `feedback`

## On Approval

PUBLISH:

- Create `publish_queue` rows
- Facebook uses native scheduling
- Instagram uses a 60-second worker tick

## Daily

MEASURE + LEARN:

- Attach post IDs to assets
- Update outcomes
- Log weight changes only when sample thresholds are met
