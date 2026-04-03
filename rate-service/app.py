from datetime import date
import os
import time
import decimal
import requests

from flask import Flask, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from sqlalchemy.exc import OperationalError

RATE_DATASET_ID = os.getenv(
    "RATE_DATASET_ID", "d_d610f8ed1864daa6c7e790318bbc3323"
)
RATE_DATASET_URL = "https://data.gov.sg/api/action/datastore_search"


def get_cors_origins():
    configured = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "").split(",")
        if origin.strip()
    ]
    if configured:
        return configured

    return ["http://localhost:3000", "http://127.0.0.1:3000"]


def is_debug_enabled():
    return os.getenv("FLASK_DEBUG", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def fetch_latest_domestic_rate_snapshot():
    response = requests.get(
        RATE_DATASET_URL,
        params={"resource_id": RATE_DATASET_ID},
        timeout=20,
    )
    response.raise_for_status()

    payload = response.json()
    if not payload.get("success"):
        raise RuntimeError("data.gov.sg returned an unsuccessful response")

    result = payload.get("result") or {}
    records = result.get("records") or []
    if not isinstance(records, list) or not records:
        raise RuntimeError("data.gov.sg did not return any rate records")

    domestic_record = None
    for record in records:
        if not isinstance(record, dict):
            continue
        series_name = str(record.get("DataSeries", ""))
        if "domestic" in series_name.lower():
            domestic_record = record
            break

    if domestic_record is None:
        domestic_record = next(
            (record for record in records if isinstance(record, dict)),
            None,
        )

    if domestic_record is None:
        raise RuntimeError("Unable to find a valid domestic tariff record")

    yearly_values = []
    for key, value in domestic_record.items():
        if not isinstance(key, str) or len(key) != 4 or not key.isdigit():
            continue
        try:
            yearly_values.append((int(key), float(value)))
        except (TypeError, ValueError):
            continue

    if not yearly_values:
        raise RuntimeError("No yearly tariff values were found in the dataset record")

    source_year, cents_per_kwh = max(yearly_values, key=lambda item: item[0])
    return {
        "source_year": source_year,
        "series": str(domestic_record.get("DataSeries", "Unknown Series")),
        "cents_per_kwh": round(cents_per_kwh, 4),
    }


def upsert_rate_snapshot(month_year, cents_per_kwh):
    existing = Rate.query.filter_by(month_year=month_year).first()

    created = False
    if existing:
        existing.cents_per_kwh = cents_per_kwh
        row = existing
    else:
        row = Rate(cents_per_kwh=cents_per_kwh, month_year=month_year)
        db.session.add(row)
        created = True

    db.session.commit()
    return row, created


def get_current_month_year(reference_date=None):
    reference_date = reference_date or date.today()
    return reference_date.strftime("%Y-%m")


def get_cached_rate_snapshot(current_month_year):
    current_month_rate = Rate.query.filter_by(month_year=current_month_year).first()
    if current_month_rate:
        return current_month_rate

    return Rate.query.order_by(Rate.rate_id.desc()).first()


def should_refresh_rate_snapshot(current_date, current_month_rate):
    return current_date.day == 1 and current_month_rate is None


def get_rate_cents_value(rate):
    if isinstance(rate.cents_per_kwh, decimal.Decimal):
        return float(rate.cents_per_kwh)
    return rate.cents_per_kwh

# ==========================================
# Flask App Configuration
# ==========================================
app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": get_cors_origins()}})

app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv(
    'DATABASE_URL', 'sqlite:///local_rate.db'
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# ==========================================
# 1. ORM Model
# ==========================================
class Rate(db.Model):
    __tablename__ = 'rates'
    rate_id       = db.Column(db.Integer, primary_key=True, autoincrement=True)
    cents_per_kwh = db.Column(db.Numeric(10, 4), nullable=False)
    month_year    = db.Column(db.String(7), nullable=False)  # e.g. "2026-03"

    def to_dict(self):
        return {
            "rate_id": self.rate_id,
            "cents_per_kwh": (
                float(self.cents_per_kwh)
                if isinstance(self.cents_per_kwh, decimal.Decimal)
                else self.cents_per_kwh
            ),
            "month_year": self.month_year,
        }

# ==========================================
# 2. API Routes
# ==========================================
@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "status": "online",
        "service": "Rate Microservice",
        "endpoints": ["/api/rate", "/api/rate/sync"],
    })


@app.route('/api/rate', methods=['GET'])
def get_rates():
    """Return all rates, or the latest one."""
    try:
        rates = Rate.query.order_by(Rate.rate_id.desc()).all()
        if not rates:
            return jsonify({"success": False, "error": "No rate found"}), 404

        return jsonify({
            "success": True,
            "data": [r.to_dict() for r in rates],
        }), 200

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/rate/sync', methods=['GET'])
def sync_rate():
    """Refresh the stored tariff at the start of the month, otherwise return cache."""
    try:
        current_date = date.today()
        current_month_year = get_current_month_year(current_date)
        current_month_rate = Rate.query.filter_by(month_year=current_month_year).first()
        cached_rate = get_cached_rate_snapshot(current_month_year)

        if not should_refresh_rate_snapshot(current_date, current_month_rate):
            if cached_rate is None:
                return jsonify(
                    {
                        "success": False,
                        "error": "No stored rate is available yet",
                    }
                ), 404

            return jsonify(
                {
                    "success": True,
                    "refreshed": False,
                    "created": False,
                    "source": {
                        "mode": "cached",
                        "month_year": cached_rate.month_year,
                    },
                    "data": cached_rate.to_dict(),
                }
            ), 200

        try:
            snapshot = fetch_latest_domestic_rate_snapshot()
        except (requests.HTTPError, requests.RequestException) as error:
            if cached_rate is None:
                raise

            row, created = upsert_rate_snapshot(
                month_year=current_month_year,
                cents_per_kwh=get_rate_cents_value(cached_rate),
            )

            return jsonify(
                {
                    "success": True,
                    "refreshed": False,
                    "created": created,
                    "source": {
                        "mode": "carry-forward",
                        "month_year": current_month_year,
                        "carried_from_month_year": cached_rate.month_year,
                        "attempted_refresh": True,
                        "refresh_error": str(error),
                    },
                    "data": row.to_dict(),
                }
            ), 200

        row, created = upsert_rate_snapshot(
            month_year=current_month_year,
            cents_per_kwh=snapshot["cents_per_kwh"],
        )

        return jsonify({
            "success": True,
            "refreshed": True,
            "created": created,
            "source": {
                "mode": "data.gov.sg",
                "dataset_id": RATE_DATASET_ID,
                "series": snapshot["series"],
                "year": snapshot["source_year"],
                "month_year": current_month_year,
            },
            "data": row.to_dict(),
        }), 200
    except requests.HTTPError as error:
        status_code = (
            error.response.status_code
            if error.response is not None and 400 <= error.response.status_code < 600
            else 502
        )
        return jsonify({
            "success": False,
            "error": "Failed to fetch tariff data from data.gov.sg",
            "details": str(error),
        }), status_code
    except requests.RequestException as error:
        return jsonify({
            "success": False,
            "error": "Unable to reach data.gov.sg tariff dataset",
            "details": str(error),
        }), 502
    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "error": str(e)}), 500


# ==========================================
# 3. Database Bootstrap (retry loop)
# ==========================================
def wait_for_db(retries=10, delay=5):
    """Wait for MySQL to accept connections, then create tables and seed."""
    print("Waiting for MySQL to be ready...")
    for attempt in range(1, retries + 1):
        try:
            with app.app_context():
                db.create_all()
                if not Rate.query.first():
                    db.session.add(
                        Rate(cents_per_kwh=26.71, month_year='2026-03')
                    )
                    db.session.commit()
                    print(
                        "Seeded default rate: 26.71 cents/kWh for 2026-03",
                        flush=True,
                    )
                return True
        except OperationalError:
            print(
                f"DB not ready (attempt {attempt}/{retries}) "
                f"— retrying in {delay}s"
            )
            time.sleep(delay)
    return False


# ==========================================
# 4. Entrypoint
# ==========================================
if __name__ == '__main__':
    if wait_for_db():
        print("Database connection established!")
        app.run(host='0.0.0.0', port=5001, debug=is_debug_enabled())
    else:
        print("Could not connect to database after retries. Exiting.")
