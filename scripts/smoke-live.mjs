const apiBase = process.env.DREC_API_BASE_URL || "https://drec-content-os-api.fly.dev";
const webBase = process.env.DREC_WEB_URL || "https://drec-content-os.vercel.app";
const flyUiBase = process.env.DREC_FLY_UI_URL || `${apiBase}/ui`;
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
    name: "Fly UI status",
    url: `${apiBase}/ui-status`,
    auth: false,
    validate: async (res) => {
      const data = await res.json();
      return data.mounted === true && data.index === true && data.script === true && data.path === "/ui/";
    },
  },
  {
    name: "Fly UI shell",
    url: `${flyUiBase}/`,
    auth: false,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("DREC")
        && text.includes("download-first-cycle-sprint-pack")
        && text.includes("download-first-cycle-sprint-tracker")
        && text.includes("download-cycle-command-center")
        && text.includes("download-cycle-evidence-ledger")
        && text.includes("first-cycle-sprint")
        && text.includes("download-doctor-review-polish")
        && text.includes("download-doctor-review-bridge")
        && text.includes("download-doctor-send-queue")
        && text.includes("download-service-role-pack")
        && text.includes("download-doctor-reply-inbox")
        && text.includes("doctor-review-polish")
        && text.includes("download-doctor-approval-request")
        && text.includes("doctor-reply-text")
        && text.includes("Use polished copy")
        && text.includes("preview-doctor-replies")
        && text.includes("import-doctor-replies")
        && text.includes("production-reply-text")
        && text.includes("preview-production-replies")
        && text.includes("import-production-replies")
        && text.includes("download-doctor-decision-worksheet")
        && text.includes("download-asset-media-attachments")
        && text.includes("download-production-reply-inbox")
        && text.includes("download-production-handoff-bridge")
        && text.includes("download-production-design-worksheet")
        && text.includes("preview-production-design-worksheet")
        && text.includes("import-production-design-worksheet")
        && text.includes("download-scheduler-health")
        && text.includes("download-scheduler-recovery")
        && text.includes("download-schedule-worksheet")
        && text.includes("preview-schedule-worksheet")
        && text.includes("import-schedule-worksheet")
        && text.includes("download-review-queue-decisions")
        && text.includes("preview-review-queue-decisions")
        && text.includes("import-review-queue-decisions");
    },
  },
  {
    name: "Fly UI script",
    url: `${flyUiBase}/app.js`,
    auth: false,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("/operations/doctor-decision-worksheet.csv")
        && text.includes("/security/service-role-install-pack.md")
        && text.includes("/operations/cycle-command-center.md")
        && text.includes("/operations/cycle-evidence-ledger.csv")
        && text.includes("/operations/doctor-review-bridge.md")
        && text.includes("/operations/doctor-send-queue.csv")
        && text.includes("/operations/doctor-review-polish-pack")
        && text.includes("/operations/doctor-review-polish-pack.md")
        && text.includes("/operations/doctor-reply-inbox-pack.md")
        && text.includes("renderDoctorReviewPolishPack")
        && text.includes("data-copy-doctor-polish")
        && text.includes("data-copy-doctor-polish-all")
        && text.includes("doctorPolishBatchText")
        && text.includes("caption_update")
        && text.includes("/operations/first-cycle-sprint-pack")
        && text.includes("/operations/first-cycle-sprint-pack.md")
        && text.includes("/operations/first-cycle-sprint-tracker.csv")
        && text.includes("renderFirstCycleSprintPack")
        && text.includes("data-copy-sprint-doctor")
        && text.includes("data-copy-sprint-production")
        && text.includes("data-copy-sprint-doctor-all")
        && text.includes("data-copy-sprint-production-all")
        && text.includes("sprintBatchText")
        && text.includes("/operations/doctor-approval-request.md")
        && text.includes("/operations/import-doctor-replies")
        && text.includes("/operations/import-production-replies")
        && text.includes("/operations/import-asset-media-attachments")
        && text.includes("/operations/production-handoff-bridge.md")
        && text.includes("/operations/production-reply-inbox-pack.md")
        && text.includes("/operations/production-design-worksheet.csv")
        && text.includes("/operations/import-production-design-worksheet")
        && text.includes("/operations/scheduler-health.md")
        && text.includes("/operations/scheduler-recovery-pack.md")
        && text.includes("data-copy-production-design")
        && text.includes("data-copy-production-design-all")
        && text.includes("/publish-queue/import-schedule-worksheet")
        && text.includes("/operations/import-review-queue-decisions")
        && text.includes("renderReviewQueueDecisionPreview");
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
    name: "Service role install pack",
    url: `${apiBase}/security/service-role-install-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Service Role Install Pack")
        && text.includes("fly secrets set -a drec-content-os-api SUPABASE_SERVICE_ROLE_KEY")
        && text.includes("ready_for_rls_hardening")
        && text.includes("Do not paste the service-role key");
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
      return text.includes("# DREC Content OS Launch Evidence")
        && text.includes("## Can I Use It Now")
        && text.includes("## Evidence Action Links")
        && text.includes("Doctor reply inbox")
        && text.includes("Production reply inbox")
        && text.includes("Meta preflight")
        && text.includes("Supabase RLS plan")
        && text.includes("## Manual Test Path")
        && text.includes("## Safe Go-Live Rule");
    },
  },
  {
    name: "First test kit",
    url: `${apiBase}/operations/first-test-kit.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS First Test Kit")
        && text.includes("## First-Test Action Links")
        && text.includes("Doctor reply inbox")
        && text.includes("Production reply inbox")
        && text.includes("Launch evidence")
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
        && text.includes("## Evidence Source Links")
        && text.includes("Production reply inbox")
        && text.includes("Metrics closeout")
        && text.includes("## Step Tracker")
        && text.includes("## Pass Rule");
    },
  },
  {
    name: "Cycle command center",
    url: `${apiBase}/operations/cycle-command-center.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Cycle Command Center")
        && text.includes("## Do Next")
        && text.includes("## Action Links")
        && text.includes("## Evidence To Collect")
        && text.includes("## Stop Rules")
        && text.includes("Doctor Review Bridge")
        && text.includes("Production Handoff Bridge");
    },
  },
  {
    name: "Cycle evidence ledger",
    url: `${apiBase}/operations/cycle-evidence-ledger.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("evidence_item,workflow_stage,current_status,recommended_source,operator_value,operator_name,evidence_time,notes,safe_use_note")
        && text.includes("Doctor message sent time")
        && text.includes("Production reply preview result")
        && text.includes("Current next action")
        && text.includes("Ledger only");
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
        && text.includes("## Current-Cycle Action Links")
        && text.includes("Doctor reply inbox")
        && text.includes("Production reply inbox")
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
    name: "Scheduler health",
    url: `${apiBase}/operations/scheduler-health`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "scheduler_health"
        && data.mode === "read_only_diagnostics"
        && Boolean(data.heartbeat)
        && Array.isArray(data.checks)
        && String(data.required_secret_scope || "").includes("admin");
    },
  },
  {
    name: "Scheduler health pack",
    url: `${apiBase}/operations/scheduler-health.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Scheduler Health Pack")
        && text.includes("without recording a fake heartbeat")
        && text.includes("admin token or legacy DREC_ACCESS_TOKEN");
    },
  },
  {
    name: "Scheduler recovery pack",
    url: `${apiBase}/operations/scheduler-recovery-pack`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "scheduler_recovery_pack"
        && data.mode === "operator_recovery_only"
        && data.links?.dry_run_workflow?.includes("drec-scheduler-dry-run.yml")
        && Array.isArray(data.manual_recovery_steps)
        && data.safety?.some((item) => item.includes("does not record a heartbeat"));
    },
  },
  {
    name: "Scheduler recovery markdown",
    url: `${apiBase}/operations/scheduler-recovery-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Scheduler Recovery Pack")
        && text.includes("## Manual Recovery Steps")
        && text.includes("Repository Secrets")
        && text.includes("not by faking heartbeat evidence");
    },
  },
  {
    name: "Daily ops checklist",
    url: `${apiBase}/operations/daily-ops-checklist.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Daily Ops Checklist")
        && text.includes("## Current-Cycle Action Links")
        && text.includes("Doctor reply inbox")
        && text.includes("Production reply inbox")
        && text.includes("Scheduler recovery")
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
    name: "Backup recovery pack",
    url: `${apiBase}/operations/backup-recovery-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Backup & Recovery Pack")
        && text.includes("## Required Exports")
        && text.includes("## Recovery Order")
        && text.includes("## Degraded Mode")
        && text.includes("Cloudflare R2");
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
    name: "Asset media attachment CSV",
    url: `${apiBase}/operations/asset-media-attachments.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("asset_id,brief_id,topic,channel,format,review_status,safety_status,current_media_urls,new_media_urls,visual_qa_status,rights_note,producer_name,production_notes");
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
    name: "Asset review session",
    url: `${apiBase}/operations/asset-review-session`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "asset_review_session"
        && data.mode === "human_review_required"
        && Array.isArray(data.session_items)
        && Array.isArray(data.decision_rules)
        && data.decision_rules.some((rule) => rule.includes("Safety Clear and Approve"));
    },
  },
  {
    name: "Asset review session pack",
    url: `${apiBase}/operations/asset-review-session.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Asset Review Session Pack")
        && text.includes("## Session Summary")
        && text.includes("## Decision Rules")
        && text.includes("## Review Items");
    },
  },
  {
    name: "Doctor approval pack",
    url: `${apiBase}/operations/doctor-approval-pack`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "doctor_approval_pack"
        && data.mode === "human_medical_review_only"
        && Array.isArray(data.review_items)
        && Array.isArray(data.rules)
        && data.rules.some((rule) => rule.includes("read-only"));
    },
  },
  {
    name: "Doctor approval request",
    url: `${apiBase}/operations/doctor-approval-request`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "doctor_approval_request"
        && data.mode === "copyable_doctor_review_request"
        && Array.isArray(data.request_items)
        && Array.isArray(data.safety)
        && data.safety.some((rule) => rule.includes("does not approve"));
    },
  },
  {
    name: "Doctor approval request markdown",
    url: `${apiBase}/operations/doctor-approval-request.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Doctor Approval Request")
        && text.includes("## Reply Format")
        && text.includes("Doctor reply template");
    },
  },
  {
    name: "Doctor approval markdown",
    url: `${apiBase}/operations/doctor-approval-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Doctor Approval Pack")
        && text.includes("## How To Record Decisions")
        && text.includes("Doctor Safety Checklist");
    },
  },
  {
    name: "Doctor review bridge",
    url: `${apiBase}/operations/doctor-review-bridge.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Doctor Review Bridge")
        && text.includes("## Copy This To Doctor")
        && text.includes("## Paste-Back Reply Template")
        && text.includes("Doctor Reply Text")
        && text.includes("read-only");
    },
  },
  {
    name: "Doctor send queue",
    url: `${apiBase}/operations/doctor-send-queue.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("asset_id,topic,channel,format,copy_to_doctor,doctor_reply_template")
        && text.includes("reply_preview_result")
        && text.includes("reply_import_result")
        && text.includes("Send queue only");
    },
  },
  {
    name: "Doctor review polish pack",
    url: `${apiBase}/operations/doctor-review-polish-pack`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "doctor_review_polish_pack"
        && data.mode === "suggested_copy_only"
        && Array.isArray(data.polish_items)
        && Array.isArray(data.safety)
        && data.safety.some((rule) => rule.includes("suggested-copy only"));
    },
  },
  {
    name: "Doctor review polish markdown",
    url: `${apiBase}/operations/doctor-review-polish-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Doctor Review Polish Pack")
        && text.includes("## Polished Review Items")
        && text.includes("Suggested polished copy")
        && text.includes("## Safety Rules");
    },
  },
  {
    name: "Doctor reply inbox pack",
    url: `${apiBase}/operations/doctor-reply-inbox-pack`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "doctor_reply_inbox_pack"
        && data.mode === "preview_before_import"
        && Array.isArray(data.reply_items)
        && Array.isArray(data.safety)
        && data.safety.some((rule) => rule.includes("Preview is required"));
    },
  },
  {
    name: "Doctor reply inbox markdown",
    url: `${apiBase}/operations/doctor-reply-inbox-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Doctor Reply Inbox Pack")
        && text.includes("## Copy/Paste Reply Template")
        && text.includes("Preview Steps")
        && text.includes("read-only");
    },
  },
  {
    name: "Doctor decision worksheet",
    url: `${apiBase}/operations/doctor-decision-worksheet.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("asset_id,topic,channel,format,current_safety,current_review,detector_status,recommended_decision")
        && text.includes("doctor_check_no_guaranteed_outcome")
        && text.includes("reviewer_safety_decision,reviewer_review_decision,reviewer_name,review_notes");
    },
  },
  {
    name: "Approval cockpit",
    url: `${apiBase}/operations/approval-cockpit`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "approval_cockpit"
        && data.mode === "human_approval_only"
        && Array.isArray(data.approval_items)
        && Array.isArray(data.rules)
        && data.rules.some((rule) => rule.includes("does not approve"));
    },
  },
  {
    name: "Approval cockpit pack",
    url: `${apiBase}/operations/approval-cockpit.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Approval Cockpit")
        && text.includes("## Approval Shortlist")
        && text.includes("## Rules")
        && text.includes("read-only and does not approve");
    },
  },
  {
    name: "Post-approval production",
    url: `${apiBase}/operations/post-approval-production`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "post_approval_production"
        && data.mode === "production_prep_only"
        && Array.isArray(data.production_items)
        && Array.isArray(data.rules)
        && data.rules.some((rule) => rule.includes("does not approve"));
    },
  },
  {
    name: "Post-approval production pack",
    url: `${apiBase}/operations/post-approval-production.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Post-Approval Production Pack")
        && text.includes("## Production Items")
        && text.includes("read-only and does not approve");
    },
  },
  {
    name: "Production handoff bridge",
    url: `${apiBase}/operations/production-handoff-bridge.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Production Handoff Bridge")
        && text.includes("## Copy This To Production")
        && text.includes("## Paste-Back Production Reply Template")
        && text.includes("Production Reply Text")
        && text.includes("read-only");
    },
  },
  {
    name: "Production reply inbox pack",
    url: `${apiBase}/operations/production-reply-inbox-pack`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "production_reply_inbox_pack"
        && data.mode === "preview_before_import"
        && Array.isArray(data.reply_items)
        && Array.isArray(data.safety)
        && data.safety.some((rule) => rule.includes("attach media/design URLs only"));
    },
  },
  {
    name: "Production reply inbox markdown",
    url: `${apiBase}/operations/production-reply-inbox-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Production Reply Inbox Pack")
        && text.includes("## Copy/Paste Production Reply Template")
        && text.includes("Preview Steps")
        && text.includes("read-only");
    },
  },
  {
    name: "Production design worksheet",
    url: `${apiBase}/operations/production-design-worksheet.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("asset_id,brief_id,topic,channel,format,stage,approval_score,canvas_spec,safe_headline")
        && text.includes("image_prompt")
        && text.includes("visual_qa_checklist")
        && text.includes("new_media_urls,visual_qa_status,rights_note,producer_name,production_notes");
    },
  },
  {
    name: "Pre-schedule gate",
    url: `${apiBase}/operations/pre-schedule-gate`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "pre_schedule_gate"
        && data.mode === "read_only_schedule_readiness"
        && Array.isArray(data.gate_items)
        && Array.isArray(data.rules)
        && data.rules.some((rule) => rule.includes("read-only"));
    },
  },
  {
    name: "Pre-schedule gate pack",
    url: `${apiBase}/operations/pre-schedule-gate.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Pre-Schedule Gate")
        && text.includes("## Gate Items")
        && text.includes("read-only and does not schedule");
    },
  },
  {
    name: "Today runbook",
    url: `${apiBase}/operations/today-runbook`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "today_runbook"
        && data.mode === "read_only_operator_sequence"
        && data.immediate_action
        && Array.isArray(data.gates)
        && data.links?.doctor_review_polish === "/operations/doctor-review-polish-pack.md"
        && data.links?.doctor_reply_inbox === "/operations/doctor-reply-inbox-pack.md"
        && data.links?.production_reply_inbox === "/operations/production-reply-inbox-pack.md"
        && data.links?.scheduler_recovery === "/operations/scheduler-recovery-pack.md"
        && data.links?.asset_media_attachments === "/operations/asset-media-attachments.csv";
    },
  },
  {
    name: "Today runbook pack",
    url: `${apiBase}/operations/today-runbook.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Today Runbook")
        && text.includes("## Do Next")
        && text.includes("## Download Links")
        && text.includes("Doctor Review Polish")
        && text.includes("Doctor Reply Inbox")
        && text.includes("Production Reply Inbox")
        && text.includes("Scheduler Recovery")
        && text.includes("read-only");
    },
  },
  {
    name: "Asset rewrite pack",
    url: `${apiBase}/operations/asset-rewrite-pack`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "asset_safe_rewrite"
        && data.mode === "suggested_rewrite_only"
        && Array.isArray(data.rewrite_items)
        && Array.isArray(data.rules)
        && data.rules.some((rule) => rule.includes("does not approve"));
    },
  },
  {
    name: "Asset rewrite markdown",
    url: `${apiBase}/operations/asset-rewrite-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Asset Safe Rewrite Pack")
        && text.includes("## Rewrite Summary")
        && text.includes("## Suggested Rewrites")
        && text.includes("read-only and does not change any saved asset");
    },
  },
  {
    name: "First cycle handoff",
    url: `${apiBase}/operations/first-cycle-handoff`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "first_cycle_handoff"
        && data.mode === "manual_safe_sequence"
        && Array.isArray(data.stages)
        && Array.isArray(data.safety_rules)
        && data.links?.doctor_reply_inbox === "/operations/doctor-reply-inbox-pack.md"
        && data.links?.production_reply_inbox === "/operations/production-reply-inbox-pack.md"
        && data.links?.pre_schedule_gate === "/operations/pre-schedule-gate.md"
        && data.links?.scheduler_recovery === "/operations/scheduler-recovery-pack.md"
        && data.safety_rules.some((rule) => rule.includes("do not approve"));
    },
  },
  {
    name: "First cycle handoff pack",
    url: `${apiBase}/operations/first-cycle-handoff.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS First Cycle Handoff Pack")
        && text.includes("## Manual Sequence")
        && text.includes("## Safety Rules")
        && text.includes("Apply detector-clear safe rewrites")
        && text.includes("Doctor Reply Inbox")
        && text.includes("Production Reply Inbox")
        && text.includes("Scheduler Recovery");
    },
  },
  {
    name: "First cycle sprint pack",
    url: `${apiBase}/operations/first-cycle-sprint-pack`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "first_cycle_sprint_pack"
        && data.mode === "read_only_coordination_pack"
        && Array.isArray(data.sprint_items)
        && Array.isArray(data.safety)
        && data.links?.doctor_reply_inbox === "/operations/doctor-reply-inbox-pack.md"
        && data.links?.production_reply_inbox === "/operations/production-reply-inbox-pack.md"
        && data.safety.some((rule) => rule.includes("read-only"));
    },
  },
  {
    name: "First cycle sprint markdown",
    url: `${apiBase}/operations/first-cycle-sprint-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS First Cycle Sprint Pack")
        && text.includes("Doctor reply template")
        && text.includes("Production reply template")
        && text.includes("Doctor Reply Inbox")
        && text.includes("Production Reply Inbox")
        && text.includes("## Safety Rules");
    },
  },
  {
    name: "First cycle sprint tracker CSV",
    url: `${apiBase}/operations/first-cycle-sprint-tracker.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("asset_id,topic,channel,format,doctor_decision,doctor_safety,doctor_reviewer,doctor_notes,production_media_urls,production_visual_qa,production_rights,production_producer,production_notes")
        && text.includes("safe_use_note");
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
    name: "Doctor reply import dry run",
    url: `${apiBase}/operations/import-doctor-replies`,
    method: "POST",
    auth: true,
    headers: { "Content-Type": "application/json" },
    body: () => JSON.stringify({
      dry_run: true,
      reviewer_name: "Smoke Test",
      reply_text: [
        "Asset ID: 00000000-0000-0000-0000-000000000000",
        "Decision: approve",
        "Safety: clear",
        "Use polished copy: yes",
        "Notes: Dry-run only",
      ].join("\n"),
    }),
    validate: async (res) => {
      const data = await res.json();
      return data.dry_run === true
        && data.skipped_count === 1
        && data.skipped?.[0]?.reason === "Asset not found."
        && data.safety?.some((item) => item.includes("does not queue"));
    },
  },
  {
    name: "Doctor polished copy import preview",
    url: `${apiBase}/operations/doctor-review-polish-pack`,
    auth: true,
    validate: async (res) => {
      const pack = await res.json();
      const item = pack.polish_items?.[0];
      if (!item?.asset_id) return pack.polish_count === 0;
      const preview = await fetch(`${apiBase}/operations/import-doctor-replies`, {
        method: "POST",
        headers: {
          ...headersFor({ auth: true }),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dry_run: true,
          reviewer_name: "Smoke Test",
          reply_text: [
            `Asset ID: ${item.asset_id}`,
            "Decision: approve",
            "Safety: clear",
            "Use polished copy: yes",
            "Notes: Dry-run polished-copy preview only",
          ].join("\n"),
        }),
      });
      if (!preview.ok) return false;
      const data = await preview.json();
      return data.dry_run === true
        && data.planned_count === 1
        && data.planned?.[0]?.use_polished_copy === true
        && data.planned?.[0]?.caption_update === "will_apply_polished_copy";
    },
  },
  {
    name: "Asset media attachment import dry run",
    url: `${apiBase}/operations/import-asset-media-attachments`,
    method: "POST",
    auth: true,
    body: () => {
      const form = new FormData();
      const csv = [
        "asset_id,new_media_urls,visual_qa_status,rights_note,producer_name,production_notes",
        "00000000-0000-0000-0000-000000000000,https://example.com/test.jpg,pending,Dry-run only,Smoke Test,Dry-run only",
      ].join("\n");
      form.append("file", new Blob([csv], { type: "text/csv" }), "asset-media-attachments-smoke.csv");
      form.append("dry_run", "true");
      return form;
    },
    validate: async (res) => {
      const data = await res.json();
      return data.dry_run === true && data.skipped_count === 1 && data.skipped?.[0]?.reason === "Asset not found.";
    },
  },
  {
    name: "Production reply import dry run",
    url: `${apiBase}/operations/import-production-replies`,
    method: "POST",
    auth: true,
    headers: { "Content-Type": "application/json" },
    body: () => JSON.stringify({
      dry_run: true,
      producer_name: "Smoke Test",
      reply_text: [
        "Asset ID: 00000000-0000-0000-0000-000000000000",
        "Media URLs: https://example.com/design.png",
        "Visual QA: passed",
        "Rights: owned",
        "Notes: Dry-run only",
      ].join("\n"),
    }),
    validate: async (res) => {
      const data = await res.json();
      return data.dry_run === true
        && data.skipped_count === 1
        && data.skipped?.[0]?.reason === "Asset not found."
        && data.safety?.some((item) => item.includes("does not approve"));
    },
  },
  {
    name: "Production design worksheet import dry run",
    url: `${apiBase}/operations/import-production-design-worksheet`,
    method: "POST",
    auth: true,
    body: () => {
      const form = new FormData();
      const csv = [
        "asset_id,new_media_urls,visual_qa_status,rights_note,producer_name,production_notes",
        "00000000-0000-0000-0000-000000000000,https://example.com/design.jpg,pending,Dry-run only,Smoke Designer,Dry-run design worksheet",
      ].join("\n");
      form.append("file", new Blob([csv], { type: "text/csv" }), "production-design-worksheet-smoke.csv");
      form.append("dry_run", "true");
      return form;
    },
    validate: async (res) => {
      const data = await res.json();
      return data.source === "production_design_worksheet"
        && data.dry_run === true
        && data.skipped_count === 1
        && data.skipped?.[0]?.reason === "Asset not found.";
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
    name: "Review queue decisions CSV",
    url: `${apiBase}/operations/review-queue-decisions.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("queue_id,asset_id,channel,format,review_state,compliance_status,media_count,caption,reviewer_action,reviewer_name,review_notes");
    },
  },
  {
    name: "Review queue decisions import dry run",
    url: `${apiBase}/operations/import-review-queue-decisions`,
    method: "POST",
    auth: true,
    body: () => {
      const form = new FormData();
      const csv = [
        "queue_id,reviewer_action,reviewer_name,review_notes",
        "00000000-0000-0000-0000-000000000000,approve,Smoke Test,Dry-run only",
      ].join("\n");
      form.append("file", new Blob([csv], { type: "text/csv" }), "review-queue-decisions-smoke.csv");
      form.append("dry_run", "true");
      return form;
    },
    validate: async (res) => {
      const data = await res.json();
      return data.dry_run === true && data.skipped_count === 1 && data.skipped?.[0]?.reason === "Queue item not found.";
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
    name: "Quarterly learning memo",
    url: `${apiBase}/learning/quarterly-memo`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return Boolean(data.period)
        && Array.isArray(data.posting_time_heatmap)
        && Array.isArray(data.next_actions)
        && Object.prototype.hasOwnProperty.call(data.summary || {}, "active_learning_weights");
    },
  },
  {
    name: "Quarterly learning memo pack",
    url: `${apiBase}/learning/quarterly-memo.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Quarterly Learning Memo")
        && text.includes("## Posting-Time Heat")
        && text.includes("## Weight-Change Log")
        && text.includes("## Next-Quarter Actions");
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
        && text.includes("## Current-Cycle Handoff Links")
        && text.includes("Doctor reply inbox")
        && text.includes("Production reply inbox")
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
      return text.includes("# DREC Content OS Publishing Run Sheet")
        && text.includes("## Shift Summary")
        && text.includes("## Current-Cycle Action Links")
        && text.includes("Doctor reply inbox")
        && text.includes("Production reply inbox")
        && text.includes("Metrics closeout")
        && text.includes("## Ready To Publish");
    },
  },
  {
    name: "Operator pack",
    url: `${apiBase}/operations/operator-pack.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Operator Pack")
        && text.includes("## Current-Cycle Action Links")
        && text.includes("Doctor reply inbox")
        && text.includes("Production reply inbox")
        && text.includes("Scheduler recovery")
        && text.includes("## Can I Use It Now")
        && text.includes("## Meta OAuth Guide")
        && text.includes("## Launch Readiness")
        && text.includes("## Content Risk Audit")
        && text.includes("## Review-To-Schedule Pack")
        && text.includes("## Review Decision CSV Import")
        && text.includes("## Publishing Handoff")
        && text.includes("## Weekly Operating Report");
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
    name: "Ads planning pack",
    url: `${apiBase}/insights/ads-planning`,
    auth: true,
    validate: async (res) => {
      const data = await res.json();
      return data.phase === "ads_planning_pre_meta"
        && data.mode === "manual_planning_only"
        && Array.isArray(data.candidate_tests)
        && Array.isArray(data.budget_rules)
        && data.budget_rules.some((rule) => rule.includes("never changes spend"));
    },
  },
  {
    name: "Ads planning markdown",
    url: `${apiBase}/insights/ads-planning.md`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("# DREC Content OS Ads Planning Pack")
        && text.includes("## Candidate Tests")
        && text.includes("## Budget Rules")
        && text.includes("manual media-buyer execution only");
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
    name: "Schedule worksheet CSV",
    url: `${apiBase}/publish-queue/schedule-worksheet.csv`,
    auth: true,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("queue_id,asset_id,channel,format,status,compliance_status,review_state,suggested_slot_utc,suggested_slot_myt,planned_slot,schedule_decision,scheduler_name,schedule_notes,media_urls,caption");
    },
  },
  {
    name: "Schedule worksheet import dry run",
    url: `${apiBase}/publish-queue/import-schedule-worksheet`,
    method: "POST",
    auth: true,
    body: () => {
      const form = new FormData();
      const future = new Date(Date.now() + 86400000).toISOString();
      const csv = [
        "queue_id,planned_slot,schedule_decision,scheduler_name,schedule_notes",
        `00000000-0000-0000-0000-000000000000,${future},schedule,Smoke Scheduler,Dry-run only`,
      ].join("\n");
      form.append("file", new Blob([csv], { type: "text/csv" }), "schedule-worksheet-smoke.csv");
      form.append("dry_run", "true");
      return form;
    },
    validate: async (res) => {
      const data = await res.json();
      return data.dry_run === true && data.skipped_count === 1 && data.skipped?.[0]?.reason === "Queue item not found.";
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
      return text.includes("DREC") && text.includes("workflow-next") && text.includes("launch-count") && text.includes("token-input") && text.includes("copy-test-path") && text.includes("run-risk-audit") && text.includes("download-test-run-tracker") && text.includes("download-manual-cycle-qa") && text.includes("download-access-pack") && text.includes("download-rls-plan") && text.includes("download-snapshot") && text.includes("download-backup-pack") && text.includes("download-pipeline-board") && text.includes("download-audit-trail") && text.includes("download-operator-pack") && text.includes("Ready Assets") && text.includes("Learning Loop") && text.includes("Security Gate") && text.includes("Access Role") && text.includes("Automation Gate") && text.includes("Record Published") && text.includes("Save & Roll Up") && text.includes("Use Topics In Weekly Plan") && text.includes("Insight Inbox") && text.includes("download-sense-brief") && text.includes("download-ads-planning") && text.includes("refresh-ads-planning") && text.includes("download-plan-csv") && text.includes("download-brief-asset-pack") && text.includes("Creative Studio") && text.includes("download-style-guide") && text.includes("Template Studio") && text.includes("download-static-render-pack") && text.includes("Video Studio") && text.includes("download-video-sop") && text.includes("download-weekly-report") && text.includes("download-weekly-cycle-pack") && text.includes("download-learning-snapshot") && text.includes("download-quarterly-memo") && text.includes("refresh-quarterly-memo") && text.includes("download-metrics-template") && text.includes("download-metrics-closeout") && text.includes("preview-metrics-csv") && text.includes("import-metrics-csv") && text.includes("metrics-import-preview") && text.includes("save-all-assets") && text.includes("archive-drafted-briefs") && text.includes("approve-clear-assets") && text.includes("queue-ready-assets") && text.includes("download-creative-pack") && text.includes("download-media-shot-list") && text.includes("download-asset-review") && text.includes("download-asset-review-decisions") && text.includes("preview-asset-review-decisions") && text.includes("import-asset-review-decisions") && text.includes("download-asset-worklist") && text.includes("download-asset-safety-review") && text.includes("download-asset-review-session") && text.includes("download-approval-cockpit") && text.includes("download-post-approval-production") && text.includes("download-asset-rewrite-pack") && text.includes("download-first-cycle-handoff") && text.includes("first-cycle-handoff") && text.includes("post-approval-production") && text.includes("download-editorial-qa") && text.includes("download-review-schedule-pack") && text.includes("download-pre-schedule-gate") && text.includes("download-review-queue") && text.includes("download-review-log") && text.includes("download-run-sheet") && text.includes("download-scheduler-pre-schedule-gate") && text.includes("download-calendar") && text.includes("download-schedule-csv") && text.includes("download-schedule-audit") && text.includes("schedule-approved-items") && text.includes("pre-schedule-gate") && text.includes("kb-context") && text.includes("copy-meta-setup") && text.includes("download-meta-wizard") && text.includes("download-meta-intake") && text.includes("download-meta-activation") && text.includes("download-meta-preflight") && text.includes("download-scheduler-pack") && text.includes("refresh-notify-rail") && text.includes("download-whatsapp-pack") && text.includes("dry-run-meta-publishing");
    },
  },
  {
    name: "Web script",
    url: `${webBase}/app.js`,
    auth: false,
    validate: async (res) => {
      const text = await res.text();
      return text.includes("/workflow/status") && text.includes("/operations/launch-readiness") && text.includes("/operations/test-run-checklist") && text.includes("/operations/test-run-tracker.md") && text.includes("/operations/manual-cycle-qa.md") && text.includes("/operations/scheduler-activation-pack.md") && text.includes("/security/access-control-pack.md") && text.includes("/security/rls-hardening-plan.md") && text.includes("/security/access-policy") && text.includes("data-test-run-screen") && text.includes("/operations/risk-audit") && text.includes("/operations/snapshot.csv") && text.includes("/operations/backup-recovery-pack.md") && text.includes("/operations/pipeline-board.csv") && text.includes("/operations/audit-trail.csv") && text.includes("/operations/creative-pack.md") && text.includes("/operations/media-shot-list.csv") && text.includes("/operations/asset-review.csv") && text.includes("/operations/asset-review-decisions.csv") && text.includes("/operations/import-asset-review-decisions") && text.includes("/operations/asset-review-worklist.md") && text.includes("/operations/asset-safety-review.md") && text.includes("/operations/asset-review-session") && text.includes("/operations/asset-review-session.md") && text.includes("/operations/approval-cockpit") && text.includes("loadApprovalCockpit") && text.includes("/operations/post-approval-production") && text.includes("loadPostApprovalProduction") && text.includes("productionBatchText") && text.includes("/operations/pre-schedule-gate") && text.includes("loadPreScheduleGate") && text.includes("/operations/asset-rewrite-pack") && text.includes("/operations/asset-rewrite-pack.md") && text.includes("/operations/first-cycle-handoff") && text.includes("loadFirstCycleHandoff") && text.includes("/caption") && text.includes("/assets/apply-safe-rewrites") && text.includes("data-apply-all-safe-rewrites") && text.includes("/operations/review-log.md") && text.includes("/operations/editorial-qa-pack.md") && text.includes("/operations/review-queue.csv") && text.includes("/operations/review-to-schedule-pack.md") && text.includes("/operations/learning-snapshot.csv") && text.includes("/learning/quarterly-memo") && text.includes("/learning/quarterly-memo.md") && text.includes("/operations/metrics-closeout-pack.md") && text.includes("/operations/weekly-cycle-pack.md") && text.includes("/operations/publishing-run-sheet.md") && text.includes("/operations/operator-pack.md") && text.includes("Existing queue item opened") && text.includes("function testPathText()") && text.includes("saveAccessTokenFromPanel") && text.includes("countByStatus") && text.includes("security-count") && text.includes("access-role-count") && text.includes("automation-count") && text.includes("Record Published: After manual posting") && text.includes("Save & Roll Up: Add metrics") && text.includes("Use Topics: Send learning recommendations") && text.includes("loadLearningTopicsIntoPlan") && text.includes("/insights/sense-brief") && text.includes("/insights/sense-brief.md") && text.includes("/insights/ads-planning") && text.includes("/insights/ads-planning.md") && text.includes("/briefs/plan.csv") && text.includes("/briefs/asset-pack.md") && text.includes("/creative/style-library") && text.includes("/creative/style-guide.md") && text.includes("/templates/library") && text.includes("/templates/static-render-pack.md") && text.includes("/video/studio-readiness") && text.includes("/video/sop-pack.md") && text.includes("/composer/draft-post") && text.includes("DREC Asset Safety Review Note") && text.includes("data-copy-asset-review") && text.includes("Outcome Insights") && text.includes("outcome_insights") && text.includes("needsReviewQueue") && text.includes("handoff_blockers") && text.includes("schedule-next") && text.includes("/publish-queue/calendar.ics") && text.includes("/publish-queue/schedule.csv") && text.includes("/publish-queue/schedule-audit.md") && text.includes("load-published-post") && text.includes("save-rollup-metric") && text.includes("renderMetricsImportPreview") && text.includes("/metrics/import-csv") && text.includes("/kb/context") && text.includes("Active Knowledge Context") && text.includes("/briefs/draft-assets") && text.includes("/briefs/archive-drafted") && text.includes("/assets/queue-ready") && text.includes("/publish-queue/schedule-approved") && text.includes("data-handoff-published") && text.includes("/meta/setup-checklist") && text.includes("/meta/credential-wizard.md") && text.includes("/meta/credential-intake-pack.md") && text.includes("/meta/activation-checklist.md") && text.includes("/meta/preflight-audit.md") && text.includes("/notifications/rail-readiness") && text.includes("/notifications/whatsapp-approval-pack.md") && text.includes("meta-setup-commands") && text.includes("GitHub Scheduler Setup") && text.includes("Nightly Metrics Scheduler") && text.includes("DREC_ENABLE_REAL_META_METRICS=true") && text.includes("schedulerHeartbeat.detail") && text.includes("scheduler_setup") && text.includes("nightly_metrics_scheduler") && text.includes("activation_switchboard") && text.includes("/jobs/meta-publishing?dry_run=true&channel=all");
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
