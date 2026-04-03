FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (needed for MySQL client build)
RUN apt-get update && apt-get install -y default-libmysqlclient-dev pkg-config gcc

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5007

CMD ["python", "app.py"]
