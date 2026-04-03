FROM python:3.11-slim

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH="/app"

RUN groupadd --system app && useradd --system --create-home --gid app app

RUN python -m venv $VIRTUAL_ENV

COPY history-service/requirements.txt /app/history-service/requirements.txt
COPY rabbitmq/ /app/rabbitmq/
COPY history-service/ /app/history-service/

RUN chown -R app:app /app $VIRTUAL_ENV

USER app
WORKDIR /app/history-service

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5005

CMD ["python", "app.py"]
