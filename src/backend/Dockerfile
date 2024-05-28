FROM python:3.10-slim-bookworm

WORKDIR /code

COPY ./src/backend/requirements.txt /code/requirements.txt


RUN pip install --upgrade pip  && pip install --no-cache-dir --upgrade -r /code/requirements.txt

COPY ./src/backend /code/

CMD ["uvicorn", "app.main:api", "--host", "0.0.0.0", "--port", "8000", \
    "--workers", "4", "--log-level", "critical", "--no-access-log"]