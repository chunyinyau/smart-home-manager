FROM python:3.11-slim

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONPATH="/app"

RUN groupadd --system app && useradd --system --create-home --gid app app

RUN python -m venv $VIRTUAL_ENV

COPY forecastbill-service/requirements.txt /app/forecastbill-service/requirements.txt
COPY picoclaw/ /app/picoclaw/
COPY forecastbill-service/ /app/forecastbill-service/

RUN chown -R app:app /app $VIRTUAL_ENV

USER app
WORKDIR /app/forecastbill-service

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5009

CMD ["python", "app.py"]
