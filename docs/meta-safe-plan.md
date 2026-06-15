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
- Real Meta publishing is intentionally not enabled until credentials and review flow are ready.
