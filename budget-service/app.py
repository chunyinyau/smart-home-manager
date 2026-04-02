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
    'DATABASE_URL', 'sqlite:///local_budget.db'
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# ==========================================
# 1. ORM Model
# ==========================================
class Budget(db.Model):
    __tablename__ = 'budgets'
    budget_id  = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id    = db.Column(db.Integer, nullable=False)
    budget_cap = db.Column(db.Numeric(10, 2), nullable=False, default=100.00)
    cum_bill   = db.Column(db.Numeric(10, 2), nullable=False, default=0.00)

    def to_dict(self):
        return {
            "budget_id":  self.budget_id,
            "user_id":    self.user_id,
            "budget_cap": float(self.budget_cap) if isinstance(self.budget_cap, decimal.Decimal) else self.budget_cap,
            "cum_bill":   float(self.cum_bill)   if isinstance(self.cum_bill,   decimal.Decimal) else self.cum_bill,
        }

# ==========================================
# 2. API Routes
# ==========================================
@app.route('/', methods=['GET'])
def home():
    return jsonify({
        "status":    "online",
        "service":   "Budget Microservice",
        "endpoints": [
            "GET  /api/budget",
            "GET  /api/budget/<user_id>",
            "POST /api/budget",
            "PUT  /api/budget/<budget_id>",
        ],
    })


@app.route('/api/budget', methods=['GET'])
def get_all_budgets():
    """Return all budget records."""
    try:
        budgets = Budget.query.order_by(Budget.budget_id).all()
        return jsonify({"success": True, "data": [b.to_dict() for b in budgets]}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/budget/<int:user_id>', methods=['GET'])
def get_budget_by_user(user_id):
    """Return the budget record for a specific user."""
    try:
        budget = Budget.query.filter_by(user_id=user_id).first()
        if not budget:
            return jsonify({"success": False, "error": "No budget found for this user"}), 404
        return jsonify({"success": True, "data": budget.to_dict()}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/budget', methods=['POST'])
def create_budget():
    """Create a new budget record for a user."""
    try:
        body = request.get_json()
        if not body or 'user_id' not in body:
            return jsonify({"success": False, "error": "user_id is required"}), 400

        new_budget = Budget(
            user_id    = body['user_id'],
            budget_cap = body.get('budget_cap', 100.00),
            cum_bill   = body.get('cum_bill',   0.00),
        )
        db.session.add(new_budget)
        db.session.commit()
        return jsonify({"success": True, "data": new_budget.to_dict()}), 201
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/budget/<int:budget_id>', methods=['PUT'])
def update_budget(budget_id):
    """Update an existing budget record."""
    try:
        budget = Budget.query.get(budget_id)
        if not budget:
            return jsonify({"success": False, "error": "Budget not found"}), 404

        body = request.get_json()
        if 'budget_cap' in body:
            budget.budget_cap = body['budget_cap']
        if 'cum_bill' in body:
            budget.cum_bill = body['cum_bill']

        db.session.commit()
        return jsonify({"success": True, "data": budget.to_dict()}), 200
    except Exception as e:
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
                # Seed a default budget for user 1
                if not Budget.query.first():
                    db.session.add(Budget(user_id=1, budget_cap=100.00, cum_bill=0.00))
                    db.session.commit()
                    print("Seeded default budget: $100.00 cap for user_id=1", flush=True)
                return True
        except OperationalError:
            print(f"DB not ready (attempt {attempt}/{retries}) — retrying in {delay}s")
            time.sleep(delay)
    return False


# ==========================================
# 4. Entrypoint
# ==========================================
if __name__ == '__main__':
    if wait_for_db():
        print("Database connection established!")
        app.run(host='0.0.0.0', port=5004, debug=True)
    else:
        print("Could not connect to database after retries. Exiting.")
