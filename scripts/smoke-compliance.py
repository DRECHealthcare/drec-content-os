from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from apps.api.app.compliance import check_text


def assert_status(text, expected, label):
    result = check_text(text)
    actual = result["status"]
    if actual != expected:
        raise AssertionError(f"{label}: expected {expected}, got {actual}: {result}")


def main():
    assert_status("为什么空腹血糖正常，不代表胰岛素一定健康", "clear", "negated certainty education")
    assert_status("这个方法一定能逆转糖尿病", "flagged", "guaranteed diabetes reversal")
    assert_status("保证三个月降血糖", "flagged", "guaranteed lab improvement")
    assert_status("以上是一般健康教育，不等于个人诊断或治疗方案。", "pending", "diagnosis disclaimer warning")
    print("PASS compliance smoke")


if __name__ == "__main__":
    main()
