FROM python:3.11-slim

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Create non-root user
RUN groupadd --system app && useradd --system --create-home --gid app app

# Create virtual environment
RUN python -m venv $VIRTUAL_ENV

# Copy requirements and application code into the image
COPY history-service/requirements.txt /app/history-service/requirements.txt
COPY rabbitmq/ /app/rabbitmq/
COPY history-service/ /app/history-service/

# Ensure the app directories and venv are owned by the non-root user
RUN chown -R app:app /app $VIRTUAL_ENV

USER app
WORKDIR /app/history-service

# Install Python dependencies as non-root inside the venv (avoids pip root warning)
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5005

CMD ["python", "app.py"]
