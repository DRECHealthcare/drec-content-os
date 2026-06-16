# Operator Test Runbook

Use this runbook to test one full DREC Content OS cycle on the live app without
connecting Meta auto-publishing yet.

Live app:

```text
https://drec-content-os.vercel.app
```

## Before Testing

1. Open the live app.
2. Confirm the top button says `Access set`.
3. On Dashboard, read `Next Best Action`.
4. If the page looks stale, click `Refresh` in the Next Best Action card.

## Full Workflow Test

### 1. Weekly Plan To Asset

Goal: turn one brief into one reusable draft asset.

1. Open `Weekly Plan`.
2. Pick one brief.
3. Click `Save All Assets`, or use `Save Asset` on one brief when testing a single item.
4. Expected result:
   - You are moved to `Assets`.
   - Draft assets appear.
   - If the same brief was already saved, the app says `Existing draft asset opened.`

Pass condition: assets exist for the selected briefs, without duplicate copies.

### 2. Asset Safety And Review

Goal: make an asset queue-ready.

1. In `Assets`, review the caption package, variants, slides, or reel script.
2. Click `Safety Clear` if it is safe for DREC educational publishing.
3. Click `Approve` if the creative package is ready, or use `Approve Clear Assets` after reviewing multiple safety-clear assets.
4. Expected result:
   - The asset shows `clear`.
   - The asset shows `approved`.
   - The asset says `Ready for queue.`
   - `Add To Queue` becomes enabled.

Pass condition: the asset is both safety-clear and approved.

### 3. Asset To Queue

Goal: move the approved asset into the publishing workflow.

1. Click `Add To Queue`.
   - For multiple approved clear assets, click `Queue Ready Assets`.
2. Expected result:
   - You are moved to `Review Queue`.
   - The queued item appears.
   - If the item already exists, the app says `Existing queue item opened.`

Pass condition: one active queue item exists for the asset, without duplicates.

### 4. Queue Review

Goal: record human review before scheduling.

1. In `Review Queue`, click `Approve`.
2. Expected result:
   - The item displays as `approved`.
   - It also says it is ready to schedule.
   - It is not treated as published or scheduled yet.

Pass condition: the item is approved-but-unscheduled.

### 5. Scheduling

Goal: give the approved item a real planned time.

1. Open `Scheduler`.
2. Find the approved queue item.
3. Click `Suggest Slot`.
5. Expected result:
   - The item status becomes `scheduled`.
   - The app chooses the next open DREC publishing slot in MYT.
   - It appears in the next-7-days operating view if the date is within seven days.

Pass condition: the queue item is scheduled and has a planned time.

### 6. Manual Publishing Handoff

Goal: produce the manual handoff while Meta auto-publishing is locked.

1. In `Scheduler`, click `Build Handoff`.
2. Expected result:
   - The scheduled, compliance-clear item appears under `Ready To Publish`.
   - Items without planned time stay out of the ready list.
3. Click `Copy Handoff` if you want to paste it into a manual publishing task.

Pass condition: only scheduled, safety-clear items with planned time are ready.

### 7. Mark Published

Goal: connect manual publishing back to learning.

1. After manually publishing on Meta, copy the Meta post ID.
2. In `Scheduler`, click `Mark Published`.
3. Paste the post ID.
4. Expected result:
   - The item becomes `published`.
   - The Meta post ID is visible on the queue item.

Pass condition: the post ID is stored against the queue item.

### 8. Performance And Learning

Goal: feed results back into future planning.

1. Open `Performance`.
2. Click `Load Published Post` to fill the latest published Meta post ID and context.
3. Enter raw metrics or save a manual outcome.
4. Use `Roll Up Metric` if raw metrics were entered.
5. Open `Learning`.
5. Click `Build Weekly Report`.
6. Expected result:
   - Weekly report includes workflow readiness.
   - It includes queue-ready asset counts.
   - It includes recent results and next topic recommendations.

Pass condition: results appear in Performance and the weekly report updates.

## Meta Setup Test

1. Open `Meta Setup`.
2. Click `Refresh`.
3. Expected result before credentials:
   - Overall status is `not_connected`.
   - Missing credentials/permissions are listed.
   - Facebook and Instagram remain blocked.

Pass condition: Meta remains safely blocked until credentials are connected.

## Deploy Verification

Before a deploy:

```bash
npm run smoke:contract
```

After a deploy:

```bash
DREC_ACCESS_TOKEN="..." npm run smoke:live
```

Both checks should pass before continuing manual testing.
