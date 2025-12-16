FROM python:3.11-slim

ENV PIP_DISABLE_PIP_VERSION_CHECK=on \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY services/scraper/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY services/scraper /app

EXPOSE 6800

CMD ["scrapyd"]
