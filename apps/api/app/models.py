from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class KnowledgeEntryIn(BaseModel):
    category: str = Field(..., examples=["brand_voice", "offer", "compliance"])
    title: str
    body: str
    tags: List[str] = []


class ContentBriefIn(BaseModel):
    channel: Literal["organic", "ads"] = "organic"
    format: Literal["reel", "carousel", "single", "story"] = "carousel"
    pillar: Optional[str] = None
    funnel_stage: Optional[Literal["TOFU", "MOFU", "BOFU"]] = "TOFU"
    awareness_stage: Optional[str] = None
    topic: str
    hook_primary: Optional[str] = None
    hook_alt1: Optional[str] = None
    hook_alt2: Optional[str] = None
    structure_beats: Dict[str, Any] = {}
    style_hint: Optional[str] = None
    cta_type: Optional[str] = None
    target_signal: Optional[str] = None
    language: Optional[str] = "zh"
    compliance_notes: Optional[str] = None


class AssetIn(BaseModel):
    brief_id: Optional[str] = None
    channel: Literal["facebook", "instagram", "organic"] = "facebook"
    format: Literal["reel", "carousel", "single", "story"] = "carousel"
    caption: Optional[str] = None
    media_urls: List[str] = []
    metadata: Dict[str, Any] = {}
    compliance_status: Literal["pending", "clear", "flagged"] = "pending"
    review_status: Literal["draft", "review", "approved", "rejected"] = "draft"


class CreativeDraftIn(BaseModel):
    channel: Literal["facebook", "instagram"] = "facebook"
    format: Literal["reel", "carousel", "single", "story"] = "carousel"
    stage: Literal["TOFU", "MOFU", "BOFU"] = "TOFU"
    language: Literal["zh", "en", "mixed"] = "zh"
    topic: str
    points: List[str] = []
    style_key: str = "edu_carousel_navy"
    target_signal: Optional[str] = None


class WeeklyPlanIn(BaseModel):
    topics: List[str] = []
    language: Literal["zh", "en", "mixed"] = "zh"
    count: int = 5


class PublishQueueIn(BaseModel):
    asset_id: Optional[str] = None
    channel: Literal["facebook", "instagram"]
    format: Literal["carousel", "single", "reel", "story"]
    caption: str
    media_urls: List[str] = []
    planned_slot: Optional[datetime] = None
    compliance_status: Literal["pending", "clear", "flagged"] = "pending"


class PublishQueueStatusIn(BaseModel):
    status: Literal["draft", "scheduled", "publishing", "published", "failed", "cancelled"]


class ComplianceCheckIn(BaseModel):
    text: str


class ComplianceFinding(BaseModel):
    rule_id: str
    severity: Literal["block", "warn"]
    message: str
    matches: List[str] = []


class ComplianceCheckOut(BaseModel):
    status: Literal["clear", "pending", "flagged"]
    findings: List[ComplianceFinding]
    recommendation: str


class MetricIn(BaseModel):
    source: Literal["facebook", "instagram", "ads", "manual"]
    external_post_id: str
    captured_at: datetime
    metrics: Dict[str, Any]


class OutcomeIn(BaseModel):
    post_id: str
    pillar: Optional[str] = None
    funnel_stage: Optional[Literal["TOFU", "MOFU", "BOFU"]] = None
    hook_archetype: Optional[str] = None
    style_key: Optional[str] = None
    format: Optional[Literal["reel", "carousel", "single", "story"]] = None
    channel: Optional[Literal["facebook", "instagram", "manual"]] = None
    audience_label: Optional[str] = None
    published_at: Optional[datetime] = None
    metric_window: Literal["7d", "28d", "90d"] = "7d"
    score: Optional[float] = None
    watch_metric: Optional[float] = None
    shares: Optional[int] = None
    saves: Optional[int] = None
    cpl: Optional[float] = None
    vs_plan_note: Optional[str] = None


class FeedbackIn(BaseModel):
    module: str
    ref_type: str
    ref_id: str
    action: Literal["approve", "edit", "regen", "reject"]
    reason: Optional[str] = None
    before_text: Optional[str] = None
    after_text: Optional[str] = None
    tags: List[str] = []
