import os
import time
import decimal

from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from sqlalchemy.exc import OperationalError

# ==========================================
# Flask App Configuration
# ==========================================
app = Flask(__name__)
CORS(app)

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
        "endpoints": ["/api/rate"],
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


# ==========================================
# 3. Database Bootstrap (retry loop)
# ==========================================
def wait_for_db(retries=10, delay=5):
    """Wait for MySQL to accept connections, then create tables and seed."""
    print("⏳ Waiting for MySQL to be ready...")
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
                        "🚀 Seeded default rate: 26.71 cents/kWh for 2026-03",
                        flush=True,
                    )
                return True
        except OperationalError:
            print(
                f"🔄 DB not ready (attempt {attempt}/{retries}) "
                f"— retrying in {delay}s"
            )
            time.sleep(delay)
    return False


# ==========================================
# 4. Entrypoint
# ==========================================
if __name__ == '__main__':
    if wait_for_db():
        print("✅ Database connection established!")
        app.run(host='0.0.0.0', port=5001, debug=True)
    else:
        print("❌ Could not connect to database after retries. Exiting.")
