import csv
import json
import threading
import time
from datetime import datetime, timedelta
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


_NUMERIC_FIELDS = {
    "fridge_w",
    "tv_w",
    "light_w",
    "air_conditioning_w",
    "smart_panel_w",
    "fridge_wh",
    "tv_wh",
    "light_wh",
    "air_conditioning_wh",
    "smart_panel_wh",
    "total_slice_kwh",
}

_DEVICE_WATTS_FIELDS = (
    "tv_w",
    "air_conditioning_w",
    "light_w",
    "fridge_w",
    "smart_panel_w",
)


@dataclass(frozen=True)
class TelemetrySnapshot:
    index: int
    total_rows: int
    completed: bool
    row: dict[str, Any] | None


class TelemetryReplayStore:
    def __init__(self, csv_path: str | Path, state_path: str | Path, interval_seconds: int = 300):
        self.csv_path = Path(csv_path)
        self.state_path = Path(state_path)
        self.interval_seconds = max(1, int(interval_seconds))
        self._rows = self._load_rows()
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._current_index = self._load_state()

    def _load_rows(self) -> list[dict[str, Any]]:
        if not self.csv_path.exists():
            raise FileNotFoundError(f"Telemetry CSV not found: {self.csv_path}")

        rows: list[dict[str, Any]] = []
        with self.csv_path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for raw_row in reader:
                rows.append(self._coerce_row(raw_row))

        return rows

    def _coerce_row(self, raw_row: dict[str, str]) -> dict[str, Any]:
        row: dict[str, Any] = {}
        for key, value in raw_row.items():
            if value is None or value == "":
                row[key] = None
                continue

            if key == "timestamp":
                row[key] = value
                continue

            if key in _NUMERIC_FIELDS:
                try:
                    numeric_value = float(value)
                    row[key] = int(numeric_value) if numeric_value.is_integer() else round(numeric_value, 4)
                except ValueError:
                    row[key] = value
                continue

            row[key] = value

        return row

    def _load_state(self) -> int:
        if not self.state_path.exists():
            return 0

        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
            current_index = int(payload.get("current_index", 0))
            return max(0, min(current_index, max(len(self._rows) - 1, 0)))
        except Exception:
            return 0

    def _persist_state(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "current_index": self._current_index,
            "updated_at": time.time(),
            "interval_seconds": self.interval_seconds,
        }
        self.state_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def _run_loop(self) -> None:
        while not self._stop_event.wait(self.interval_seconds):
            with self._lock:
                if not self._rows:
                    continue
                if self._current_index < len(self._rows) - 1:
                    self._current_index += 1
                    self._persist_state()

    def current(self) -> TelemetrySnapshot:
        with self._lock:
            return self._current_snapshot_locked()

    def advance(self, step: int = 1) -> TelemetrySnapshot:
        with self._lock:
            if not self._rows:
                return TelemetrySnapshot(index=0, total_rows=0, completed=True, row=None)

            step = max(1, int(step))
            self._current_index = min(self._current_index + step, len(self._rows) - 1)
            self._persist_state()
            return self._current_snapshot_locked()

    def reset(self) -> TelemetrySnapshot:
        with self._lock:
            self._current_index = 0
            self._persist_state()
            return self._current_snapshot_locked()

    def _current_snapshot_locked(self) -> TelemetrySnapshot:
        total_rows = len(self._rows)
        if total_rows == 0:
            return TelemetrySnapshot(index=0, total_rows=0, completed=True, row=None)

        index = max(0, min(self._current_index, total_rows - 1))
        return TelemetrySnapshot(
            index=index,
            total_rows=total_rows,
            completed=index >= total_rows - 1,
            row=self._rows[index],
        )

    def status(self) -> dict[str, Any]:
        snapshot = self.current()
        next_index = min(snapshot.index + 1, snapshot.total_rows - 1) if snapshot.total_rows else 0
        next_row = self._rows[next_index] if snapshot.total_rows else None
        return {
            "csvPath": str(self.csv_path),
            "statePath": str(self.state_path),
            "intervalSeconds": self.interval_seconds,
            "currentIndex": snapshot.index,
            "totalRows": snapshot.total_rows,
            "completed": snapshot.completed,
            "currentRow": snapshot.row,
            "nextRow": next_row,
        }

    def accrual_for_current_sgt(self) -> dict[str, Any]:
        """Compute month-to-date kWh accrual up to the current SGT 5-minute slot."""
        with self._lock:
            if not self._rows:
                return {
                    "matched": False,
                    "matchedIndex": 0,
                    "matchedTimestamp": None,
                    "monthKey": None,
                    "accruedSliceKwh": 0.0,
                    "perDeviceAccruedKwh": {field: 0.0 for field in _DEVICE_WATTS_FIELDS},
                    "totalRows": 0,
                }

            now_sgt = datetime.now(ZoneInfo("Asia/Singapore")).replace(second=0, microsecond=0)
            now_sgt = now_sgt - timedelta(minutes=now_sgt.minute % 5)
            target_naive = now_sgt.replace(tzinfo=None)
            month_key = target_naive.strftime("%Y-%m")

            matched_index = 0
            matched_timestamp = None
            for index, row in enumerate(self._rows):
                timestamp_raw = row.get("timestamp")
                if not isinstance(timestamp_raw, str):
                    continue
                try:
                    row_ts = datetime.strptime(timestamp_raw, "%Y-%m-%d %H:%M:%S")
                except ValueError:
                    continue
                if row_ts <= target_naive:
                    matched_index = index
                    matched_timestamp = timestamp_raw
                else:
                    break

            accrued_kwh = 0.0
            per_device_kwh = {field: 0.0 for field in _DEVICE_WATTS_FIELDS}
            for index, row in enumerate(self._rows):
                if index > matched_index:
                    break
                timestamp_raw = row.get("timestamp")
                if not isinstance(timestamp_raw, str) or not timestamp_raw.startswith(month_key):
                    continue
                slice_kwh = row.get("total_slice_kwh", 0.0)
                try:
                    accrued_kwh += float(slice_kwh)
                except (TypeError, ValueError):
                    continue

                for field in _DEVICE_WATTS_FIELDS:
                    watts_value = row.get(field, 0.0)
                    try:
                        per_device_kwh[field] += (float(watts_value) * (5 / 60.0)) / 1000.0
                    except (TypeError, ValueError):
                        continue

            return {
                "matched": matched_timestamp is not None,
                "matchedIndex": matched_index,
                "matchedTimestamp": matched_timestamp,
                "monthKey": month_key,
                "accruedSliceKwh": round(accrued_kwh, 6),
                "perDeviceAccruedKwh": {
                    field: round(value, 6)
                    for field, value in per_device_kwh.items()
                },
                "totalRows": len(self._rows),
            }
