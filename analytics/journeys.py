"""Keep analytics/journeys.csv up to date from the Apps Script receiver: totals only.

    python analytics/journeys.py          # refresh the last 28 Cairo days
    python analytics/journeys.py 60       # refresh the last 60 days (at most 88)

Only visitors who chose Allow all are in it. One row per Cairo day, landing
release (the first page of the visit), landing page, source, device and
language. The receiver keeps raw rows for 90 days; older dates stay here as
they were. The GitHub Actions workflow provides ANALYTICS_JOURNEYS_KEY; without
it the script does nothing, so the workflow still passes before setup.
"""
import csv
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

RECEIVER = "https://script.google.com/macros/s/AKfycbzzlE-9gmeXb-D0DZMp6gg3dxNo-9ZBhgJED-y_ca26xevvtNnDb8Vqk6vs6Y_Aei0d/exec"
CAIRO = ZoneInfo("Africa/Cairo")
OUT = Path(__file__).with_name("journeys.csv")
COLUMNS = [
    "date",
    "landing_release",
    "landing_page",
    "source",
    "device",
    "lang",
    "visits",
    "returning",
    "multi_page",
    "downloads",
    "signups",
    "surveys",
    "median_secs_to_download",
]
HEADER = COLUMNS + ["updated_at"]


def main() -> None:
    key = os.environ.get("ANALYTICS_JOURNEYS_KEY", "").strip()
    if not key:
        print("ANALYTICS_JOURNEYS_KEY is not set; journeys not refreshed.")
        return
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 28
    url = os.environ.get("ANALYTICS_JOURNEYS_URL", RECEIVER)
    query = urllib.parse.urlencode({"action": "journeys", "key": key, "days": days})
    with urllib.request.urlopen(f"{url}?{query}", timeout=60) as r:
        data = json.load(r)
    if "error" in data:
        raise RuntimeError(f"Receiver refused: {data['error']}")

    keep = set(data["days"])
    stamp = datetime.now(CAIRO).strftime("%Y-%m-%d %H:%M")
    new = [[row.get(c, "") for c in COLUMNS] + [stamp] for row in data["rows"]]

    rows = []
    if OUT.exists():
        existing = list(csv.reader(OUT.open(encoding="utf-8")))
        rows = existing[1:] if existing else []
    rows = [r for r in rows if r and r[0] not in keep] + new
    rows.sort(key=lambda r: r[:6])

    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)
    print(f"{len(new)} rows for {len(keep)} days.")


if __name__ == "__main__":
    main()
