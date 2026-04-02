import os
import time
import decimal
from datetime import datetime

from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from sqlalchemy.exc import OperationalError

# ==========================================
# Flask App Configuration
# ==========================================
app = Flask(__name__)
CORS(app)

# Use environment variable for database connection, fallback to local sqlite for dev
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv(
    'DATABASE_URL', 'mysql+pymysql://root:bill_root_password@bill_db:3306/bill_db'
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# ==========================================
# 1. ORM Model
# ==========================================
class Bill(db.Model):
    __tablename__ = 'bills'
    
    bill_id              = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id              = db.Column(db.Integer, nullable=False)
    period_cost_sgd       = db.Column(db.Numeric(10, 4), nullable=False)
    period_kwh           = db.Column(db.Numeric(10, 4), nullable=False)
    computed_at          = db.Column(db.DateTime, nullable=False)
    billing_period_start = db.Column(db.Date, nullable=False)

    def to_dict(self):
        return {
            "bill_id": self.bill_id,
            "user_id": self.user_id,
            "period_cost_sgd": float(self.period_cost_sgd) if isinstance(self.period_cost_sgd, decimal.Decimal) else self.period_cost_sgd,
            "period_kwh": float(self.period_kwh) if isinstance(self.period_kwh, decimal.Decimal) else self.period_kwh,
            "computed_at": self.computed_at.isoformat() if self.computed_at else None,
            "billing_period_start": self.billing_period_start.isoformat() if self.billing_period_start else None,
        }

# ==========================================
# 2. API Routes
# ==========================================
@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "status": "online",
        "service": "Billing Microservice",
        "endpoints": ["/api/bills"],
    })

@app.route('/api/bills', methods=['GET'])
def get_bills():
    """Return all bills."""
    try:
        bills = Bill.query.order_by(Bill.bill_id.desc()).all()
        return jsonify({
            "success": True,
            "data": [b.to_dict() for b in bills],
        }), 200

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/bills', methods=['POST'])
def create_bill():
    """Create a new billing record."""
    try:
        data = request.json
        if not data:
            return jsonify({"success": False, "error": "No data provided"}), 400

        # Validate required fields
        required = ["user_id", "period_cost_sgd", "period_kwh", "computed_at", "billing_period_start"]
        for field in required:
            if field not in data:
                return jsonify({"success": False, "error": f"Missing required field: {field}"}), 400

        # Parse dates
        computed_at = datetime.fromisoformat(data['computed_at'])
        billing_period_start = datetime.fromisoformat(data['billing_period_start']).date()

        new_bill = Bill(
            user_id=data['user_id'],
            period_cost_sgd=data['period_cost_sgd'],
            period_kwh=data['period_kwh'],
            computed_at=computed_at,
            billing_period_start=billing_period_start
        )

        db.session.add(new_bill)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Bill recorded successfully",
            "data": new_bill.to_dict()
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({"success": False, "error": str(e)}), 500

# ==========================================
# 3. Database Bootstrap (retry loop)
# ==========================================
def wait_for_db(retries=10, delay=5):
    """Wait for MySQL to accept connections, then create tables."""
    print("Waiting for MySQL to be ready...")
    for attempt in range(1, retries + 1):
        try:
            with app.app_context():
                db.create_all()
                print("Database tables created or verified.")
                return True
        except OperationalError:
            print(f"DB not ready (attempt {attempt}/{retries}) - retrying in {delay}s")
            time.sleep(delay)
    return False

# ==========================================
# 4. Entrypoint
# ==========================================
if __name__ == '__main__':
    if wait_for_db():
        print("Database connection established!")
        # Billing service runs on port 5002
        app.run(host='0.0.0.0', port=5002, debug=True)
    else:
        print("Could not connect to database after retries. Exiting.")
