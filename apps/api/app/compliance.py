import re
from typing import Dict, List


RULES = [
    {
        "rule_id": "no_guaranteed_outcomes",
        "severity": "block",
        "message": "Avoid guaranteed reversal, cure, weight loss, or lab-result promises.",
        "patterns": [
            r"\bguarantee(?:d|s)?\b",
            r"\bcure(?:d|s)?\b",
            r"\breverse(?:d|s)?\b.{0,24}\b(?:diabetes|insulin|hba1c|a1c)\b",
            r"\b(?:diabetes|insulin|hba1c|a1c)\b.{0,24}\breverse(?:d|s)?\b",
            r"保证",
            r"一定(?:能|会|可以|可|让|帮助|改善|降低|降|逆转|治|瘦|恢复|正常)",
            r"治[好愈]",
            r"逆转.{0,12}(糖尿病|胰岛素|血糖|糖化)",
            r"(糖尿病|胰岛素|血糖|糖化).{0,12}逆转",
        ],
    },
    {
        "rule_id": "no_personal_attributes",
        "severity": "block",
        "message": "Do not imply the viewer personally has diabetes, obesity, or another condition.",
        "patterns": [
            r"\byou have\b.{0,24}\b(?:diabetes|obesity|insulin resistance)\b",
            r"\bare you\b.{0,24}\b(?:diabetic|obese)\b",
            r"你(有|患有).{0,8}(糖尿病|肥胖|胰岛素阻抗)",
            r"你是不是.{0,8}(糖尿病|肥胖|胰岛素阻抗)",
        ],
    },
    {
        "rule_id": "consent_required",
        "severity": "block",
        "message": "Patient stories, photos, reports, or testimonials need consent and anonymization.",
        "patterns": [
            r"\bpatient\b.{0,32}\b(?:story|photo|report|testimonial)\b",
            r"\btestimonial\b",
            r"\bbefore and after\b",
            r"患者.{0,12}(故事|照片|报告|见证|案例)",
            r"病人.{0,12}(故事|照片|报告|见证|案例)",
        ],
    },
    {
        "rule_id": "before_after_limits",
        "severity": "warn",
        "message": "Before/after claims need careful context and should avoid unrealistic transformation framing.",
        "patterns": [
            r"\bbefore\b.{0,16}\bafter\b",
            r"\bafter\b.{0,16}\bbefore\b",
            r"前后对比",
            r"改变前.{0,12}改变后",
        ],
    },
    {
        "rule_id": "education_not_diagnosis",
        "severity": "warn",
        "message": "Keep content educational. Avoid diagnosing or prescribing treatment.",
        "patterns": [
            r"\bdiagnos(?:e|is)\b",
            r"\bprescrib(?:e|ed|ing)\b",
            r"\btreatment plan\b",
            r"诊断",
            r"处方",
            r"治疗方案",
        ],
    },
]


def check_text(text: str) -> Dict[str, object]:
    findings: List[Dict[str, object]] = []
    for rule in RULES:
        matches = []
        for pattern in rule["patterns"]:
            matches.extend(match.group(0) for match in re.finditer(pattern, text, re.IGNORECASE))
        if matches:
            findings.append(
                {
                    "rule_id": rule["rule_id"],
                    "severity": rule["severity"],
                    "message": rule["message"],
                    "matches": sorted(set(matches))[:5],
                }
            )

    has_block = any(finding["severity"] == "block" for finding in findings)
    status = "flagged" if has_block else "pending" if findings else "clear"
    recommendation = (
        "Do not schedule. Rewrite and review manually."
        if has_block
        else "Review manually before scheduling."
        if findings
        else "No obvious compliance issue found. Human review is still required before publishing."
    )
    return {
        "status": status,
        "findings": findings,
        "recommendation": recommendation,
    }
