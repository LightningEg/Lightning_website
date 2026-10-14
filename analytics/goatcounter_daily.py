"""Send GoatCounter's totals to the private Apps Script receiver: nothing is committed.

    python analytics/goatcounter_daily.py              # refresh the last four Cairo days
    python analytics/goatcounter_daily.py 90           # refresh the last 90 days (at most 120)
    python analytics/goatcounter_daily.py 2026-10-03   # refresh one specific day

One row per Cairo day (visits, downloads) and one per day, release and event for
the events js/analytics.js names "<event>@<release>" (reach-trust, calc-used,
click-..., signup-submit) and the consent choices (consent-all). The receiver
replaces the rows of the days sent, so reruns are safe, and the dashboard reads
them behind the key. The workflow provides GOATCOUNTER_API_KEY and
ANALYTICS_READ_KEY (the receiver's key).
"""
import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

API = "https://mohamedelfeki.goatcounter.com/api/v0"
CAIRO = ZoneInfo("Africa/Cairo")
RECEIVER = "https://script.google.com/macros/s/AKfycbzzlE-9gmeXb-D0DZMp6gg3dxNo-9ZBhgJED-y_ca26xevvtNnDb8Vqk6vs6Y_Aei0d/exec"
HEADER = [
    "date",
    "page_visits",
    "app_downloads",
    "sample_downloads",
    "downloads_by_build",
    "updated_at",
]


def get(path: str) -> dict:
    token = os.environ.get("GOATCOUNTER_API_KEY", "").strip()
    if not token:
        raise RuntimeError("GOATCOUNTER_API_KEY is not set")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }
    req = urllib.request.Request(API + path, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GoatCounter {e.code} for {path}: {body}") from e


def utc(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def day_row(d: date) -> tuple[list, list]:
    start = datetime.combine(d, time(), CAIRO)
    end = min(
        start + timedelta(days=1),
        datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0),
    )
    span = f"start={utc(start)}&end={utc(end)}"

    total = get(f"/stats/total?{span}")

    builds = {}
    events = []
    sample = 0
    page_visits = 0
    excluded = []

    while True:
        params = span + "&limit=100"
        if excluded:
            params += "&" + urllib.parse.urlencode(
                [("exclude_paths", str(path_id)) for path_id in excluded]
            )
        page = get(f"/stats/hits?{params}")
        hits = page.get("hits", [])

        for hit in hits:
            path = hit.get("path", "")
            count = int(hit.get("count", 0))
            is_event = bool(hit.get("event", False))

            if not is_event:
                page_visits += count
            elif path.startswith("download-app-"):
                builds[path.removeprefix("download-app-")] = count
            elif path.startswith("download-sample-"):
                sample += count
            elif "@" in path:
                name, _, release = path.partition("@")
                events.append([d.isoformat(), release, name, count])
            elif path.startswith("consent-"):
                events.append([d.isoformat(), "", path, count])

        if not page.get("more") or not hits:
            break
        excluded.extend(hit["path_id"] for hit in hits)

    by_build = "; ".join(f"{k}: {v}" for k, v in sorted(builds.items()))
    stamp = datetime.now(CAIRO).strftime("%Y-%m-%d %H:%M")
    row = [
        d.isoformat(),
        page_visits,
        sum(builds.values()),
        sample,
        by_build,
        stamp,
    ]
    return row, sorted(events)


def push(days: list, daily: list, events: list) -> bool:
    """Send the rows to the receiver. False (with a warning) when its key isn't set up yet."""
    key = os.environ.get("ANALYTICS_READ_KEY", "").strip()
    if not key:
        print("::warning::ANALYTICS_READ_KEY is not set, so nothing was saved. Add it as a repository secret.")
        return False
    payload = {"v": 1, "kind": "counts", "key": key, "days": days, "daily": daily, "events": events}
    body = urllib.parse.urlencode({"form_type": "event", "payload": json.dumps(payload)}).encode()
    # Apps Script answers a POST with a redirect to its result; urllib follows it.
    with urllib.request.urlopen(urllib.request.Request(RECEIVER, data=body), timeout=120) as r:
        answer = r.read().decode("utf-8", errors="replace").strip()
    if answer != "ok":
        raise RuntimeError(f"Receiver answered {answer[:80]!r}: check ANALYTICS_READ_KEY and that the latest script is deployed.")
    return True


def main() -> None:
    today = datetime.now(CAIRO).date()
    arg = sys.argv[1].strip() if len(sys.argv) > 1 else ""
    if not arg:
        days = [today - timedelta(days=n) for n in range(3, -1, -1)]
    elif arg.isdigit():
        days = [today - timedelta(days=n) for n in range(min(int(arg), 120) - 1, -1, -1)]
    else:
        days = [date.fromisoformat(arg)]

    results = [day_row(d) for d in days]
    daily = [row for row, _ in results]
    events = [e for _, rows in results for e in rows]
    saved = push([d.isoformat() for d in days], daily, events)
    print(f"{len(daily)} days, {len(events)} event rows" + (" saved." if saved else " not saved."))


if __name__ == "__main__":
    main()
