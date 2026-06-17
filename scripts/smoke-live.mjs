const apiBase = process.env.DREC_API_BASE_URL || "https://drec-content-os-api.fly.dev";
const webBase = process.env.DREC_WEB_URL || "https://drec-content-os.vercel.app";
const accessToken = process.env.DREC_ACCESS_TOKEN || "";
const actor = process.env.DREC_ACTOR || "codex-smoke";

const checks = [
  {
    name: "API health",
    url: `${apiBase}/health`,
    auth: false,
    validate: async (res) => {
      const data = await res.json();
      return data.ok === true && data.supabase_rest === "configured";
    },
  },
  {
    name: "Workflow status",
    url: `${apiBase}/workflow/status`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.workflow?.next_action?.title) && Array.isArray(data.workflow?.steps) && Boolean(data.security?.overall_status) && Boolean(data.automation?.overall_status);
    },
  },
  {
    name: "Weekly plan CSV",
    url: `${apiBase}/briefs/plan.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("brief_id,status,language,channel,format,pillar,funnel_stage,awareness_stage,topic,hook_primary,hook_alt1,hook_alt2,style_hint,cta_type,target_signal,compliance_notes,created_at");
    },
  },
  {
    name: "Security status",
    url: `${apiBase}/security/status`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status) && Array.isArray(data.checks) && data.direct_browser_supabase === "disabled_by_design";
    },
  },
  {
    name: "Access policy",
    url: `${apiBase}/security/access-policy`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.current_role)
        && data.current_actor === actor
        && Array.isArray(data.recommended_roles)
        && data.setup_env?.includes("DREC_OPERATOR_TOKEN")
        && data.enforced_scopes?.schedule?.some((item) => item.includes("scheduling"))
        && data.enforced_scopes?.metrics?.some((item) => item.includes("metrics"));
    },
  },
  {
    name: "Access control pack",
    url: `${apiBase}/security/access-control-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Access Control Pack")
        && text.includes("Recommended Roles")
        && text.includes("Actor Naming Rule")
        && text.includes("Rotation Rules");
    },
  },
  {
    name: "RLS hardening plan",
    url: `${apiBase}/security/rls-hardening-plan.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS RLS Hardening Plan")
        && text.includes("supabase/migrations/20260617040906_strict_server_only_rls.sql")
        && text.includes("## Apply Gate");
    },
  },
  {
    name: "Weekly report",
    url: `${apiBase}/weekly-report.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("## Workflow Readiness") && text.includes("Queue-ready assets") && text.includes("## Outcome Insights");
    },
  },
  {
    name: "Automation status",
    url: `${apiBase}/automation/status`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status) && Array.isArray(data.gates) && Object.prototype.hasOwnProperty.call(data.summary || {}, "ready_assets") && Object.prototype.hasOwnProperty.call(data.summary || {}, "scheduler_heartbeat");
    },
  },
  {
    name: "Launch readiness",
    url: `${apiBase}/operations/launch-readiness`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status)
        && Array.isArray(data.stages)
        && Object.prototype.hasOwnProperty.call(data.summary || {}, "ready_assets")
        && Object.prototype.hasOwnProperty.call(data, "can_use_for_manual_ops")
        && Array.isArray(data.usability?.safe_test_scope)
        && Array.isArray(data.usability?.not_ready_scope);
    },
  },
  {
    name: "Test run checklist",
    url: `${apiBase}/operations/test-run-checklist`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status) && Array.isArray(data.steps) && data.steps.some((step) => step.key === "handoff");
    },
  },
  {
    name: "Launch evidence",
    url: `${apiBase}/operations/launch-evidence.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Launch Evidence") && text.includes("## Can I Use It Now") && text.includes("## Manual Test Path") && text.includes("## Safe Go-Live Rule");
    },
  },
  {
    name: "First test kit",
    url: `${apiBase}/operations/first-test-kit.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS First Test Kit")
        && text.includes("## Copy/Paste Weekly Topics")
        && text.includes("## Sample Metric Entry After Manual Publishing")
        && text.includes("## Acceptance Criteria");
    },
  },
  {
    name: "Test run tracker",
    url: `${apiBase}/operations/test-run-tracker.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS First Test Run Tracker")
        && text.includes("## Step Tracker")
        && text.includes("## Pass Rule");
    },
  },
  {
    name: "Manual cycle QA",
    url: `${apiBase}/operations/manual-cycle-qa.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Manual Cycle QA")
        && text.includes("## QA Decision")
        && text.includes("## Risk QA")
        && text.includes("## Learning QA");
    },
  },
  {
    name: "Scheduler activation pack",
    url: `${apiBase}/operations/scheduler-activation-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Scheduler Activation Pack")
        && text.includes("DREC_ACCESS_TOKEN")
        && text.includes("## Safety Rules")
        && text.includes("DREC Scheduler Dry Run");
    },
  },
  {
    name: "Daily ops checklist",
    url: `${apiBase}/operations/daily-ops-checklist.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Daily Ops Checklist")
        && text.includes("## Morning Checks")
        && text.includes("Overdue scheduled")
        && text.includes("## Ready To Publish Today")
        && text.includes("## End-Of-Day Closeout");
    },
  },
  {
    name: "Content risk audit",
    url: `${apiBase}/operations/risk-audit`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status) && Array.isArray(data.items) && Object.prototype.hasOwnProperty.call(data.checked || {}, "assets");
    },
  },
  {
    name: "Operations snapshot",
    url: `${apiBase}/operations/snapshot.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("record_type,id,status,channel,format,title,created_at,detail") && text.includes("automation_gate");
    },
  },
  {
    name: "Pipeline board",
    url: `${apiBase}/operations/pipeline-board.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("pipeline_stage,next_action,brief_id,topic") && text.includes("detail");
    },
  },
  {
    name: "Audit trail",
    url: `${apiBase}/operations/audit-trail.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("created_at,module,ref_type,ref_id,action,role,actor,tags,reason,feedback_id");
    },
  },
  {
    name: "Creative pack",
    url: `${apiBase}/operations/creative-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Creative Pack") && text.includes("## Production Rules") && text.includes("## Active Knowledge Context");
    },
  },
  {
    name: "Media shot list",
    url: `${apiBase}/operations/media-shot-list.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("asset_id,topic,channel,format,review_status,safety_status,media_count,production_priority,visual_direction,shot_list,media_gap,rights_check,caption_preview");
    },
  },
  {
    name: "Asset review CSV",
    url: `${apiBase}/operations/asset-review.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("record_type,id,status,ready,blockers,channel,format,title_or_topic,review_status,compliance_status,media_type,rights_status,approval_status,media_count,source_or_media_urls,notes,created_at");
    },
  },
  {
    name: "Asset review worklist",
    url: `${apiBase}/operations/asset-review-worklist.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Asset Review Worklist")
        && text.includes("## Briefs To Save As Assets")
        && text.includes("## Ready To Queue")
        && text.includes("## Review Rules");
    },
  },
  {
    name: "Asset safety review",
    url: `${apiBase}/operations/asset-safety-review.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Asset Safety Review Pack")
        && text.includes("## Human Review Checklist")
        && text.includes("## Assets To Review")
        && text.includes("## Review Decision CSV Import")
        && text.includes("## Approval Rule");
    },
  },
  {
    name: "Asset review decisions CSV",
    url: `${apiBase}/operations/asset-review-decisions.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("asset_id,brief_id,topic,channel,format,current_safety,current_review,detector_status,detector_findings,media_count,target_signal,caption,recommended_action,reviewer_safety_decision,reviewer_review_decision,reviewer_name,review_notes");
    },
  },
  {
    name: "Asset review decisions import dry run",
    url: `${apiBase}/operations/import-asset-review-decisions`,
    method: "POST",
    auth: true,
    body: () => {
      const form = new FormData();
      const csv = [
        "asset_id,reviewer_safety_decision,reviewer_review_decision,reviewer_name,review_notes",
        "00000000-0000-0000-0000-000000000000,clear,approved,Smoke Test,Dry-run only",
      ].join("\n");
      form.append("file", new Blob([csv], { type: "text/csv" }), "asset-review-decisions-smoke.csv");
      form.append("dry_run", "true");
      return form;
    },
    validate: async (res) => {
      const data = await res.json();
      return data.dry_run === true && data.skipped_count === 1 && data.skipped?.[0]?.reason === "Asset not found.";
    },
  },
  {
    name: "Review log",
    url: `${apiBase}/operations/review-log.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Review Log") && text.includes("## Summary") && text.includes("## Recent Decisions");
    },
  },
  {
    name: "Editorial QA pack",
    url: `${apiBase}/operations/editorial-qa-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Editorial QA Pack")
        && text.includes("## QA Rules")
        && text.includes("## Editor Checklist");
    },
  },
  {
    name: "Review queue CSV",
    url: `${apiBase}/operations/review-queue.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("queue_id,asset_id,review_state,blockers,latest_feedback,latest_feedback_reason,latest_feedback_at,status,compliance_status,channel,format,planned_slot,media_count,media_urls,caption,created_at");
    },
  },
  {
    name: "Review-to-schedule pack",
    url: `${apiBase}/operations/review-to-schedule-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Review-to-Schedule Pack")
        && text.includes("## Safe Sequence")
        && text.includes("## Queue-Ready Assets")
        && text.includes("## Handoff Ready")
        && text.includes("## Safety Rules");
    },
  },
  {
    name: "Learning snapshot",
    url: `${apiBase}/operations/learning-snapshot.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("record_type,id,dimension,key,value,created_at,detail") && text.includes("raw_metric");
    },
  },
  {
    name: "Weekly cycle pack",
    url: `${apiBase}/operations/weekly-cycle-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Weekly Cycle Pack")
        && text.includes("## 1. Planning Inputs")
        && text.includes("## 3. Schedule And Handoff")
        && text.includes("## 4. Learning Closeout")
        && text.includes("## Weekly Closeout Rule");
    },
  },
  {
    name: "Metrics template",
    url: `${apiBase}/operations/metrics-template.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("row_type,source,external_post_id,captured_at,reach,likes,comments,saves,shares,leads,spend,format,channel,funnel_stage,metric_window,notes")
        && text.includes("instructions");
    },
  },
  {
    name: "Metrics closeout pack",
    url: `${apiBase}/operations/metrics-closeout-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Metrics Closeout Pack")
        && text.includes("## Closeout Sequence")
        && text.includes("## Waiting For Metrics")
        && text.includes("## Raw Metrics Waiting For Rollup")
        && text.includes("## Closeout Rules");
    },
  },
  {
    name: "Learning summary insights",
    url: `${apiBase}/learning-summary`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.outcome_insights?.summary) && Array.isArray(data.outcome_insights?.top_signals);
    },
  },
  {
    name: "Publishing run sheet",
    url: `${apiBase}/operations/publishing-run-sheet.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Publishing Run Sheet") && text.includes("## Shift Summary") && text.includes("## Ready To Publish");
    },
  },
  {
    name: "Operator pack",
    url: `${apiBase}/operations/operator-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Operator Pack") && text.includes("## Can I Use It Now") && text.includes("## Meta OAuth Guide") && text.includes("## Launch Readiness") && text.includes("## Content Risk Audit") && text.includes("## Review-To-Schedule Pack") && text.includes("## Review Decision CSV Import") && text.includes("## Publishing Handoff") && text.includes("## Weekly Operating Report");
    },
  },
  {
    name: "Meta readiness",
    url: `${apiBase}/meta/readiness`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status) && Array.isArray(data.required_permissions);
    },
  },
  {
    name: "Meta OAuth guide",
    url: `${apiBase}/meta/oauth-guide`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Array.isArray(data.required_scopes)
        && data.required_scopes.includes("pages_manage_posts")
        && typeof data.oauth_dialog_url_template === "string"
        && data.oauth_dialog_url_template.includes("dialog/oauth")
        && Array.isArray(data.meta_app_setup);
    },
  },
  {
    name: "Meta setup checklist",
    url: `${apiBase}/meta/setup-checklist`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Array.isArray(data.steps)
        && Array.isArray(data.setup_commands)
        && data.required_secrets?.includes("META_PAGE_ACCESS_TOKEN")
        && Array.isArray(data.oauth_guide?.required_scopes)
        && Array.isArray(data.activation_switchboard)
        && data.nightly_metrics_scheduler?.workflow_file?.includes("drec-nightly-meta-metrics.yml");
    },
  },
  {
    name: "Meta activation checklist",
    url: `${apiBase}/meta/activation-checklist.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("Meta Activation Checklist")
        && text.includes("Activation Switchboard")
        && text.includes("Required Live Sequence");
    },
  },
  {
    name: "Meta credential wizard",
    url: `${apiBase}/meta/credential-wizard`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Array.isArray(data.fields)
        && data.fields.some((field) => field.key === "META_PAGE_ACCESS_TOKEN")
        && Array.isArray(data.required_permissions)
        && data.required_permissions.some((item) => item.permission === "pages_manage_posts")
        && Array.isArray(data.hard_stop_rules);
    },
  },
  {
    name: "Meta credential wizard worksheet",
    url: `${apiBase}/meta/credential-wizard.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("Meta Credential Wizard")
        && text.includes("Credential Fields")
        && text.includes("Hard Stop Rules");
    },
  },
  {
    name: "Meta credential intake pack",
    url: `${apiBase}/meta/credential-intake-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("Meta Credential Intake Pack")
        && text.includes("Values To Collect")
        && text.includes("Go-Live Rules")
        && text.includes("Nightly Metrics Scheduler");
    },
  },
  {
    name: "Meta preflight audit",
    url: `${apiBase}/meta/preflight-audit`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status)
        && Array.isArray(data.gates)
        && data.gates.some((gate) => gate.key === "schedule_audit")
        && Array.isArray(data.hard_stop_rules);
    },
  },
  {
    name: "Meta preflight audit pack",
    url: `${apiBase}/meta/preflight-audit.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("Meta Preflight Audit")
        && text.includes("## Gates")
        && text.includes("Hard Stop Rules");
    },
  },
  {
    name: "Notification rail readiness",
    url: `${apiBase}/notifications/rail-readiness`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status)
        && data.send_status === "manual_pack_only"
        && Array.isArray(data.alerts)
        && Array.isArray(data.approval_rules)
        && data.webhook_templates?.n8n_event_name === "drec.notification.digest";
    },
  },
  {
    name: "WhatsApp approval rail pack",
    url: `${apiBase}/notifications/whatsapp-approval-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("WhatsApp Approval Rail Pack")
        && text.includes("n8n Webhook Plan")
        && text.includes("Approval Rules");
    },
  },
  {
    name: "Knowledge context",
    url: `${apiBase}/kb/context`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Object.prototype.hasOwnProperty.call(data, "entry_count") && Array.isArray(data.safety_rules) && Array.isArray(data.style_rules);
    },
  },
  {
    name: "Knowledge Base CSV",
    url: `${apiBase}/kb/export.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("id,category,title,body,tags,created_at");
    },
  },
  {
    name: "Insight Sense Brief",
    url: `${apiBase}/insights/sense-brief`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "sense_insight_inbox"
        && Array.isArray(data.input_categories)
        && Array.isArray(data.planning_topics)
        && Array.isArray(data.guardrails)
        && Object.prototype.hasOwnProperty.call(data, "signals_by_category");
    },
  },
  {
    name: "Insight Sense Brief pack",
    url: `${apiBase}/insights/sense-brief.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("Sense Brief")
        && text.includes("Signals By Category")
        && text.includes("Planning Topics");
    },
  },
  {
    name: "Schedule suggestion",
    url: `${apiBase}/publish-queue/suggest-slot?channel=facebook`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.suggested_slot) && data.timezone === "Asia/Kuala_Lumpur";
    },
  },
  {
    name: "Schedule audit",
    url: `${apiBase}/publish-queue/schedule-audit`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.overall_status)
        && Object.prototype.hasOwnProperty.call(data.checked || {}, "scheduled_or_planned")
        && Array.isArray(data.items);
    },
  },
  {
    name: "Schedule audit pack",
    url: `${apiBase}/publish-queue/schedule-audit.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Schedule Audit")
        && text.includes("Safe Scheduling Rules");
    },
  },
  {
    name: "Publishing calendar",
    url: `${apiBase}/publish-queue/calendar.ics`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("BEGIN:VCALENDAR") && text.includes("PRODID:-//DREC//Content OS//EN");
    },
  },
  {
    name: "Publishing schedule CSV",
    url: `${apiBase}/publish-queue/schedule.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("queue_id,asset_id,status,channel,format,planned_slot,compliance_status,external_post_id,handoff_ready,blockers,media_urls,caption,created_at");
    },
  },
  {
    name: "Brief-to-asset pack",
    url: `${apiBase}/briefs/asset-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Brief-To-Asset Pack")
        && text.includes("## Production Summary")
        && text.includes("## Brief Production Sheet")
        && text.includes("## Review Rules");
    },
  },
  {
    name: "Creative style library",
    url: `${apiBase}/creative/style-library`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Array.isArray(data.styles)
        && data.styles.some((style) => style.key === "edu_carousel_navy")
        && data.brand_tokens?.navy === "#0F2A4A"
        && Array.isArray(data.review_rules);
    },
  },
  {
    name: "Creative style guide",
    url: `${apiBase}/creative/style-guide.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("Creative Style Guide")
        && text.includes("Brand Tokens")
        && text.includes("Style Library");
    },
  },
  {
    name: "Template studio library",
    url: `${apiBase}/templates/library`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "static_template_engineering"
        && Array.isArray(data.templates)
        && data.templates.some((template) => template.key === "carousel_mechanism_5")
        && Array.isArray(data.render_rules)
        && Object.prototype.hasOwnProperty.call(data, "render_ready_count");
    },
  },
  {
    name: "Static render pack",
    url: `${apiBase}/templates/static-render-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("Static Render Pack")
        && text.includes("Template Library")
        && text.includes("QA Checklist");
    },
  },
  {
    name: "Video studio readiness",
    url: `${apiBase}/video/studio-readiness`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "future_drec_cut_manual_ready"
        && data.automation_status === "not_built_yet"
        && Array.isArray(data.sop_modules)
        && Array.isArray(data.hard_stop_rules)
        && Object.prototype.hasOwnProperty.call(data, "manual_edit_ready_count");
    },
  },
  {
    name: "Video SOP pack",
    url: `${apiBase}/video/sop-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("Video Studio SOP Pack")
        && text.includes("DREC Cut Automation Status")
        && text.includes("SOP Checklist");
    },
  },
  {
    name: "Composer dry run",
    url: `${apiBase}/composer/draft-post?dry_run=true`,
    method: "POST",
    auth: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: "facebook",
      format: "carousel",
      stage: "TOFU",
      language: "zh",
      topic: "composer smoke test only",
      points: ["Explain a safe education point.", "Avoid personal medical advice.", "Invite clinician discussion."],
      media_urls: [],
      style_key: "edu_carousel_navy",
      target_signal: "saves",
    }),
    validate: async (res) => {
      const data = await res.json();
      return data.mode === "dry_run"
        && data.brief?.topic === "composer smoke test only"
        && Array.isArray(data.creative?.caption_variants)
        && data.item === null;
    },
  },
  {
    name: "Published metrics source",
    url: `${apiBase}/metrics/published-source?limit=5`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Array.isArray(data.items) && Object.prototype.hasOwnProperty.call(data, "latest");
    },
  },
  {
    name: "Publishing job dry run",
    url: `${apiBase}/jobs/meta-publishing?dry_run=true&channel=all`,
    method: "POST",
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.job?.name === "meta-publishing" && data.job?.due_only === true && Array.isArray(data.results);
    },
  },
  {
    name: "Nightly metrics dry run",
    url: `${apiBase}/jobs/nightly-meta-metrics?dry_run=true&limit=5&rollup=true`,
    method: "POST",
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.mode === "dry_run" && data.job?.name === "nightly-meta-metrics" && Array.isArray(data.planned_requests);
    },
  },
  {
    name: "Web shell",
    url: webBase,
    auth: false,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("DREC") && text.includes("workflow-next") && text.includes("launch-count") && text.includes("token-input") && text.includes("copy-test-path") && text.includes("run-risk-audit") && text.includes("download-test-run-tracker") && text.includes("download-manual-cycle-qa") && text.includes("download-access-pack") && text.includes("download-rls-plan") && text.includes("download-snapshot") && text.includes("download-pipeline-board") && text.includes("download-audit-trail") && text.includes("download-operator-pack") && text.includes("Ready Assets") && text.includes("Learning Loop") && text.includes("Security Gate") && text.includes("Access Role") && text.includes("Automation Gate") && text.includes("Record Published") && text.includes("Save & Roll Up") && text.includes("Use Topics In Weekly Plan") && text.includes("Insight Inbox") && text.includes("download-sense-brief") && text.includes("download-plan-csv") && text.includes("download-brief-asset-pack") && text.includes("Creative Studio") && text.includes("download-style-guide") && text.includes("Template Studio") && text.includes("download-static-render-pack") && text.includes("Video Studio") && text.includes("download-video-sop") && text.includes("download-weekly-report") && text.includes("download-weekly-cycle-pack") && text.includes("download-learning-snapshot") && text.includes("download-metrics-template") && text.includes("download-metrics-closeout") && text.includes("preview-metrics-csv") && text.includes("import-metrics-csv") && text.includes("metrics-import-preview") && text.includes("save-all-assets") && text.includes("archive-drafted-briefs") && text.includes("approve-clear-assets") && text.includes("queue-ready-assets") && text.includes("download-creative-pack") && text.includes("download-media-shot-list") && text.includes("download-asset-review") && text.includes("download-asset-review-decisions") && text.includes("preview-asset-review-decisions") && text.includes("import-asset-review-decisions") && text.includes("download-asset-worklist") && text.includes("download-asset-safety-review") && text.includes("download-editorial-qa") && text.includes("download-review-schedule-pack") && text.includes("download-review-queue") && text.includes("download-review-log") && text.includes("download-run-sheet") && text.includes("download-calendar") && text.includes("download-schedule-csv") && text.includes("download-schedule-audit") && text.includes("schedule-approved-items") && text.includes("kb-context") && text.includes("copy-meta-setup") && text.includes("download-meta-wizard") && text.includes("download-meta-intake") && text.includes("download-meta-activation") && text.includes("download-meta-preflight") && text.includes("download-scheduler-pack") && text.includes("refresh-notify-rail") && text.includes("download-whatsapp-pack") && text.includes("dry-run-meta-publishing");
    },
  },
  {
    name: "Web script",
    url: `${webBase}/app.js`,
    auth: false,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("/workflow/status") && text.includes("/operations/launch-readiness") && text.includes("/operations/test-run-checklist") && text.includes("/operations/test-run-tracker.md") && text.includes("/operations/manual-cycle-qa.md") && text.includes("/operations/scheduler-activation-pack.md") && text.includes("/security/access-control-pack.md") && text.includes("/security/rls-hardening-plan.md") && text.includes("/security/access-policy") && text.includes("data-test-run-screen") && text.includes("/operations/risk-audit") && text.includes("/operations/snapshot.csv") && text.includes("/operations/pipeline-board.csv") && text.includes("/operations/audit-trail.csv") && text.includes("/operations/creative-pack.md") && text.includes("/operations/media-shot-list.csv") && text.includes("/operations/asset-review.csv") && text.includes("/operations/asset-review-decisions.csv") && text.includes("/operations/import-asset-review-decisions") && text.includes("/operations/asset-review-worklist.md") && text.includes("/operations/asset-safety-review.md") && text.includes("/operations/review-log.md") && text.includes("/operations/editorial-qa-pack.md") && text.includes("/operations/review-queue.csv") && text.includes("/operations/review-to-schedule-pack.md") && text.includes("/operations/learning-snapshot.csv") && text.includes("/operations/metrics-closeout-pack.md") && text.includes("/operations/weekly-cycle-pack.md") && text.includes("/operations/publishing-run-sheet.md") && text.includes("/operations/operator-pack.md") && text.includes("Existing queue item opened") && text.includes("function testPathText()") && text.includes("saveAccessTokenFromPanel") && text.includes("countByStatus") && text.includes("security-count") && text.includes("access-role-count") && text.includes("automation-count") && text.includes("Record Published: After manual posting") && text.includes("Save & Roll Up: Add metrics") && text.includes("Use Topics: Send learning recommendations") && text.includes("loadLearningTopicsIntoPlan") && text.includes("/insights/sense-brief") && text.includes("/insights/sense-brief.md") && text.includes("/briefs/plan.csv") && text.includes("/briefs/asset-pack.md") && text.includes("/creative/style-library") && text.includes("/creative/style-guide.md") && text.includes("/templates/library") && text.includes("/templates/static-render-pack.md") && text.includes("/video/studio-readiness") && text.includes("/video/sop-pack.md") && text.includes("/composer/draft-post") && text.includes("DREC Asset Safety Review Note") && text.includes("data-copy-asset-review") && text.includes("Outcome Insights") && text.includes("outcome_insights") && text.includes("needsReviewQueue") && text.includes("handoff_blockers") && text.includes("schedule-next") && text.includes("/publish-queue/calendar.ics") && text.includes("/publish-queue/schedule.csv") && text.includes("/publish-queue/schedule-audit.md") && text.includes("load-published-post") && text.includes("save-rollup-metric") && text.includes("renderMetricsImportPreview") && text.includes("/metrics/import-csv") && text.includes("/kb/context") && text.includes("Active Knowledge Context") && text.includes("/briefs/draft-assets") && text.includes("/briefs/archive-drafted") && text.includes("/assets/queue-ready") && text.includes("/publish-queue/schedule-approved") && text.includes("data-handoff-published") && text.includes("/meta/setup-checklist") && text.includes("/meta/credential-wizard.md") && text.includes("/meta/credential-intake-pack.md") && text.includes("/meta/activation-checklist.md") && text.includes("/meta/preflight-audit.md") && text.includes("/notifications/rail-readiness") && text.includes("/notifications/whatsapp-approval-pack.md") && text.includes("meta-setup-commands") && text.includes("GitHub Scheduler Setup") && text.includes("Nightly Metrics Scheduler") && text.includes("DREC_ENABLE_REAL_META_METRICS=true") && text.includes("schedulerHeartbeat.detail") && text.includes("scheduler_setup") && text.includes("nightly_metrics_scheduler") && text.includes("activation_switchboard") && text.includes("/jobs/meta-publishing?dry_run=true&channel=all");
    },
  },
];

function headersFor(check) {
  if (!check.auth) return {};
  return accessToken ? { "X-DREC-Access-Token": accessToken, "X-DREC-Actor": actor } : {};
}

async function runCheck(check) {
  const res = await fetch(check.url, {
    method: check.method || "GET",
    headers: { ...headersFor(check), ...(check.headers || {}) },
    body: typeof check.body === "function" ? check.body() : check.body,
  });
  if (!res.ok) {
    return { ok: false, name: check.name, detail: `${res.status} ${res.statusText}` };
  }
  const valid = await check.validate(res);
  return {
    ok: valid,
    name: check.name,
    detail: valid ? "ok" : "unexpected response",
  };
}

if (!accessToken) {
  console.error("DREC_ACCESS_TOKEN is required for protected API checks.");
  process.exit(2);
}

const results = [];
for (const check of checks) {
  try {
    results.push(await runCheck(check));
  } catch (error) {
    results.push({ ok: false, name: check.name, detail: error.message });
  }
}

for (const result of results) {
  const mark = result.ok ? "PASS" : "FAIL";
  console.log(`${mark} ${result.name}: ${result.detail}`);
}

const failed = results.filter((result) => !result.ok);
if (failed.length) {
  process.exit(1);
}
