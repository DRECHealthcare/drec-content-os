# Meta Safe Publishing Plan

The DREC Content OS connects to Meta in a conservative order:

1. Keep human review before every publish.
2. Run a compliance check before a caption enters the publish queue.
3. Block high-risk medical claims from queueing.
4. Allow scheduling only when `compliance_status` is `clear`.
5. Connect Facebook Page publishing first.
6. Connect Instagram publishing after Facebook is stable.
7. Add metrics ingestion after publishing is verified.

Required Meta values:

```text
META_APP_ID
META_APP_SECRET
META_PAGE_ID
META_IG_USER_ID
META_PAGE_ACCESS_TOKEN
```

Initial permissions to request:

```text
pages_show_list
pages_read_engagement
pages_manage_posts
instagram_basic
instagram_content_publish
```

Content safety baseline:

- No guaranteed reversal, cure, weight-loss, HbA1c, or lab-result promises.
- No copy that implies the viewer personally has a medical condition.
- No patient story, report, photo, or testimonial without consent and anonymization.
- Before/after framing needs careful context and manual review.
- Educational content should not diagnose, prescribe, or replace professional care.

Current system behavior:

- `/compliance/check` returns `clear`, `pending`, or `flagged`.
- `/publish-queue` rejects flagged captions.
- `/publish-queue/{id}` rejects scheduling unless the item is compliance-clear.
- `/meta/readiness` checks whether Meta app, Page, IG user, token, and required permissions are ready.
- `/meta/setup-checklist` returns missing credentials, missing token permissions, setup steps, and copy-ready Fly command templates without storing secret values in the browser.
- `/publishing/facebook/dispatch` dry-runs the next eligible Facebook item and blocks real publishing unless credentials are ready and `META_ENABLE_PUBLISHING=true`.
- `/jobs/meta-publishing` wraps Facebook and Instagram dispatch as a scheduler-ready job. It dry-runs by default, only looks at due scheduled posts, and blocks real publishing unless `META_ENABLE_PUBLISHING=true` and `META_ENABLE_PUBLISHING_JOB=true`.
- `/metrics/meta/ingest` dry-runs published-post metric ingestion and blocks real ingestion until Meta readiness is green.
- `/jobs/nightly-meta-metrics` wraps Meta metrics ingestion as a scheduler-ready nightly job. It dry-runs by default and blocks real writes unless Meta readiness is green and `META_ENABLE_METRICS_JOB=true`.
- Real Meta publishing is intentionally not enabled until credentials and review flow are ready.
