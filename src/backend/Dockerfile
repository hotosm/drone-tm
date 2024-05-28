FROM python:3.10-slim-bookworm

WORKDIR /code

COPY requirements.txt /code/requirements.txt

RUN pip install --upgrade pip  && pip install --no-cache-dir --upgrade -r /code/requirements.txt

COPY . /code/

ENTRYPOINT [ "sh", "/code/entrypoint.sh" ]